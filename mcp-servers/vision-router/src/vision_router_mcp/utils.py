"""Utility functions for Vision Router MCP Server."""

from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
from typing import Any

from .models import ErrorType


# Supported image formats
SUPPORTED_IMAGE_EXTENSIONS: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
}


def guess_mime_type(file_path: Path) -> str:
    """Guess MIME type from file extension.

    Args:
        file_path: Path to the file

    Returns:
        MIME type string

    Raises:
        ValueError: If the file format is not supported
    """
    ext = file_path.suffix.lower()

    # Check against supported formats first
    if ext in SUPPORTED_IMAGE_EXTENSIONS:
        return SUPPORTED_IMAGE_EXTENSIONS[ext]

    # Fallback to mimetypes module, but only for supported formats
    mime_type, _ = mimetypes.guess_type(str(file_path))
    if mime_type and mime_type in SUPPORTED_IMAGE_EXTENSIONS.values():
        return mime_type

    supported = ", ".join(SUPPORTED_IMAGE_EXTENSIONS.keys())
    raise ValueError(f"Unsupported image format: {ext}. Supported: {supported}")


def validate_local_file(file_path: str, max_size_mb: int) -> Path:
    """Validate a local file exists and is within size limits.

    Args:
        file_path: Path to the file (can include ~ for home directory)
        max_size_mb: Maximum file size in megabytes

    Returns:
        Resolved Path object

    Raises:
        FileNotFoundError: If the file does not exist
        ValueError: If the file is too large or not a file
    """
    if not file_path or not file_path.strip():
        raise ValueError("File path cannot be empty")

    path = Path(file_path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    if not path.is_file():
        raise ValueError(f"Path is not a file: {path}")

    size_mb = path.stat().st_size / 1024 / 1024
    if size_mb > max_size_mb:
        raise ValueError(
            f"File too large: {size_mb:.1f}MB (max: {max_size_mb}MB)"
        )

    return path


def file_to_base64(file_path: Path) -> str:
    """Convert a local file to base64-encoded data URL.

    Args:
        file_path: Path to the file

    Returns:
        Data URL string (data:mime;base64,...)
    """
    mime_type = guess_mime_type(file_path)
    with file_path.open("rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def validate_url(url: str) -> str:
    """Validate URL format.

    Args:
        url: URL string to validate

    Returns:
        Validated URL string

    Raises:
        ValueError: If the URL format is invalid
    """
    if not url or not url.strip():
        raise ValueError("URL cannot be empty")

    url = url.strip()
    valid_prefixes = ("http://", "https://", "data:")
    if not any(url.startswith(p) for p in valid_prefixes):
        raise ValueError(
            f"URL must start with http://, https://, or data:"
        )

    return url


def build_image_content(
    image_path: str | None = None,
    image_url: str | None = None,
    image_paths: list[str] | None = None,
    image_urls: list[str] | None = None,
    max_files: int = 6,
    max_size_mb: int = 20,
) -> list[dict[str, Any]]:
    """Build list of image content blocks for API call.

    Args:
        image_path: Single local file path
        image_url: Single remote URL
        image_paths: List of local file paths
        image_urls: List of remote URLs
        max_files: Maximum number of files allowed
        max_size_mb: Maximum file size in MB

    Returns:
        List of content blocks for Anthropic API

    Raises:
        ValueError: If no images provided or too many images
    """
    content: list[dict[str, Any]] = []

    # Process single local file
    if image_path:
        path = validate_local_file(image_path, max_size_mb)
        data_url = file_to_base64(path)
        mime_type = guess_mime_type(path)
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime_type,
                "data": data_url.split(",")[1],  # Remove data:...;base64, prefix
            },
        })

    # Process multiple local files
    if image_paths:
        if not isinstance(image_paths, (list, tuple)):
            raise ValueError("image_paths must be a list")
        for path_str in image_paths:
            path = validate_local_file(path_str, max_size_mb)
            data_url = file_to_base64(path)
            mime_type = guess_mime_type(path)
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime_type,
                    "data": data_url.split(",")[1],
                },
            })

    # Process single URL
    if image_url:
        url = validate_url(image_url)
        content.append({
            "type": "image",
            "source": {
                "type": "url",
                "url": url,
            },
        })

    # Process multiple URLs
    if image_urls:
        if not isinstance(image_urls, (list, tuple)):
            raise ValueError("image_urls must be a list")
        for url_str in image_urls:
            url = validate_url(url_str)
            content.append({
                "type": "image",
                "source": {
                    "type": "url",
                    "url": url,
                },
            })

    if not content:
        raise ValueError(
            "At least one image required: provide image_path, image_url, "
            "image_paths, or image_urls"
        )

    if len(content) > max_files:
        raise ValueError(
            f"Too many images: {len(content)} (max: {max_files})"
        )

    return content


def format_error_response(error: Exception, error_type: ErrorType | None = None) -> dict[str, Any]:
    """Format an error into a structured response.

    Args:
        error: The exception
        error_type: Optional error type (auto-detected if not provided)

    Returns:
        Error response dictionary
    """
    if error_type is None:
        if isinstance(error, FileNotFoundError):
            error_type = ErrorType.FILE_NOT_FOUND
        elif isinstance(error, ValueError):
            if "too large" in str(error).lower():
                error_type = ErrorType.FILE_TOO_LARGE
            elif "unsupported" in str(error).lower():
                error_type = ErrorType.INVALID_FORMAT
            elif "url" in str(error).lower():
                error_type = ErrorType.INVALID_URL
            else:
                error_type = ErrorType.VALIDATION_ERROR
        elif isinstance(error, TimeoutError):
            error_type = ErrorType.TIMEOUT
        else:
            error_type = ErrorType.UNKNOWN

    return {
        "success": False,
        "error": str(error),
        "error_type": error_type.value,
    }


def format_success_response(
    analysis: dict[str, Any],
    model: str,
    processing_time_ms: int,
    tokens_used: int = 0,
    image_count: int = 1,
) -> dict[str, Any]:
    """Format a successful analysis into a structured response.

    Args:
        analysis: Analysis result from the model
        model: Model name used
        processing_time_ms: Processing time in milliseconds
        tokens_used: Tokens used in the API call
        image_count: Number of images analyzed

    Returns:
        Success response dictionary
    """
    return {
        "success": True,
        "analysis": analysis,
        "metadata": {
            "model": model,
            "processing_time_ms": processing_time_ms,
            "tokens_used": tokens_used,
            "image_count": image_count,
        },
    }
