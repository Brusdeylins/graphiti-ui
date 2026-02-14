# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Queue Status Service via MCP Server.

Polls queue status from MCP server's /queue/status endpoint (DB-neutral).
"""

import logging

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


class QueueService:
    """Service for monitoring queue status via MCP server."""

    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=5.0)
        return self._client

    async def get_status(self) -> dict:
        """Get queue processing status from MCP server.

        Returns:
            - processing: bool - whether queue is active
            - pending_count: int - total messages waiting
            - currently_processing: int - number of active workers
        """
        try:
            settings = get_settings()
            client = self._get_client()

            response = await client.get(f"{settings.graphiti_mcp_url}/queue/status")
            response.raise_for_status()

            data = response.json()
            total = data.get("total_pending", 0) + data.get("currently_processing", 0)

            return {
                "success": True,
                "processing": total > 0,
                "pending_count": data.get("total_pending", 0),
                "currently_processing": data.get("currently_processing", 0),
            }
        except httpx.RequestError as e:
            logger.debug(f"Error connecting to MCP server: {e}")
            return {
                "success": False,
                "processing": False,
                "pending_count": 0,
                "currently_processing": 0,
                "error": str(e),
            }
        except Exception as e:
            logger.error(f"Error getting queue status: {e}")
            return {
                "success": False,
                "processing": False,
                "pending_count": 0,
                "currently_processing": 0,
                "error": str(e),
            }

    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None


# Singleton instance
_queue_service: QueueService | None = None


def get_queue_service() -> QueueService:
    """Get the QueueService singleton."""
    global _queue_service
    if _queue_service is None:
        _queue_service = QueueService()
    return _queue_service
