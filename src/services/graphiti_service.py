"""Graphiti MCP Server communication service.

Provides methods to interact with the Graphiti MCP server for
searching nodes, facts, and managing episodes.
"""

import httpx
from typing import Any

from ..config import get_settings


class GraphitiClient:
    """Client for Graphiti MCP Server."""

    def __init__(self):
        self.settings = get_settings()
        self.base_url = self.settings.graphiti_mcp_url

    async def health_check(self) -> dict:
        """Check if the MCP server is healthy."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/health")
                if response.status_code == 200:
                    return {"healthy": True, "data": response.json()}
                return {"healthy": False, "error": f"Status {response.status_code}"}
        except Exception as e:
            return {"healthy": False, "error": str(e)}

    async def get_status(self) -> dict:
        """Get server status including graph statistics."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/status")
                if response.status_code == 200:
                    return {"success": True, "data": response.json()}
                return {"success": False, "error": f"Status {response.status_code}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict:
        """Call an MCP tool via the server.

        The Graphiti MCP server exposes tools via JSON-RPC at /mcp/ endpoint.
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # MCP uses JSON-RPC 2.0 format
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments,
                    },
                }

                response = await client.post(
                    f"{self.base_url}/mcp/",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    follow_redirects=True,
                )

                if response.status_code == 200:
                    result = response.json()
                    if "error" in result:
                        return {"success": False, "error": result["error"]}
                    return {"success": True, "data": result.get("result", {})}
                return {"success": False, "error": f"HTTP {response.status_code}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def search_nodes(
        self,
        query: str,
        limit: int = 10,
        entity_types: list[str] | None = None,
        group_ids: list[str] | None = None,
    ) -> dict:
        """Search for nodes (entities) in the knowledge graph.

        Args:
            query: Search query
            limit: Maximum number of results
            entity_types: Filter by entity types
            group_ids: Filter by group IDs
        """
        arguments = {
            "query": query,
            "limit": limit,
        }
        if entity_types:
            arguments["entity_types"] = entity_types
        if group_ids:
            arguments["group_ids"] = group_ids

        return await self.call_tool("search_nodes", arguments)

    async def search_facts(
        self,
        query: str,
        limit: int = 10,
        group_ids: list[str] | None = None,
    ) -> dict:
        """Search for facts (relationships) in the knowledge graph.

        Args:
            query: Search query
            limit: Maximum number of results
            group_ids: Filter by group IDs
        """
        arguments = {
            "query": query,
            "limit": limit,
        }
        if group_ids:
            arguments["group_ids"] = group_ids

        return await self.call_tool("search_facts", arguments)

    async def get_episodes(
        self,
        limit: int = 10,
        group_ids: list[str] | None = None,
    ) -> dict:
        """Get recent episodes from the knowledge graph.

        Args:
            limit: Maximum number of results
            group_ids: Filter by group IDs
        """
        arguments = {"limit": limit}
        if group_ids:
            arguments["group_ids"] = group_ids

        return await self.call_tool("get_episodes", arguments)

    async def delete_episode(self, episode_uuid: str) -> dict:
        """Delete an episode from the knowledge graph.

        Args:
            episode_uuid: UUID of the episode to delete
        """
        return await self.call_tool("delete_episode", {"episode_uuid": episode_uuid})

    async def add_episode(
        self,
        name: str,
        content: str,
        source: str = "text",
        source_description: str = "",
        group_id: str | None = None,
    ) -> dict:
        """Add an episode to create nodes/edges with embeddings.

        This is used for manual graph editing - the episode content describes
        what entity or relationship to create, and Graphiti extracts it.

        Args:
            name: Name/title of the episode
            content: Episode body text describing entities/relationships
            source: Source type (default "text")
            source_description: Description of where this came from
            group_id: Graph/group to add to
        """
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                payload = {
                    "name": name,
                    "episode_body": content,
                    "source": source,
                    "source_description": source_description,
                }
                if group_id:
                    payload["group_id"] = group_id

                response = await client.post(
                    f"{self.base_url}/episode",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )

                if response.status_code == 200:
                    return response.json()
                return {"success": False, "error": f"HTTP {response.status_code}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def delete_entity_node(self, uuid: str) -> dict:
        """Delete an entity node from the knowledge graph.

        Args:
            uuid: UUID of the entity to delete
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.delete(f"{self.base_url}/entity/{uuid}")
                if response.status_code == 200:
                    return response.json()
                return {"success": False, "error": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def delete_entity_edge(self, uuid: str) -> dict:
        """Delete an entity edge (relationship) from the knowledge graph.

        Args:
            uuid: UUID of the edge to delete
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.delete(f"{self.base_url}/edge/{uuid}")
                if response.status_code == 200:
                    return response.json()
                return {"success": False, "error": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def update_entity_node(self, uuid: str, name: str | None = None, summary: str | None = None) -> dict:
        """Update an entity node in the knowledge graph.

        Args:
            uuid: UUID of the entity to update
            name: New name (optional)
            summary: New summary (optional)
        """
        try:
            payload = {}
            if name is not None:
                payload["name"] = name
            if summary is not None:
                payload["summary"] = summary

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.put(
                    f"{self.base_url}/entity/{uuid}",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code == 200:
                    return response.json()
                return {"success": False, "error": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def update_entity_edge(self, uuid: str, name: str | None = None, fact: str | None = None) -> dict:
        """Update an entity edge in the knowledge graph.

        Args:
            uuid: UUID of the edge to update
            name: New name/type (optional)
            fact: New fact (optional)
        """
        try:
            payload = {}
            if name is not None:
                payload["name"] = name
            if fact is not None:
                payload["fact"] = fact

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.put(
                    f"{self.base_url}/edge/{uuid}",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code == 200:
                    return response.json()
                return {"success": False, "error": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def create_entity_direct(
        self,
        name: str,
        entity_type: str = "Entity",
        summary: str = "",
        group_id: str | None = None,
        attributes: dict[str, str] | None = None,
    ) -> dict:
        """Create an entity node directly without LLM processing.

        Args:
            name: Entity name
            entity_type: Type label (e.g., Person, Organization)
            summary: Entity description
            group_id: Graph/group to add to
            attributes: Optional structured attributes
        """
        try:
            payload = {
                "name": name,
                "entity_type": entity_type,
                "summary": summary,
            }
            if group_id:
                payload["group_id"] = group_id
            if attributes:
                payload["attributes"] = attributes

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/entity",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code == 200:
                    return response.json()
                return {"success": False, "error": f"HTTP {response.status_code}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def create_edge_direct(
        self,
        source_uuid: str,
        target_uuid: str,
        name: str,
        fact: str = "",
        group_id: str | None = None,
    ) -> dict:
        """Create an edge directly without LLM processing.

        Args:
            source_uuid: UUID of source node
            target_uuid: UUID of target node
            name: Relationship type (e.g., WORKS_AT)
            fact: Description of the relationship
            group_id: Graph/group to add to
        """
        try:
            payload = {
                "source_uuid": source_uuid,
                "target_uuid": target_uuid,
                "name": name,
                "fact": fact,
            }
            if group_id:
                payload["group_id"] = group_id

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/edge",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code == 200:
                    return response.json()
                return {"success": False, "error": f"HTTP {response.status_code}"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def send_knowledge(self, content: str, group_id: str | None = None) -> dict:
        """Send knowledge text to LLM for extraction.

        The LLM will analyze the text and extract entities/relationships.

        Args:
            content: Free-form text for LLM to process
            group_id: Graph/group to add extracted data to
        """
        return await self.add_episode(
            name="Knowledge Input",
            content=content,
            source="text",
            source_description="Manual knowledge input via UI",
            group_id=group_id,
        )


# Global client instance
_client: GraphitiClient | None = None


def get_graphiti_client() -> GraphitiClient:
    """Get the Graphiti client singleton."""
    global _client
    if _client is None:
        _client = GraphitiClient()
    return _client
