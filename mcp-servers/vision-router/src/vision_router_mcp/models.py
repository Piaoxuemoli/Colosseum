"""Data models for Vision Router MCP Server."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ErrorType(str, Enum):
    """Error types for structured error responses."""

    FILE_NOT_FOUND = "file_not_found"
    FILE_TOO_LARGE = "file_too_large"
    INVALID_FORMAT = "invalid_format"
    INVALID_URL = "invalid_url"
    API_ERROR = "api_error"
    TIMEOUT = "timeout"
    VALIDATION_ERROR = "validation_error"
    UNKNOWN = "unknown"


class ImageAnalysis(BaseModel):
    """Structured analysis result from vision model."""

    model_config = ConfigDict(frozen=True)

    description: str = Field(description="Detailed description of the image")
    objects: list[str] = Field(default_factory=list, description="Objects detected in the image")
    text_content: str = Field(default="", description="Text extracted from the image (OCR)")
    scene: str = Field(default="", description="Scene description")
    details: str = Field(default="", description="Additional details or observations")


class AnalysisMetadata(BaseModel):
    """Metadata about the analysis process."""

    model_config = ConfigDict(frozen=True)

    model: str = Field(description="Model used for analysis")
    processing_time_ms: int = Field(description="Processing time in milliseconds")
    tokens_used: int = Field(default=0, description="Tokens used in the API call")
    image_count: int = Field(default=1, description="Number of images analyzed")
    timestamp: datetime = Field(default_factory=datetime.now, description="Analysis timestamp")


class SuccessResponse(BaseModel):
    """Successful analysis response."""

    success: bool = Field(default=True)
    analysis: ImageAnalysis
    metadata: AnalysisMetadata


class ErrorResponse(BaseModel):
    """Error response."""

    success: bool = Field(default=False)
    error: str = Field(description="Human-readable error message")
    error_type: ErrorType = Field(description="Structured error type")


class ImageInput(BaseModel):
    """Input parameters for image analysis."""

    prompt: str = Field(description="Analysis task description")
    image_path: str | None = Field(default=None, description="Path to a single local image")
    image_url: str | None = Field(default=None, description="URL of a single remote image")
    image_paths: list[str] | None = Field(
        default=None, description="List of paths to local images"
    )
    image_urls: list[str] | None = Field(
        default=None, description="List of URLs to remote images"
    )
    system_prompt: str | None = Field(
        default=None, description="Optional system prompt for the model"
    )
    temperature: float = Field(default=0.2, ge=0, le=2, description="Randomness (0-2)")
    max_tokens: int = Field(default=12000, ge=1, le=32000, description="Maximum response length")

    @field_validator("prompt")
    @classmethod
    def prompt_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("prompt cannot be empty")
        return v.strip()

    @field_validator("image_paths", "image_urls")
    @classmethod
    def validate_list(cls, v: list[str] | None) -> list[str] | None:
        if v is not None and len(v) == 0:
            return None
        return v

    def has_image_source(self) -> bool:
        """Check if at least one image source is provided."""
        return any([
            self.image_path,
            self.image_url,
            self.image_paths,
            self.image_urls,
        ])

    def get_all_sources(self) -> list[str]:
        """Get all image sources as a flat list."""
        sources = []
        if self.image_path:
            sources.append(f"local:{self.image_path}")
        if self.image_paths:
            sources.extend(f"local:{p}" for p in self.image_paths)
        if self.image_url:
            sources.append(f"url:{self.image_url}")
        if self.image_urls:
            sources.append(f"url:{u}" for u in self.image_urls)
        return sources
