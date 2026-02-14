# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Docker container management API routes."""

from fastapi import APIRouter

from ..auth.dependencies import CurrentUser
from ..services.docker_service import get_mcp_container_status, restart_mcp_container

router = APIRouter()


@router.get("/status")
async def get_container_status(current_user: CurrentUser) -> dict:
    """Get MCP container status."""
    return await get_mcp_container_status()


@router.post("/restart")
async def restart_container(current_user: CurrentUser) -> dict:
    """Restart MCP container."""
    return await restart_mcp_container()
