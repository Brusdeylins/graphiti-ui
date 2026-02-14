# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""API module."""

from fastapi import APIRouter

from .dashboard import router as dashboard_router
from .config_api import router as config_router
from .entity_types import router as entity_types_router
from .query import router as query_router
from .graph_api import router as graph_router
from .api_keys_api import router as api_keys_router
from .docker_api import router as docker_router

router = APIRouter()

# Health check (no auth required)
@router.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {"healthy": True, "status": "healthy", "service": "graphiti-ui"}


# Include sub-routers
router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
router.include_router(config_router, prefix="/config", tags=["config"])
router.include_router(entity_types_router, prefix="/entity-types", tags=["entity-types"])
router.include_router(query_router, prefix="/query", tags=["query"])
router.include_router(graph_router, prefix="/graph", tags=["graph"])
router.include_router(api_keys_router, prefix="/api-keys", tags=["api-keys"])
router.include_router(docker_router, prefix="/docker", tags=["docker"])
