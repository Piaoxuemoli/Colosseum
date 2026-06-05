"""Configuration management for Vision Router MCP Server."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class VisionRouterConfig:
    """Immutable configuration for Vision Router."""

    api_key: str
    api_base: str
    model: str
    max_image_size_mb: int
    max_images: int

    def validate(self) -> list[str]:
        """Validate configuration and return list of errors."""
        errors = []
        if not self.api_key:
            errors.append("MIMO_API_KEY is required")
        if not self.api_base:
            errors.append("MIMO_API_BASE is required")
        if not self.model:
            errors.append("MIMO_MODEL is required")
        if self.max_image_size_mb <= 0:
            errors.append("MIMO_MAX_IMAGE_SIZE_MB must be positive")
        if self.max_images <= 0:
            errors.append("MIMO_MAX_IMAGES must be positive")
        return errors


def load_config() -> VisionRouterConfig:
    """Load configuration from environment variables.

    Returns:
        VisionRouterConfig instance

    Raises:
        RuntimeError: If required configuration is missing
    """
    api_key = os.getenv("MIMO_API_KEY", "").strip()
    api_base = os.getenv("MIMO_API_BASE", "").strip()
    model = os.getenv("MIMO_MODEL", "").strip()
    max_image_size_mb = int(os.getenv("MIMO_MAX_IMAGE_SIZE_MB", "20"))
    max_images = int(os.getenv("MIMO_MAX_IMAGES", "6"))

    config = VisionRouterConfig(
        api_key=api_key,
        api_base=api_base,
        model=model,
        max_image_size_mb=max_image_size_mb,
        max_images=max_images,
    )

    errors = config.validate()
    if errors:
        raise RuntimeError(
            f"Missing required configuration: {', '.join(errors)}. "
            "Please set these environment variables in your MCP config."
        )

    return config


def get_config_summary(config: VisionRouterConfig) -> str:
    """Get a human-readable summary of the configuration (with masked API key)."""
    key = config.api_key
    if len(key) >= 10:
        masked = f"{key[:6]}...{key[-4:]}"
    elif len(key) > 0:
        masked = "***"
    else:
        masked = "not set"

    return (
        f"MIMO_API_BASE={config.api_base}\n"
        f"MIMO_MODEL={config.model}\n"
        f"MIMO_API_KEY={masked}\n"
        f"\n"
        f"Image: max {config.max_images} files, "
        f"{config.max_image_size_mb}MB each\n"
    )
