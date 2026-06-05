# Vision Router MCP Server

A simplified MCP server for routing vision tasks to MIMO multimodal model. Based on [mimo-media-recognition-mcp](https://github.com/congxxx/mimo-media-recognition-mcp) design, with only image analysis support.

## Features

- **Image Analysis**: Analyze images using MIMO multimodal model
- **Multiple Input Sources**: Support local files, URLs, and batch processing
- **Structured Output**: Returns JSON-formatted analysis results
- **Error Handling**: Comprehensive error handling with retry logic
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Installation

### Prerequisites

- Python 3.10 or higher
- pip or pipx

### Install from Source

```bash
cd mcp-servers/vision-router
pip install -e .
```

### Install for Development

```bash
cd mcp-servers/vision-router
pip install -e ".[dev]"
```

## Configuration

### Environment Variables

Create a `.env` file or set environment variables:

```bash
# Required
MIMO_API_KEY=your-api-key-here
MIMO_API_BASE=https://token-plan-cn.xiaomimimo.com/anthropic
MIMO_MODEL=mimo-v2.5

# Optional
MIMO_MAX_IMAGE_SIZE_MB=20
MIMO_MAX_IMAGES=6

# Proxy (optional)
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

### Claude Code Integration

Add the MCP server to Claude Code:

```bash
claude mcp add vision-router --scope user \
  --env MIMO_API_KEY="your-api-key" \
  --env MIMO_API_BASE="https://token-plan-cn.xiaomimimo.com/anthropic" \
  --env MIMO_MODEL="mimo-v2.5" \
  -- "python" -m vision_router_mcp.server
```

Or add to your `settings.json`:

```json
{
  "mcpServers": {
    "vision-router": {
      "command": "python",
      "args": ["-m", "vision_router_mcp.server"],
      "env": {
        "MIMO_API_KEY": "your-api-key",
        "MIMO_API_BASE": "https://token-plan-cn.xiaomimimo.com/anthropic",
        "MIMO_MODEL": "mimo-v2.5"
      }
    }
  }
}
```

## Usage

### MCP Tool: understand_image

Analyze images using MIMO multimodal model.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Analysis task description |
| `image_path` | string | No | Path to a single local image |
| `image_url` | string | No | URL of a single remote image |
| `image_paths` | string[] | No | List of paths to local images |
| `image_urls` | string[] | No | List of URLs to remote images |
| `system_prompt` | string | No | Custom system prompt |
| `temperature` | float | No | Randomness (0-2), default: 0.2 |
| `max_tokens` | int | No | Max response length, default: 12000 |

**Supported Image Formats:**
- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- GIF (.gif)
- BMP (.bmp)

**Example Usage:**

```python
# Single local file
result = await understand_image(
    prompt="Describe this image",
    image_path="/path/to/image.png"
)

# Single URL
result = await understand_image(
    prompt="What text is in this image?",
    image_url="https://example.com/image.png"
)

# Multiple files
result = await understand_image(
    prompt="Compare these images",
    image_paths=["/path/to/image1.png", "/path/to/image2.png"]
)
```

### Output Format

**Success Response:**

```json
{
  "success": true,
  "analysis": {
    "description": "A cat sitting on a couch in a living room",
    "objects": ["cat", "couch", "pillow"],
    "text_content": "Hello World",
    "scene": "Cozy living room with warm lighting",
    "details": "Orange tabby cat, looking relaxed"
  },
  "metadata": {
    "model": "mimo-v2.5",
    "processing_time_ms": 1500,
    "tokens_used": 500,
    "image_count": 1
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": "File not found: /path/to/image.png",
  "error_type": "file_not_found"
}
```

**Error Types:**

| Error Type | Description |
|------------|-------------|
| `file_not_found` | Local file does not exist |
| `file_too_large` | File exceeds size limit |
| `invalid_format` | Unsupported image format |
| `invalid_url` | Invalid URL format |
| `api_error` | API call failed |
| `timeout` | Request timed out |
| `validation_error` | Input validation failed |
| `unknown` | Unexpected error |

## Development

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=vision_router_mcp

# Run specific test file
pytest tests/test_utils.py

# Run with verbose output
pytest -v
```

### Code Quality

```bash
# Format code
ruff format .

# Check linting
ruff check .

# Fix linting issues
ruff check --fix .
```

### Debugging

Use MCP Inspector for debugging:

```bash
# Install MCP Inspector
npm install -g @anthropic-ai/mcp-inspector

# Run inspector
mcp-inspector python -m vision_router_mcp.server
```

## Architecture

```
vision-router-mcp/
├── src/
│   └── vision_router_mcp/
│       ├── __init__.py          # Package initialization
│       ├── config.py            # Configuration management
│       ├── models.py            # Pydantic data models
│       ├── utils.py             # Utility functions
│       └── server.py            # MCP server implementation
├── tests/
│   ├── __init__.py
│   ├── test_config.py           # Configuration tests
│   ├── test_utils.py            # Utility function tests
│   └── test_server.py           # Server tests
├── pyproject.toml               # Project configuration
├── README.md                    # This file
└── .env.example                 # Environment variables example
```

## Design Decisions

### Why Anthropic SDK?

The MIMO API supports both OpenAI-compatible and Anthropic formats. We chose the Anthropic format because:

1. **Consistency**: Matches the existing Claude Code configuration
2. **Vision Support**: Native support for image content blocks
3. **Type Safety**: Better type hints and IDE support

### Why Simplified Version?

The original mimo-media-recognition-mcp supports audio and video. This simplified version:

1. **Reduces Complexity**: Fewer dependencies and code paths
2. **Focuses on Core Use Case**: Image analysis is the most common need
3. **Easier Maintenance**: Simpler codebase to understand and modify

### Error Handling Strategy

1. **Validation Errors**: Caught early with clear messages
2. **File Errors**: Specific error types for different file issues
3. **API Errors**: Retry with exponential backoff (3 attempts)
4. **Timeout**: 180 second timeout for API calls

## Troubleshooting

### Common Issues

**1. "Missing required configuration" error**

Set all required environment variables:
```bash
export MIMO_API_KEY="your-key"
export MIMO_API_BASE="https://api.example.com"
export MIMO_MODEL="mimo-v2.5"
```

**2. "File too large" error**

Reduce image size or increase limit:
```bash
export MIMO_MAX_IMAGE_SIZE_MB=50
```

**3. "Unsupported image format" error**

Convert image to supported format:
```bash
# Using ImageMagick
convert image.tiff image.png

# Using PIL
python -c "from PIL import Image; Image.open('image.tiff').save('image.png')"
```

**4. API call fails**

Check:
- API key is correct
- API base URL is correct
- Network connectivity
- Proxy settings (if applicable)

### Debug Mode

Enable debug logging:

```bash
export LOG_LEVEL=DEBUG
python -m vision_router_mcp.server
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run tests: `pytest`
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

Based on [mimo-media-recognition-mcp](https://github.com/congxxx/mimo-media-recognition-mcp) by congxxx.
