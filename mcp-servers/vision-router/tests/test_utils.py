"""Tests for utility functions."""

import base64
import json
import os
import tempfile
from pathlib import Path

import pytest

from vision_router_mcp.models import ErrorType
from vision_router_mcp.utils import (
    build_image_content,
    file_to_base64,
    format_error_response,
    format_success_response,
    guess_mime_type,
    validate_local_file,
    validate_url,
)


class TestGuessMimeType:
    """Test guess_mime_type function."""

    def test_jpg_extension(self):
        """Test JPEG extension detection."""
        assert guess_mime_type(Path("image.jpg")) == "image/jpeg"
        assert guess_mime_type(Path("image.jpeg")) == "image/jpeg"

    def test_png_extension(self):
        """Test PNG extension detection."""
        assert guess_mime_type(Path("image.png")) == "image/png"

    def test_webp_extension(self):
        """Test WebP extension detection."""
        assert guess_mime_type(Path("image.webp")) == "image/webp"

    def test_gif_extension(self):
        """Test GIF extension detection."""
        assert guess_mime_type(Path("image.gif")) == "image/gif"

    def test_bmp_extension(self):
        """Test BMP extension detection."""
        assert guess_mime_type(Path("image.bmp")) == "image/bmp"

    def test_unsupported_extension(self):
        """Test unsupported extension raises error."""
        with pytest.raises(ValueError, match="Unsupported image format"):
            guess_mime_type(Path("image.tiff"))

    def test_case_insensitive(self):
        """Test case insensitive extension handling."""
        assert guess_mime_type(Path("image.PNG")) == "image/png"
        assert guess_mime_type(Path("image.JPG")) == "image/jpeg"


class TestValidateLocalFile:
    """Test validate_local_file function."""

    def test_empty_path(self):
        """Test empty path raises error."""
        with pytest.raises(ValueError, match="cannot be empty"):
            validate_local_file("", 20)

    def test_nonexistent_file(self):
        """Test nonexistent file raises error."""
        with pytest.raises(FileNotFoundError, match="File not found"):
            validate_local_file("/nonexistent/file.png", 20)

    def test_directory_path(self, tmp_path):
        """Test directory path raises error."""
        with pytest.raises(ValueError, match="not a file"):
            validate_local_file(str(tmp_path), 20)

    def test_valid_file(self, tmp_path):
        """Test valid file returns path."""
        test_file = tmp_path / "test.png"
        test_file.write_bytes(b"fake image data")
        result = validate_local_file(str(test_file), 20)
        assert result == test_file.resolve()

    def test_file_too_large(self, tmp_path):
        """Test file too large raises error."""
        test_file = tmp_path / "large.png"
        # Create a file larger than 1MB
        test_file.write_bytes(b"x" * (1024 * 1024 + 1))
        with pytest.raises(ValueError, match="File too large"):
            validate_local_file(str(test_file), 1)

    def test_home_directory_expansion(self, tmp_path, monkeypatch):
        """Test ~ expansion in path."""
        test_file = tmp_path / "test.png"
        test_file.write_bytes(b"fake image data")
        monkeypatch.setenv("HOME", str(tmp_path))
        monkeypatch.setenv("USERPROFILE", str(tmp_path))  # Windows
        result = validate_local_file("~/test.png", 20)
        assert result == test_file.resolve()


class TestFileToBase64:
    """Test file_to_base64 function."""

    def test_convert_file(self, tmp_path):
        """Test file conversion to base64."""
        test_file = tmp_path / "test.png"
        test_data = b"fake image data"
        test_file.write_bytes(test_data)

        result = file_to_base64(test_file)
        assert result.startswith("data:image/png;base64,")

        # Verify the base64 content
        base64_part = result.split(",")[1]
        decoded = base64.b64decode(base64_part)
        assert decoded == test_data


class TestValidateUrl:
    """Test validate_url function."""

    def test_empty_url(self):
        """Test empty URL raises error."""
        with pytest.raises(ValueError, match="cannot be empty"):
            validate_url("")

    def test_invalid_url(self):
        """Test invalid URL raises error."""
        with pytest.raises(ValueError, match="must start with"):
            validate_url("ftp://example.com/image.png")

    def test_valid_http_url(self):
        """Test valid HTTP URL."""
        result = validate_url("http://example.com/image.png")
        assert result == "http://example.com/image.png"

    def test_valid_https_url(self):
        """Test valid HTTPS URL."""
        result = validate_url("https://example.com/image.png")
        assert result == "https://example.com/image.png"

    def test_data_url(self):
        """Test data URL."""
        result = validate_url("data:image/png;base64,abc123")
        assert result == "data:image/png;base64,abc123"

    def test_whitespace_trimming(self):
        """Test whitespace is trimmed."""
        result = validate_url("  https://example.com/image.png  ")
        assert result == "https://example.com/image.png"


class TestBuildImageContent:
    """Test build_image_content function."""

    def test_no_sources(self):
        """Test no sources raises error."""
        with pytest.raises(ValueError, match="At least one image required"):
            build_image_content()

    def test_single_local_file(self, tmp_path):
        """Test single local file."""
        test_file = tmp_path / "test.png"
        test_file.write_bytes(b"fake image data")

        content = build_image_content(image_path=str(test_file))
        assert len(content) == 1
        assert content[0]["type"] == "image"
        assert content[0]["source"]["type"] == "base64"
        assert content[0]["source"]["media_type"] == "image/png"

    def test_single_url(self):
        """Test single URL."""
        content = build_image_content(image_url="https://example.com/image.png")
        assert len(content) == 1
        assert content[0]["type"] == "image"
        assert content[0]["source"]["type"] == "url"
        assert content[0]["source"]["url"] == "https://example.com/image.png"

    def test_multiple_local_files(self, tmp_path):
        """Test multiple local files."""
        files = []
        for i in range(3):
            test_file = tmp_path / f"test{i}.png"
            test_file.write_bytes(b"fake image data")
            files.append(str(test_file))

        content = build_image_content(image_paths=files)
        assert len(content) == 3

    def test_multiple_urls(self):
        """Test multiple URLs."""
        urls = [
            "https://example.com/image1.png",
            "https://example.com/image2.png",
        ]
        content = build_image_content(image_urls=urls)
        assert len(content) == 2

    def test_too_many_files(self, tmp_path):
        """Test too many files raises error."""
        files = []
        for i in range(7):
            test_file = tmp_path / f"test{i}.png"
            test_file.write_bytes(b"fake image data")
            files.append(str(test_file))

        with pytest.raises(ValueError, match="Too many images"):
            build_image_content(image_paths=files, max_files=6)

    def test_mixed_sources(self, tmp_path):
        """Test mixed local and URL sources."""
        test_file = tmp_path / "test.png"
        test_file.write_bytes(b"fake image data")

        content = build_image_content(
            image_path=str(test_file),
            image_url="https://example.com/image.png",
        )
        assert len(content) == 2


class TestFormatErrorResponse:
    """Test format_error_response function."""

    def test_file_not_found(self):
        """Test file not found error."""
        error = FileNotFoundError("File not found: /path/to/file")
        result = format_error_response(error)
        assert result["success"] is False
        assert result["error_type"] == "file_not_found"

    def test_file_too_large(self):
        """Test file too large error."""
        error = ValueError("File too large: 50MB (max: 20MB)")
        result = format_error_response(error)
        assert result["success"] is False
        assert result["error_type"] == "file_too_large"

    def test_invalid_format(self):
        """Test invalid format error."""
        error = ValueError("Unsupported image format: .tiff")
        result = format_error_response(error)
        assert result["success"] is False
        assert result["error_type"] == "invalid_format"

    def test_invalid_url(self):
        """Test invalid URL error."""
        error = ValueError("URL must start with http:// or https://")
        result = format_error_response(error)
        assert result["success"] is False
        assert result["error_type"] == "invalid_url"

    def test_validation_error(self):
        """Test validation error."""
        error = ValueError("prompt cannot be empty")
        result = format_error_response(error)
        assert result["success"] is False
        assert result["error_type"] == "validation_error"

    def test_timeout_error(self):
        """Test timeout error."""
        error = TimeoutError("Request timed out")
        result = format_error_response(error)
        assert result["success"] is False
        assert result["error_type"] == "timeout"

    def test_unknown_error(self):
        """Test unknown error."""
        error = Exception("Something went wrong")
        result = format_error_response(error)
        assert result["success"] is False
        assert result["error_type"] == "unknown"

    def test_explicit_error_type(self):
        """Test explicit error type override."""
        error = ValueError("Some error")
        result = format_error_response(error, ErrorType.API_ERROR)
        assert result["error_type"] == "api_error"


class TestFormatSuccessResponse:
    """Test format_success_response function."""

    def test_success_response(self):
        """Test success response formatting."""
        analysis = {
            "description": "A cat sitting on a couch",
            "objects": ["cat", "couch"],
            "text_content": "",
            "scene": "Living room",
            "details": "Orange tabby cat",
        }
        result = format_success_response(
            analysis=analysis,
            model="mimo-v2.5",
            processing_time_ms=1500,
            tokens_used=500,
            image_count=1,
        )
        assert result["success"] is True
        assert result["analysis"] == analysis
        assert result["metadata"]["model"] == "mimo-v2.5"
        assert result["metadata"]["processing_time_ms"] == 1500
        assert result["metadata"]["tokens_used"] == 500
        assert result["metadata"]["image_count"] == 1
