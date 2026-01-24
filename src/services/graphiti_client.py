"""Graphiti MCP Server client."""

from typing import Any

import httpx

from ..config import get_settings


class GraphitiClient:
    """Client for interacting with Graphiti MCP Server."""

    def __init__(self) -> None:
        settings = get_settings()
        self.base_url = settings.graphiti_mcp_url
        self.mcp_url = f"{self.base_url}/mcp"

    async def health_check(self) -> dict[str, Any]:
        """Check Graphiti MCP server health."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{self.base_url}/health")
            response.raise_for_status()
            return response.json()

    async def get_status(self) -> dict[str, Any]:
        """Get Graphiti server status via MCP."""
        # TODO: Implement MCP tool call
        # MCP uses JSON-RPC style requests
        return {"status": "not_implemented"}

    async def search_nodes(
        self,
        query: str,
        entity_types: list[str] | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        """Search for nodes in the knowledge graph."""
        # TODO: Implement MCP search_nodes tool call
        return {"results": [], "query": query}

    async def search_facts(self, query: str, limit: int = 10) -> dict[str, Any]:
        """Search for facts in the knowledge graph."""
        # TODO: Implement MCP search_facts tool call
        return {"results": [], "query": query}

    async def add_episode(
        self,
        name: str,
        content: str,
        source: str = "text",
        source_description: str | None = None,
        group_id: str | None = None,
    ) -> dict[str, Any]:
        """Add an episode to the knowledge graph."""
        # TODO: Implement MCP add_episode tool call
        return {"status": "not_implemented"}

    async def get_episodes(
        self,
        group_id: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Get recent episodes."""
        # TODO: Implement MCP get_episodes tool call
        return []

    async def delete_episode(self, uuid: str) -> dict[str, Any]:
        """Delete an episode."""
        # TODO: Implement MCP delete_episode tool call
        return {"status": "not_implemented"}


# Singleton instance
_client: GraphitiClient | None = None


def get_graphiti_client() -> GraphitiClient:
    """Get or create Graphiti client instance."""
    global _client
    if _client is None:
        _client = GraphitiClient()
    return _client
