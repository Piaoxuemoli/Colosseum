"""Vision Router MCP Server - Route vision tasks to MIMO multimodal model."""

from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import get_config_summary, load_config
from .models import ErrorType, ImageInput
from .utils import (
    build_image_content_oai,
    format_error_response,
    format_success_response,
)

# Initialize MCP server
mcp = FastMCP("vision-router")

# System prompt for structured analysis
ANALYSIS_SYSTEM_PROMPT = """You are an expert image analyst. Analyze the provided image(s) and return a structured JSON response.

Your response MUST be a valid JSON object with the following structure:
{
    "description": "Detailed description of the image content",
    "objects": ["list", "of", "detected", "objects"],
    "text_content": "Any text found in the image (OCR), empty string if none",
    "scene": "Description of the scene or context",
    "details": "Additional observations, details, or notable features"
}

Rules:
1. Always return valid JSON, nothing else
2. Be thorough and accurate in your descriptions
3. For objects, list the main items/subjects visible
4. For text_content, extract ALL visible text exactly as it appears
5. For scene, describe the setting, environment, or context
6. For details, note colors, styles, emotions, actions, or other relevant observations
7. If multiple images are provided, analyze them as a related set"""


def build_chat_completions_url(api_base: str) -> str:
    """Build the complete chat completions URL.

    Args:
        api_base: Base API URL

    Returns:
        Complete URL for chat completions endpoint
    """
    api_base = api_base.rstrip("/")
    if api_base.endswith("/chat/completions"):
        return api_base
    # Remove /anthropic suffix if present
    if api_base.endswith("/anthropic"):
        api_base = api_base[:-len("/anthropic")]
    return f"{api_base}/v1/chat/completions"


def parse_analysis_response(response_text: str) -> dict[str, Any]:
    """Parse the model's response into structured analysis.

    Args:
        response_text: Raw response from the model

    Returns:
        Parsed analysis dictionary
    """
    # Try to extract JSON from the response
    text = response_text.strip()

    # Handle markdown code blocks
    if text.startswith("```"):
        # Remove markdown code block markers
        lines = text.split("\n")
        # Find start and end of code block
        start = 0
        end = len(lines)
        for i, line in enumerate(lines):
            if line.strip().startswith("```") and i == 0:
                start = i + 1
            elif line.strip() == "```" and i > 0:
                end = i
                break
        text = "\n".join(lines[start:end]).strip()

    # Try parsing as JSON
    try:
        parsed = json.loads(text)
        # Validate it has the expected structure
        if isinstance(parsed, dict):
            # Check if description contains nested JSON
            desc = parsed.get("description", "")
            if isinstance(desc, str) and desc.startswith("{"):
                try:
                    nested = json.loads(desc)
                    if isinstance(nested, dict) and "description" in nested:
                        return {
                            "description": nested.get("description", ""),
                            "objects": nested.get("objects", []),
                            "text_content": nested.get("text_content", ""),
                            "scene": nested.get("scene", ""),
                            "details": nested.get("details", ""),
                        }
                except json.JSONDecodeError:
                    pass

            return {
                "description": desc,
                "objects": parsed.get("objects", []),
                "text_content": parsed.get("text_content", ""),
                "scene": parsed.get("scene", ""),
                "details": parsed.get("details", ""),
            }
    except json.JSONDecodeError:
        pass

    # If JSON parsing fails, create a basic structure from the text
    return {
        "description": text,
        "objects": [],
        "text_content": "",
        "scene": "",
        "details": "Response was not in expected JSON format",
    }


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    reraise=True,
)
async def call_mimo_api(
    image_content: list[dict[str, Any]],
    prompt: str,
    system_prompt: str | None,
    temperature: float,
    max_tokens: int,
    enable_web_search: bool = False,
) -> tuple[dict[str, Any], int, list[dict[str, Any]] | None]:
    """Call MIMO API with retry logic using OpenAI-compatible format.

    Args:
        image_content: List of image content blocks (OpenAI format)
        prompt: User's analysis prompt
        system_prompt: Optional system prompt override
        temperature: Randomness parameter
        max_tokens: Maximum response length
        enable_web_search: Whether to enable web search

    Returns:
        Tuple of (parsed analysis, tokens used, citations)

    Raises:
        httpx.HTTPError: If API call fails after retries
    """
    config = load_config()
    endpoint = build_chat_completions_url(config.api_base)

    # Build messages
    messages: list[dict[str, Any]] = []

    # Add system prompt
    sys_prompt = system_prompt if system_prompt else ANALYSIS_SYSTEM_PROMPT
    messages.append({"role": "system", "content": sys_prompt})

    # Build user message content
    content: list[dict[str, Any]] = []

    # Add image content
    for img in image_content:
        content.append(img)

    # Add text prompt
    content.append({"type": "text", "text": prompt})

    messages.append({"role": "user", "content": content})

    # Build request payload
    payload: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "thinking": {"type": "disabled"},  # Disable thinking mode for faster responses
    }

    # Add web search tool if enabled
    # Note: Web search requires webSearchEnabled=true in MIMO account settings
    # If web search is not enabled, the API will return a 400 error
    if enable_web_search:
        payload["tools"] = [
            {
                "type": "web_search",
                "max_keyword": 3,
                "force_search": True,
                "limit": 3,
            }
        ]

    # Build headers
    headers = {
        "api-key": config.api_key,
        "Content-Type": "application/json",
    }

    # Add proxy if configured
    http_proxy = os.getenv("HTTP_PROXY") or os.getenv("http_proxy")
    https_proxy = os.getenv("HTTPS_PROXY") or os.getenv("https_proxy")
    proxy = https_proxy or http_proxy

    # Call the API
    async with httpx.AsyncClient(
        timeout=180.0,
        proxy=proxy if proxy else None,
    ) as client:
        response = await client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    # Extract response
    choice = data["choices"][0]
    message = choice["message"]
    response_text = message.get("content", "")

    # If content is empty, try reasoning_content (for thinking mode)
    if not response_text and "reasoning_content" in message:
        response_text = message["reasoning_content"]

    # Extract citations if present (from web search)
    citations = None
    if "annotations" in message:
        citations = [
            ann for ann in message["annotations"]
            if ann.get("type") == "url_citation"
        ]

    # Parse the response
    analysis = parse_analysis_response(response_text)

    # Get token usage
    tokens_used = 0
    if "usage" in data:
        usage = data["usage"]
        tokens_used = usage.get("total_tokens", 0)

    return analysis, tokens_used, citations


@mcp.tool()
async def understand_image(
    prompt: str,
    image_path: str | None = None,
    image_url: str | None = None,
    image_paths: list[str] | None = None,
    image_urls: list[str] | None = None,
    system_prompt: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 12000,
    enable_web_search: bool = False,
) -> str:
    """
    Analyze images using MIMO multimodal model.

    This tool routes vision tasks to the MIMO multimodal model, allowing
    the main model to understand images without directly processing them.

    Args:
        prompt: Analysis task (e.g., "Describe this image", "Extract text")
        image_path: Path to a single local image
        image_url: URL of a single remote image
        image_paths: List of paths to local images
        image_urls: List of URLs to remote images
        system_prompt: Optional system prompt override
        temperature: Randomness (0-2), default: 0.2
        max_tokens: Maximum response length, default: 12000
        enable_web_search: Enable web search for additional context, default: false

    Returns:
        JSON string with structured analysis result
    """
    start_time = time.time()

    try:
        # Load config for validation
        config = load_config()

        # Validate input
        image_input = ImageInput(
            prompt=prompt,
            image_path=image_path,
            image_url=image_url,
            image_paths=image_paths,
            image_urls=image_urls,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # Check if at least one image source is provided
        if not image_input.has_image_source():
            return json.dumps(format_error_response(
                ValueError(
                    "At least one image required: provide image_path, image_url, "
                    "image_paths, or image_urls"
                ),
                ErrorType.VALIDATION_ERROR,
            ))

        # Build image content for API (OpenAI format)
        image_content = build_image_content_oai(
            image_path=image_path,
            image_url=image_url,
            image_paths=image_paths,
            image_urls=image_urls,
            max_files=config.max_images,
            max_size_mb=config.max_image_size_mb,
        )

        # Count images
        image_count = len(image_content)

        # Call the API
        analysis, tokens_used, citations = await call_mimo_api(
            image_content=image_content,
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            enable_web_search=enable_web_search,
        )

        # Calculate processing time
        processing_time_ms = int((time.time() - start_time) * 1000)

        # Format success response
        result = format_success_response(
            analysis=analysis,
            model=config.model,
            processing_time_ms=processing_time_ms,
            tokens_used=tokens_used,
            image_count=image_count,
        )

        # Add citations if present
        if citations:
            result["citations"] = citations

        return json.dumps(result)

    except Exception as e:
        return json.dumps(format_error_response(e))


@mcp.resource("vision-router://config")
def get_config() -> str:
    """Get current Vision Router configuration (API key is masked)."""
    try:
        config = load_config()
        return get_config_summary(config)
    except RuntimeError as e:
        return f"Configuration error: {e}"


def main() -> None:
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
