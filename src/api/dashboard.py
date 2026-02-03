"""Dashboard API routes."""

import os
import re
from typing import Any

from fastapi import APIRouter
import httpx

from ..auth.dependencies import CurrentUser
from ..config import get_settings
from ..services.config_service import read_config
from ..services.graphiti_service import get_graphiti_client

router = APIRouter()


def expand_env_vars(value: str) -> str:
    """Expand environment variables in a string.

    Supports ${VAR} and ${VAR:default} syntax.
    """
    if not isinstance(value, str):
        return value

    pattern = r'\$\{([^}:]+)(?::([^}]*))?\}'

    def replacer(match: re.Match) -> str:
        var_name = match.group(1)
        default = match.group(2) or ""
        return os.environ.get(var_name, default)

    return re.sub(pattern, replacer, value)


def get_llm_config(config: dict[str, Any]) -> dict[str, str]:
    """Extract and expand LLM configuration."""
    llm = config.get("llm", {})
    provider = llm.get("provider", "openai")
    model = expand_env_vars(llm.get("model", ""))

    providers = llm.get("providers", {})
    provider_config = providers.get(provider, {})

    api_url = expand_env_vars(provider_config.get("api_url", ""))
    api_key = expand_env_vars(provider_config.get("api_key", ""))

    return {
        "provider": provider,
        "model": model,
        "api_url": api_url,
        "api_key": api_key,
    }


def get_embedder_config(config: dict[str, Any]) -> dict[str, str]:
    """Extract and expand embedder configuration."""
    embedder = config.get("embedder", {})
    provider = embedder.get("provider", "openai")
    model = expand_env_vars(embedder.get("model", ""))

    providers = embedder.get("providers", {})
    provider_config = providers.get(provider, {})

    api_url = expand_env_vars(provider_config.get("api_url", ""))
    api_key = expand_env_vars(provider_config.get("api_key", ""))

    return {
        "provider": provider,
        "model": model,
        "api_url": api_url,
        "api_key": api_key,
    }


@router.get("/stats")
async def get_dashboard_stats(current_user: CurrentUser) -> dict:
    """Get dashboard statistics using Graphiti (DB-neutral)."""
    try:
        client = get_graphiti_client()
        result = await client.get_graph_stats()

        if result.get("success"):
            stats = result.get("stats", {})
            return {
                "episodes_count": stats.get("episodes", 0),
                "entities_count": stats.get("nodes", 0),
                "relationships_count": stats.get("edges", 0),
                "last_activity": None,  # TODO: Track last activity time
            }
        else:
            return {
                "episodes_count": 0,
                "entities_count": 0,
                "relationships_count": 0,
                "last_activity": None,
                "error": result.get("error"),
            }
    except Exception as e:
        return {
            "episodes_count": 0,
            "entities_count": 0,
            "relationships_count": 0,
            "last_activity": None,
            "error": str(e),
        }


async def check_model_availability(
    api_url: str,
    api_key: str,
    model_name: str,
) -> dict[str, Any]:
    """Check if a model is available at the given API endpoint.

    Returns dict with status, available models, and error message if any.
    """
    if not api_url:
        return {"status": "unconfigured", "error": "API URL not configured"}

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{api_url}/models", headers=headers)

            if response.status_code != 200:
                return {
                    "status": "error",
                    "error": f"API returned {response.status_code}",
                }

            data = response.json()
            models = data.get("data", [])
            model_ids = [m.get("id", "") for m in models]

            # Check if configured model exists
            # Handle both exact match and prefix match (e.g., "llama3" vs "llama3:latest")
            model_found = any(
                model_name == mid or mid.startswith(f"{model_name}:")
                for mid in model_ids
            )

            if model_found:
                return {
                    "status": "healthy",
                    "model": model_name,
                    "available_models": model_ids,
                }
            else:
                return {
                    "status": "model_not_found",
                    "error": f"Model '{model_name}' not found",
                    "configured_model": model_name,
                    "available_models": model_ids,
                }

    except httpx.TimeoutException:
        return {"status": "timeout", "error": "Connection timed out"}
    except httpx.ConnectError:
        return {"status": "unreachable", "error": "Could not connect to API"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.get("/status")
async def get_service_status(current_user: CurrentUser) -> dict:
    """Get status of all services."""
    settings = get_settings()
    config = read_config()

    # Check graph database via driver's health_check (DB-neutral)
    from ..services.queue_service import get_queue_service
    from ..services.graphiti_service import get_graphiti_client

    graphiti_status = "unknown"
    try:
        client = get_graphiti_client()
        health = await client.health_check()
        graphiti_status = "healthy" if health.get("healthy") else "unreachable"
    except Exception:
        graphiti_status = "unreachable"

    # Check LLM
    llm_config = get_llm_config(config)
    llm_check = await check_model_availability(
        llm_config["api_url"],
        llm_config["api_key"],
        llm_config["model"],
    )

    # Check Embedder
    embedder_config = get_embedder_config(config)
    embedder_check = await check_model_availability(
        embedder_config["api_url"],
        embedder_config["api_key"],
        embedder_config["model"],
    )

    # Check queue status via MCP
    queue_status = {"total_pending": 0, "currently_processing": 0, "error": None}
    try:
        queue_service = get_queue_service()
        status = await queue_service.get_status()
        queue_status["total_pending"] = status.get("pending_count", 0)
        queue_status["currently_processing"] = 1 if status.get("processing", False) else 0
    except Exception as e:
        queue_status["error"] = str(e)

    return {
        "graphiti_mcp": {
            "status": graphiti_status,
            "url": settings.graphiti_mcp_url,
        },
        "graph_database": {
            "status": graphiti_status,
            "provider": settings.graph_provider,
            "browser_url": settings.falkordb_browser_url if settings.graph_provider == "falkordb" else None,
        },
        "llm": {
            "status": llm_check["status"],
            "provider": llm_config["provider"],
            "model": llm_config["model"],
            "api_url": llm_config["api_url"],
            **({k: v for k, v in llm_check.items() if k != "status"}),
        },
        "embedder": {
            "status": embedder_check["status"],
            "provider": embedder_config["provider"],
            "model": embedder_config["model"],
            "api_url": embedder_config["api_url"],
            **({k: v for k, v in embedder_check.items() if k != "status"}),
        },
        "queue": queue_status,
    }
