"""Tests for configuration module."""

import os
import pytest
from unittest.mock import patch

from vision_router_mcp.config import VisionRouterConfig, load_config, get_config_summary


class TestVisionRouterConfig:
    """Test VisionRouterConfig dataclass."""

    def test_valid_config(self):
        """Test creating a valid configuration."""
        config = VisionRouterConfig(
            api_key="test-key-1234567890",
            api_base="https://api.example.com/anthropic",
            model="mimo-v2.5",
            max_image_size_mb=20,
            max_images=6,
        )
        assert config.api_key == "test-key-1234567890"
        assert config.api_base == "https://api.example.com/anthropic"
        assert config.model == "mimo-v2.5"
        assert config.max_image_size_mb == 20
        assert config.max_images == 6

    def test_validate_missing_api_key(self):
        """Test validation with missing API key."""
        config = VisionRouterConfig(
            api_key="",
            api_base="https://api.example.com",
            model="mimo-v2.5",
            max_image_size_mb=20,
            max_images=6,
        )
        errors = config.validate()
        assert "MIMO_API_KEY is required" in errors

    def test_validate_missing_api_base(self):
        """Test validation with missing API base."""
        config = VisionRouterConfig(
            api_key="test-key",
            api_base="",
            model="mimo-v2.5",
            max_image_size_mb=20,
            max_images=6,
        )
        errors = config.validate()
        assert "MIMO_API_BASE is required" in errors

    def test_validate_missing_model(self):
        """Test validation with missing model."""
        config = VisionRouterConfig(
            api_key="test-key",
            api_base="https://api.example.com",
            model="",
            max_image_size_mb=20,
            max_images=6,
        )
        errors = config.validate()
        assert "MIMO_MODEL is required" in errors

    def test_validate_invalid_max_image_size(self):
        """Test validation with invalid max image size."""
        config = VisionRouterConfig(
            api_key="test-key",
            api_base="https://api.example.com",
            model="mimo-v2.5",
            max_image_size_mb=0,
            max_images=6,
        )
        errors = config.validate()
        assert "MIMO_MAX_IMAGE_SIZE_MB must be positive" in errors

    def test_validate_invalid_max_images(self):
        """Test validation with invalid max images."""
        config = VisionRouterConfig(
            api_key="test-key",
            api_base="https://api.example.com",
            model="mimo-v2.5",
            max_image_size_mb=20,
            max_images=-1,
        )
        errors = config.validate()
        assert "MIMO_MAX_IMAGES must be positive" in errors

    def test_validate_all_valid(self):
        """Test validation with all valid values."""
        config = VisionRouterConfig(
            api_key="test-key",
            api_base="https://api.example.com",
            model="mimo-v2.5",
            max_image_size_mb=20,
            max_images=6,
        )
        errors = config.validate()
        assert len(errors) == 0


class TestLoadConfig:
    """Test load_config function."""

    @patch.dict(os.environ, {
        "MIMO_API_KEY": "test-key",
        "MIMO_API_BASE": "https://api.example.com",
        "MIMO_MODEL": "mimo-v2.5",
    })
    def test_load_config_success(self):
        """Test successful config loading."""
        config = load_config()
        assert config.api_key == "test-key"
        assert config.api_base == "https://api.example.com"
        assert config.model == "mimo-v2.5"

    @patch.dict(os.environ, {}, clear=True)
    def test_load_config_missing_vars(self):
        """Test config loading with missing variables."""
        with pytest.raises(RuntimeError, match="Missing required configuration"):
            load_config()

    @patch.dict(os.environ, {
        "MIMO_API_KEY": "test-key",
        "MIMO_API_BASE": "https://api.example.com",
        "MIMO_MODEL": "mimo-v2.5",
        "MIMO_MAX_IMAGE_SIZE_MB": "50",
        "MIMO_MAX_IMAGES": "10",
    })
    def test_load_config_custom_values(self):
        """Test config loading with custom values."""
        config = load_config()
        assert config.max_image_size_mb == 50
        assert config.max_images == 10


class TestGetConfigSummary:
    """Test get_config_summary function."""

    def test_summary_with_long_key(self):
        """Test summary with long API key."""
        config = VisionRouterConfig(
            api_key="abcdefghijklmnop",
            api_base="https://api.example.com",
            model="mimo-v2.5",
            max_image_size_mb=20,
            max_images=6,
        )
        summary = get_config_summary(config)
        assert "abcdef...mnop" in summary
        assert "mimo-v2.5" in summary

    def test_summary_with_short_key(self):
        """Test summary with short API key."""
        config = VisionRouterConfig(
            api_key="short",
            api_base="https://api.example.com",
            model="mimo-v2.5",
            max_image_size_mb=20,
            max_images=6,
        )
        summary = get_config_summary(config)
        assert "***" in summary

    def test_summary_with_empty_key(self):
        """Test summary with empty API key."""
        config = VisionRouterConfig(
            api_key="",
            api_base="https://api.example.com",
            model="mimo-v2.5",
            max_image_size_mb=20,
            max_images=6,
        )
        summary = get_config_summary(config)
        assert "not set" in summary
