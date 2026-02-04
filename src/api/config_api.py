"""Configuration API routes.

Configuration is read-only from environment variables.
To change settings, edit .env or docker-compose.yml and restart the stack.
"""

from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from ..auth.dependencies import CurrentUser
from ..services.config_service import read_config
from ..services.credentials_service import (
    get_llm_credentials,
    get_embedder_credentials,
)

router = APIRouter()


# ============================================
# Configuration Models
# ============================================


class LLMConfigResponse(BaseModel):
    """LLM configuration response."""

    api_url: str
    model: str


class EmbedderConfigResponse(BaseModel):
    """Embedder configuration response."""

    api_url: str
    model: str
    dimensions: int


class LLMStatusResponse(BaseModel):
    """LLM status response with connectivity check."""

    api_url: str
    model: str
    reachable: bool
    model_available: bool = False
    available_models: list[str] = []
    error: str | None = None


class EmbedderStatusResponse(BaseModel):
    """Embedder status response with connectivity check."""

    api_url: str
    model: str
    dimensions: int
    reachable: bool
    model_available: bool = False
    available_models: list[str] = []
    error: str | None = None


# ============================================
# Helper Functions
# ============================================


async def _check_model_availability(
    api_url: str, api_key: str, model: str
) -> dict[str, Any]:
    """Check model availability at an API endpoint.

    Returns dict with reachable, model_available, available_models, error.
    """
    if not api_url:
        return {
            "reachable": False,
            "model_available": False,
            "available_models": [],
            "error": "API URL not configured",
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            response = await client.get(f"{api_url}/models", headers=headers)
            reachable = response.status_code == 200
            if reachable:
                data = response.json()
                models = data.get("data", [])
                available_models = [m.get("id", "") for m in models]
                model_available = any(
                    model == mid or mid.startswith(f"{model}:")
                    for mid in available_models
                )
                error = None if model_available else f"Model '{model}' not found in available models"
                return {
                    "reachable": True,
                    "model_available": model_available,
                    "available_models": available_models,
                    "error": error,
                }
            return {
                "reachable": False,
                "model_available": False,
                "available_models": [],
                "error": f"HTTP {response.status_code}",
            }
    except httpx.TimeoutException:
        return {
            "reachable": False,
            "model_available": False,
            "available_models": [],
            "error": "Connection timeout",
        }
    except Exception as e:
        return {
            "reachable": False,
            "model_available": False,
            "available_models": [],
            "error": str(e)[:100],
        }


# ============================================
# LLM Endpoints
# ============================================


@router.get("/llm", response_model=LLMConfigResponse)
async def get_llm_config(current_user: CurrentUser) -> LLMConfigResponse:
    """Get current LLM configuration (from environment variables)."""
    creds = get_llm_credentials()
    return LLMConfigResponse(
        api_url=creds.get("api_url", ""),
        model=creds.get("model", ""),
    )


@router.get("/llm/status", response_model=LLMStatusResponse)
async def get_llm_status(current_user: CurrentUser) -> LLMStatusResponse:
    """Get LLM configuration with connectivity and model availability status."""
    creds = get_llm_credentials()
    api_url = creds.get("api_url", "")
    api_key = creds.get("api_key", "")
    model = creds.get("model", "")

    status = await _check_model_availability(api_url, api_key, model)

    return LLMStatusResponse(
        api_url=api_url,
        model=model,
        reachable=status["reachable"],
        model_available=status["model_available"],
        available_models=status["available_models"],
        error=status["error"],
    )


# ============================================
# Embedder Endpoints
# ============================================


@router.get("/embedder", response_model=EmbedderConfigResponse)
async def get_embedder_config(current_user: CurrentUser) -> EmbedderConfigResponse:
    """Get current embedder configuration (from environment variables)."""
    creds = get_embedder_credentials()
    return EmbedderConfigResponse(
        api_url=creds.get("api_url", ""),
        model=creds.get("model", ""),
        dimensions=creds.get("dimensions", 768),
    )


@router.get("/embedder/status", response_model=EmbedderStatusResponse)
async def get_embedder_status(current_user: CurrentUser) -> EmbedderStatusResponse:
    """Get Embedder configuration with connectivity and model availability status."""
    creds = get_embedder_credentials()
    api_url = creds.get("api_url", "")
    api_key = creds.get("api_key", "")
    model = creds.get("model", "")
    dimensions = creds.get("dimensions", 768)

    status = await _check_model_availability(api_url, api_key, model)

    return EmbedderStatusResponse(
        api_url=api_url,
        model=model,
        dimensions=dimensions,
        reachable=status["reachable"],
        model_available=status["model_available"],
        available_models=status["available_models"],
        error=status["error"],
    )


# ============================================
# General Config Endpoints
# ============================================


@router.get("")
async def get_full_config(current_user: CurrentUser) -> dict:
    """Get full configuration from config.yaml (masked)."""
    config = read_config()

    # Mask sensitive values
    if "llm" in config and "providers" in config["llm"]:
        for provider in config["llm"]["providers"].values():
            if isinstance(provider, dict) and "api_key" in provider:
                if not str(provider["api_key"]).startswith("${"):
                    provider["api_key"] = "***"

    if "embedder" in config and "providers" in config["embedder"]:
        for provider in config["embedder"]["providers"].values():
            if isinstance(provider, dict) and "api_key" in provider:
                if not str(provider["api_key"]).startswith("${"):
                    provider["api_key"] = "***"

    return {"config": config}
