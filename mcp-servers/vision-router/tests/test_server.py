"""Tests for server module."""

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from vision_router_mcp.server import parse_analysis_response


class TestParseAnalysisResponse:
    """Test parse_analysis_response function."""

    def test_valid_json(self):
        """Test parsing valid JSON response."""
        response = json.dumps({
            "description": "A cat sitting on a couch",
            "objects": ["cat", "couch"],
            "text_content": "Hello World",
            "scene": "Living room",
            "details": "Orange tabby cat",
        })
        result = parse_analysis_response(response)
        assert result["description"] == "A cat sitting on a couch"
        assert result["objects"] == ["cat", "couch"]
        assert result["text_content"] == "Hello World"
        assert result["scene"] == "Living room"
        assert result["details"] == "Orange tabby cat"

    def test_json_with_markdown_code_block(self):
        """Test parsing JSON wrapped in markdown code block."""
        response = """```json
{
    "description": "A cat sitting on a couch",
    "objects": ["cat", "couch"],
    "text_content": "",
    "scene": "Living room",
    "details": "Orange tabby cat"
}
```"""
        result = parse_analysis_response(response)
        assert result["description"] == "A cat sitting on a couch"
        assert result["objects"] == ["cat", "couch"]

    def test_json_with_plain_code_block(self):
        """Test parsing JSON wrapped in plain code block."""
        response = """```
{
    "description": "A cat",
    "objects": ["cat"],
    "text_content": "",
    "scene": "",
    "details": ""
}
```"""
        result = parse_analysis_response(response)
        assert result["description"] == "A cat"

    def test_invalid_json_fallback(self):
        """Test fallback when JSON is invalid."""
        response = "This is not JSON, it's just a description of an image."
        result = parse_analysis_response(response)
        assert result["description"] == response
        assert result["objects"] == []
        assert result["text_content"] == ""
        assert result["scene"] == ""
        assert "not in expected JSON format" in result["details"]

    def test_partial_json(self):
        """Test parsing partial JSON (missing some fields)."""
        response = json.dumps({
            "description": "A cat",
            "objects": ["cat"],
        })
        result = parse_analysis_response(response)
        assert result["description"] == "A cat"
        assert result["objects"] == ["cat"]
        assert result["text_content"] == ""
        assert result["scene"] == ""
        assert result["details"] == ""

    def test_empty_response(self):
        """Test parsing empty response."""
        response = ""
        result = parse_analysis_response(response)
        assert result["description"] == ""
        assert result["objects"] == []
        assert "not in expected JSON format" in result["details"]

    def test_json_with_extra_whitespace(self):
        """Test parsing JSON with extra whitespace."""
        response = "  \n  {\"description\": \"A cat\", \"objects\": [\"cat\"]}  \n  "
        result = parse_analysis_response(response)
        assert result["description"] == "A cat"
        assert result["objects"] == ["cat"]
