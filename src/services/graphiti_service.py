"""Graphiti service with direct graphiti_core integration.

Replaces HTTP-based MCP proxy with direct FalkorDB connection.
"""

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import httpx
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.edges import EntityEdge
from graphiti_core.embedder import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.errors import EdgeNotFoundError, NodeNotFoundError
from graphiti_core.nodes import EntityNode, EpisodicNode

from ..config import get_settings

logger = logging.getLogger(__name__)


class GraphitiClient:
    """Client for direct Graphiti operations via graphiti_core."""

    def __init__(self):
        self.settings = get_settings()
        self._driver: FalkorDriver | None = None
        self._embedder: OpenAIEmbedder | None = None

    @property
    def driver(self) -> FalkorDriver:
        """Lazy-initialize FalkorDB driver."""
        if self._driver is None:
            self._driver = FalkorDriver(
                host=self.settings.falkordb_host,
                port=self.settings.falkordb_port,
                password=self.settings.falkordb_password or None,
                database=self.settings.falkordb_database,
            )
        return self._driver

    @property
    def embedder(self) -> OpenAIEmbedder:
        """Lazy-initialize OpenAI embedder."""
        if self._embedder is None:
            config = OpenAIEmbedderConfig(
                api_key=self.settings.openai_api_key,
                base_url=self.settings.openai_api_url,
                embedding_model=self.settings.embedding_model,
                embedding_dim=self.settings.embedding_dim,
            )
            self._embedder = OpenAIEmbedder(config)
        return self._embedder

    def _get_driver(self, group_id: str | None = None) -> FalkorDriver:
        """Get driver for specific group_id (cloned if needed).

        Uses settings.graphiti_group_id as default if no group_id is provided.
        """
        effective_group_id = group_id or self.settings.graphiti_group_id
        return self.driver.clone(effective_group_id)  # type: ignore[return-value]

    # =========================================================================
    # Health & Status
    # =========================================================================

    async def health_check(self) -> dict:
        """Check if FalkorDB is healthy."""
        try:
            await self.driver.health_check()
            return {"healthy": True, "data": {"status": "healthy", "service": "graphiti-ui"}}
        except Exception as e:
            return {"healthy": False, "error": str(e)}

    async def get_status(self) -> dict:
        """Get server status including graph statistics."""
        try:
            stats = await self.get_graph_stats()
            return {"success": True, "data": stats}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # =========================================================================
    # Graph Data (for visualization)
    # =========================================================================

    async def get_graph_data(self, limit: int = 500, group_id: str | None = None) -> dict:
        """Get graph data for visualization."""
        try:
            driver = self._get_driver(group_id)

            # Query nodes - return full node to get all properties including attributes
            nodes_query = """
            MATCH (n:Entity)
            RETURN n, labels(n) AS labels
            LIMIT $limit
            """
            nodes_result, _, _ = await driver.execute_query(nodes_query, limit=limit)

            # Query edges
            edges_query = """
            MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
            RETURN a.uuid AS source, b.uuid AS target, r.uuid AS uuid,
                   r.name AS name, r.fact AS fact, r.group_id AS group_id
            LIMIT $limit
            """
            edges_result, _, _ = await driver.execute_query(edges_query, limit=limit)

            # Transform nodes - extract all properties from node object
            nodes = []
            for record in nodes_result:
                node_data = record.get("n", {})
                labels = record.get("labels", [])
                if "Entity" in labels:
                    labels = [l for l in labels if l != "Entity"]

                # Extract attributes (all properties except standard ones)
                standard_props = {"uuid", "name", "summary", "group_id", "created_at",
                                  "name_embedding", "summary_embedding"}
                attributes = {
                    k: v for k, v in node_data.items()
                    if k not in standard_props and not k.endswith("_embedding")
                }

                nodes.append({
                    "uuid": node_data.get("uuid"),
                    "name": node_data.get("name"),
                    "summary": node_data.get("summary", ""),
                    "group_id": node_data.get("group_id", ""),
                    "created_at": node_data.get("created_at"),
                    "labels": labels,
                    "entity_type": labels[0] if labels else "Entity",
                    "attributes": attributes,
                })

            # Transform edges
            edges = []
            for record in edges_result:
                edges.append({
                    "uuid": record["uuid"],
                    "source": record["source"],
                    "target": record["target"],
                    "name": record.get("name", ""),
                    "fact": record.get("fact", ""),
                    "group_id": record.get("group_id", ""),
                })

            return {"success": True, "nodes": nodes, "edges": edges}
        except Exception as e:
            logger.exception("Error getting graph data")
            return {"success": False, "nodes": [], "edges": [], "error": str(e)}

    async def get_group_ids(self) -> dict:
        """Get all available group IDs from FalkorDB.

        FalkorDB stores each group as a separate graph (Redis key with type 'graphdata').
        """
        try:
            import redis.asyncio as redis_async

            r = redis_async.Redis(
                host=self.settings.falkordb_host,
                port=self.settings.falkordb_port,
                password=self.settings.falkordb_password or None,
                decode_responses=True,
            )

            group_ids = []
            keys = await r.keys("*")

            for key in keys:
                # Skip internal/system keys
                if key.startswith("_") or key.startswith("graphiti:") or key.startswith("telemetry{"):
                    continue

                # Check if it's a FalkorDB graph
                key_type = await r.type(key)
                if key_type == "graphdata":
                    group_ids.append(key)

            await r.aclose()

            return {"success": True, "group_ids": sorted(group_ids)}
        except Exception as e:
            logger.exception("Error getting group IDs")
            return {"success": False, "group_ids": [], "error": str(e)}

    async def get_graph_stats(self, group_id: str | None = None) -> dict:
        """Get graph statistics."""
        try:
            driver = self._get_driver(group_id)

            # Count nodes
            node_query = "MATCH (n:Entity) RETURN count(n) AS count"
            node_result, _, _ = await driver.execute_query(node_query)
            node_count = node_result[0]["count"] if node_result else 0

            # Count edges
            edge_query = "MATCH ()-[r:RELATES_TO]->() RETURN count(r) AS count"
            edge_result, _, _ = await driver.execute_query(edge_query)
            edge_count = edge_result[0]["count"] if edge_result else 0

            # Count episodes
            episode_query = "MATCH (e:Episodic) RETURN count(e) AS count"
            episode_result, _, _ = await driver.execute_query(episode_query)
            episode_count = episode_result[0]["count"] if episode_result else 0

            return {
                "success": True,
                "stats": {
                    "nodes": node_count,
                    "edges": edge_count,
                    "episodes": episode_count,
                },
            }
        except Exception as e:
            logger.exception("Error getting graph stats")
            return {"success": False, "stats": {}, "error": str(e)}

    # =========================================================================
    # Node Operations
    # =========================================================================

    async def get_node_details(self, uuid: str, group_id: str | None = None) -> dict:
        """Get detailed information about a specific node."""
        try:
            driver = self._get_driver(group_id)
            node = await EntityNode.get_by_uuid(driver, uuid)
            return {
                "success": True,
                "node": {
                    "uuid": node.uuid,
                    "name": node.name,
                    "summary": node.summary,
                    "group_id": node.group_id,
                    "labels": node.labels,
                    "attributes": node.attributes,
                    "created_at": node.created_at.isoformat() if node.created_at else None,
                },
            }
        except NodeNotFoundError:
            return {"success": False, "error": f"Node {uuid} not found"}
        except Exception as e:
            logger.exception("Error getting node details")
            return {"success": False, "error": str(e)}

    async def create_entity_direct(
        self,
        name: str,
        entity_type: str = "Entity",
        summary: str = "",
        group_id: str | None = None,
        attributes: dict[str, str] | None = None,
    ) -> dict:
        """Create an entity node directly with embeddings."""
        try:
            driver = self._get_driver(group_id)

            labels = [entity_type] if entity_type and entity_type != "Entity" else []

            entity = EntityNode(
                uuid=str(uuid4()),
                name=name,
                summary=summary,
                group_id=group_id or self.settings.graphiti_group_id,
                labels=labels,
                attributes=attributes or {},
                created_at=datetime.now(timezone.utc),
            )

            # Generate embeddings
            await entity.generate_name_embedding(self.embedder)
            if summary:
                await entity.generate_summary_embedding(self.embedder)

            # Save to database
            await entity.save(driver)

            return {
                "success": True,
                "uuid": entity.uuid,
                "name": entity.name,
                "entity_type": entity_type,
            }
        except Exception as e:
            logger.exception("Error creating entity")
            return {"success": False, "error": str(e)}

    async def update_entity_node(
        self,
        uuid: str,
        name: str | None = None,
        summary: str | None = None,
        group_id: str | None = None,
        attributes: dict[str, str | None] | None = None,
    ) -> dict:
        """Update an entity node."""
        try:
            driver = self._get_driver(group_id)
            entity = await EntityNode.get_by_uuid(driver, uuid)

            # Update fields
            if name is not None:
                entity.name = name
            if summary is not None:
                entity.summary = summary
            if attributes:
                for key, value in attributes.items():
                    if value is None:
                        entity.attributes.pop(key, None)
                    else:
                        entity.attributes[key] = value

            # Regenerate embeddings if name or summary changed
            if name is not None:
                await entity.generate_name_embedding(self.embedder)
            if summary is not None and entity.summary:
                await entity.generate_summary_embedding(self.embedder)

            # Save changes
            await entity.save(driver)

            return {"success": True, "uuid": uuid}
        except NodeNotFoundError:
            return {"success": False, "error": f"Node {uuid} not found"}
        except Exception as e:
            logger.exception("Error updating entity")
            return {"success": False, "error": str(e)}

    async def delete_entity_node(self, uuid: str, group_id: str | None = None) -> dict:
        """Delete an entity node."""
        try:
            driver = self._get_driver(group_id)
            entity = await EntityNode.get_by_uuid(driver, uuid)
            await entity.delete(driver)
            return {"success": True, "deleted": uuid}
        except NodeNotFoundError:
            return {"success": False, "error": f"Node {uuid} not found"}
        except Exception as e:
            logger.exception("Error deleting entity")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # Edge Operations
    # =========================================================================

    async def get_edge_details(self, uuid: str, group_id: str | None = None) -> dict:
        """Get detailed information about a specific edge."""
        try:
            driver = self._get_driver(group_id)
            edge = await EntityEdge.get_by_uuid(driver, uuid)
            return {
                "success": True,
                "edge": {
                    "uuid": edge.uuid,
                    "name": edge.name,
                    "fact": edge.fact,
                    "source_node_uuid": edge.source_node_uuid,
                    "target_node_uuid": edge.target_node_uuid,
                    "group_id": edge.group_id,
                    "episodes": edge.episodes,
                    "attributes": edge.attributes,
                    "created_at": edge.created_at.isoformat() if edge.created_at else None,
                    "valid_at": edge.valid_at.isoformat() if edge.valid_at else None,
                    "invalid_at": edge.invalid_at.isoformat() if edge.invalid_at else None,
                },
            }
        except EdgeNotFoundError:
            return {"success": False, "error": f"Edge {uuid} not found"}
        except Exception as e:
            logger.exception("Error getting edge details")
            return {"success": False, "error": str(e)}

    async def create_edge_direct(
        self,
        source_uuid: str,
        target_uuid: str,
        name: str,
        fact: str = "",
        group_id: str | None = None,
    ) -> dict:
        """Create an edge directly with embeddings."""
        try:
            driver = self._get_driver(group_id)

            edge = EntityEdge(
                uuid=str(uuid4()),
                source_node_uuid=source_uuid,
                target_node_uuid=target_uuid,
                name=name,
                fact=fact or f"{name} relationship",
                group_id=group_id or self.settings.graphiti_group_id,
                episodes=[],
                created_at=datetime.now(timezone.utc),
            )

            # Generate embedding for fact
            if fact:
                await edge.generate_embedding(self.embedder)

            # Save to database
            await edge.save(driver)

            return {
                "success": True,
                "uuid": edge.uuid,
                "name": edge.name,
            }
        except Exception as e:
            logger.exception("Error creating edge")
            return {"success": False, "error": str(e)}

    async def update_entity_edge(
        self,
        uuid: str,
        name: str | None = None,
        fact: str | None = None,
        group_id: str | None = None,
    ) -> dict:
        """Update an entity edge."""
        try:
            driver = self._get_driver(group_id)
            edge = await EntityEdge.get_by_uuid(driver, uuid)

            # Update fields
            if name is not None:
                edge.name = name
            if fact is not None:
                edge.fact = fact

            # Regenerate embedding if fact changed
            if fact is not None:
                await edge.generate_embedding(self.embedder)

            # Save changes
            await edge.save(driver)

            return {"success": True, "uuid": uuid}
        except EdgeNotFoundError:
            return {"success": False, "error": f"Edge {uuid} not found"}
        except Exception as e:
            logger.exception("Error updating edge")
            return {"success": False, "error": str(e)}

    async def delete_entity_edge(self, uuid: str, group_id: str | None = None) -> dict:
        """Delete an entity edge."""
        try:
            driver = self._get_driver(group_id)
            edge = await EntityEdge.get_by_uuid(driver, uuid)
            await edge.delete(driver)
            return {"success": True, "deleted": uuid}
        except EdgeNotFoundError:
            return {"success": False, "error": f"Edge {uuid} not found"}
        except Exception as e:
            logger.exception("Error deleting edge")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # Episode Operations
    # =========================================================================

    async def get_episode_details(self, uuid: str, group_id: str | None = None) -> dict:
        """Get detailed information about a specific episode."""
        try:
            driver = self._get_driver(group_id)
            episode = await EpisodicNode.get_by_uuid(driver, uuid)
            return {
                "success": True,
                "episode": {
                    "uuid": episode.uuid,
                    "name": episode.name,
                    "content": episode.content,
                    "source": episode.source.value,
                    "source_description": episode.source_description,
                    "group_id": episode.group_id,
                    "entity_edges": episode.entity_edges,
                    "created_at": episode.created_at.isoformat() if episode.created_at else None,
                    "valid_at": episode.valid_at.isoformat() if episode.valid_at else None,
                },
            }
        except NodeNotFoundError:
            return {"success": False, "error": f"Episode {uuid} not found"}
        except Exception as e:
            logger.exception("Error getting episode details")
            return {"success": False, "error": str(e)}

    async def get_episodes(self, limit: int = 10, group_ids: list[str] | None = None) -> dict:
        """Get recent episodes."""
        try:
            if group_ids:
                driver = self._get_driver(group_ids[0])
            else:
                driver = self.driver

            episodes = await EpisodicNode.get_by_group_ids(
                driver,
                group_ids=group_ids or [self.settings.graphiti_group_id],
                limit=limit,
            )

            return {
                "success": True,
                "data": {
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": str([{
                                    "uuid": ep.uuid,
                                    "name": ep.name,
                                    "content": ep.content[:200] + "..." if len(ep.content) > 200 else ep.content,
                                    "source": ep.source.value,
                                    "group_id": ep.group_id,
                                    "created_at": ep.created_at.isoformat() if ep.created_at else None,
                                } for ep in episodes]),
                            }
                        ],
                    },
                },
            }
        except Exception as e:
            logger.exception("Error getting episodes")
            return {"success": False, "error": str(e)}

    async def delete_episode(self, episode_uuid: str) -> dict:
        """Delete an episode."""
        try:
            # Episodes don't have group_id in the API, so use default driver
            episode = await EpisodicNode.get_by_uuid(self.driver, episode_uuid)
            driver = self._get_driver(episode.group_id)
            await episode.delete(driver)
            return {"success": True, "deleted": episode_uuid}
        except NodeNotFoundError:
            return {"success": False, "error": f"Episode {episode_uuid} not found"}
        except Exception as e:
            logger.exception("Error deleting episode")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # Graph Management
    # =========================================================================

    async def delete_graph(self, group_id: str) -> dict:
        """Delete an entire graph (group)."""
        try:
            driver = self._get_driver(group_id)

            # Delete all nodes (edges are deleted with DETACH DELETE)
            await driver.execute_query("MATCH (n) DETACH DELETE n")

            return {"success": True, "deleted": group_id}
        except Exception as e:
            logger.exception("Error deleting graph")
            return {"success": False, "error": str(e)}

    async def rename_graph(self, group_id: str, new_name: str) -> dict:
        """Rename a graph (update all group_id references)."""
        try:
            driver = self._get_driver(group_id)

            # Update all nodes
            await driver.execute_query(
                "MATCH (n) WHERE n.group_id = $old_id SET n.group_id = $new_id",
                old_id=group_id,
                new_id=new_name,
            )

            # Update all edges
            await driver.execute_query(
                "MATCH ()-[r]->() WHERE r.group_id = $old_id SET r.group_id = $new_id",
                old_id=group_id,
                new_id=new_name,
            )

            return {"success": True, "old_name": group_id, "new_name": new_name}
        except Exception as e:
            logger.exception("Error renaming graph")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # MCP-Related Operations (proxy to MCP server)
    # =========================================================================

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict:
        """Call an MCP tool via the server (for LLM-based operations)."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
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
                    f"{self.settings.graphiti_mcp_url}/mcp/",
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
        """Search for nodes (via MCP for semantic search)."""
        arguments = {"query": query, "limit": limit}
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
        """Search for facts (via MCP for semantic search)."""
        arguments = {"query": query, "limit": limit}
        if group_ids:
            arguments["group_ids"] = group_ids
        return await self.call_tool("search_facts", arguments)

    async def add_episode(
        self,
        name: str,
        content: str,
        source: str = "text",
        source_description: str = "",
        group_id: str | None = None,
    ) -> dict:
        """Add an episode via MCP add_memory tool (requires LLM processing)."""
        arguments: dict[str, Any] = {
            "name": name,
            "episode_body": content,
            "source": source,
            "source_description": source_description,
        }
        if group_id:
            arguments["group_id"] = group_id

        return await self.call_tool("add_memory", arguments)

    async def send_knowledge(self, content: str, group_id: str | None = None) -> dict:
        """Send knowledge text to LLM for extraction."""
        return await self.add_episode(
            name="Knowledge Input",
            content=content,
            source="text",
            source_description="Manual knowledge input via UI",
            group_id=group_id,
        )

    # =========================================================================
    # Queue Status (direct Redis access)
    # =========================================================================

    async def get_queue_status(self) -> dict:
        """Get queue processing status."""
        from .queue_service import get_queue_service
        service = get_queue_service()
        return await service.get_status()

    # =========================================================================
    # Query Execution
    # =========================================================================

    async def execute_query(self, query: str, group_id: str | None = None) -> dict:
        """Execute a read-only Cypher query."""
        try:
            # Basic safety check - only allow read queries
            query_upper = query.strip().upper()
            if any(kw in query_upper for kw in ["DELETE", "REMOVE", "SET", "CREATE", "MERGE"]):
                return {"success": False, "error": "Only read queries are allowed"}

            driver = self._get_driver(group_id)
            records, header, _ = await driver.execute_query(query)

            return {
                "success": True,
                "results": records,
                "columns": header,
            }
        except Exception as e:
            logger.exception("Error executing query")
            return {"success": False, "error": str(e)}


# Global client instance
_client: GraphitiClient | None = None


def get_graphiti_client() -> GraphitiClient:
    """Get the Graphiti client singleton."""
    global _client
    if _client is None:
        _client = GraphitiClient()
    return _client
