"""Graphiti service with Graphiti class CRUD integration.

Uses the Graphiti class facade for CRUD operations with auto-embedding generation.
"""

import logging
from typing import Any

import httpx
from graphiti_core import Graphiti
from graphiti_core.driver.driver import GraphDriver
from graphiti_core.embedder import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.errors import EdgeNotFoundError, NodeNotFoundError

from ..config import get_settings
from .driver_factory import create_driver

logger = logging.getLogger(__name__)


class GraphitiClient:
    """Client for Graphiti operations via graphiti_core Graphiti class."""

    def __init__(self):
        self.settings = get_settings()
        self._driver: GraphDriver | None = None
        self._embedder: OpenAIEmbedder | None = None
        self._graphiti_instances: dict[str, Graphiti] = {}

    @property
    def driver(self) -> GraphDriver:
        """Lazy-initialize graph driver based on config."""
        if self._driver is None:
            self._driver = create_driver(self.settings)
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

    def _get_driver(self, group_id: str | None = None) -> GraphDriver:
        """Get driver for specific group_id.

        Uses settings.graphiti_group_id as default if no group_id is provided.
        For FalkorDB: clones driver for separate graph.
        For Neo4j/Kuzu: uses with_database (group_id is a property, not separate DB).
        """
        effective_group_id = group_id or self.settings.graphiti_group_id
        # Use clone() for FalkorDB (separate graphs), with_database() for others
        if hasattr(self.driver, 'clone'):
            return self.driver.clone(effective_group_id)
        return self.driver.with_database(effective_group_id)

    def _get_graphiti(self, group_id: str | None = None) -> Graphiti:
        """Get Graphiti instance for specific group_id (cached)."""
        effective_group_id = group_id or self.settings.graphiti_group_id
        if effective_group_id not in self._graphiti_instances:
            driver = self._get_driver(effective_group_id)
            self._graphiti_instances[effective_group_id] = Graphiti(
                graph_driver=driver,
                embedder=self.embedder,
            )
        return self._graphiti_instances[effective_group_id]

    # =========================================================================
    # Health & Status
    # =========================================================================

    async def health_check(self) -> dict:
        """Check if MCP server (and its DB connection) is healthy."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.settings.graphiti_mcp_url}/health")
                response.raise_for_status()
                data = response.json()
                return {"healthy": True, "data": data}
        except Exception as e:
            return {"healthy": False, "error": str(e)}

    # =========================================================================
    # Graph Data (for visualization)
    # =========================================================================

    async def get_graph_data(self, limit: int = 500, group_id: str | None = None) -> dict:
        """Get graph data for visualization.

        If group_id is None, queries ALL available graphs and merges results.
        """
        try:
            # If no group_id, query all graphs
            if group_id is None:
                return await self._get_all_graphs_data(limit)

            # Single graph query
            return await self._get_single_graph_data(group_id, limit)
        except Exception as e:
            logger.exception("Error getting graph data")
            return {"success": False, "nodes": [], "edges": [], "error": str(e)}

    async def _get_single_graph_data(self, group_id: str, limit: int) -> dict:
        """Get data from a single graph using Graphiti methods (DB-neutral)."""
        graphiti = self._get_graphiti(group_id)

        # Use Graphiti methods instead of raw Cypher
        entities = await graphiti.get_entities_by_group_id(group_id, limit=limit)
        edges = await graphiti.get_edges_by_group_id(group_id, limit=limit)

        nodes = self._transform_entity_nodes(entities, group_id)
        edges = self._transform_entity_edges(edges, group_id)

        return {"success": True, "nodes": nodes, "edges": edges}

    async def _get_all_graphs_data(self, limit: int) -> dict:
        """Get data from all available graphs and merge results."""
        groups_response = await self.get_group_ids()
        if not groups_response.get("success"):
            return {"success": False, "nodes": [], "edges": [], "error": "Failed to get groups"}

        all_nodes = []
        all_edges = []
        seen_node_ids: set[str] = set()
        seen_edge_ids: set[str] = set()

        # Use full limit per graph (not divided) to ensure all edges are fetched
        group_ids = groups_response.get("group_ids", [])
        if not group_ids:
            return {"success": True, "nodes": [], "edges": []}

        per_graph_limit = limit  # Don't divide - fetch full limit from each graph

        for gid in group_ids:
            try:
                result = await self._get_single_graph_data(gid, per_graph_limit)
                if result.get("success"):
                    for node in result.get("nodes", []):
                        if node["id"] not in seen_node_ids:
                            seen_node_ids.add(node["id"])
                            all_nodes.append(node)
                    for edge in result.get("edges", []):
                        if edge["uuid"] not in seen_edge_ids:
                            seen_edge_ids.add(edge["uuid"])
                            all_edges.append(edge)
            except Exception as e:
                logger.warning(f"Failed to query graph {gid}: {e}")

        return {"success": True, "nodes": all_nodes, "edges": all_edges}

    def _transform_entity_nodes(self, entities: list, group_id: str) -> list:
        """Transform EntityNode objects to visualization format."""
        from graphiti_core.nodes import EntityNode

        nodes = []
        for entity in entities:
            if not isinstance(entity, EntityNode):
                continue

            labels = list(entity.labels) if entity.labels else []
            if "Entity" in labels:
                labels = [l for l in labels if l != "Entity"]

            nodes.append({
                "id": entity.uuid,
                "uuid": entity.uuid,
                "name": entity.name,
                "summary": entity.summary or "",
                "group_id": entity.group_id or group_id,
                "created_at": entity.created_at.isoformat() if entity.created_at else None,
                "labels": labels,
                "type": labels[0] if labels else "Entity",
                "attributes": entity.attributes or {},
            })
        return nodes

    def _transform_entity_edges(self, edges: list, group_id: str) -> list:
        """Transform EntityEdge objects to visualization format."""
        from graphiti_core.edges import EntityEdge

        result = []
        for edge in edges:
            if not isinstance(edge, EntityEdge):
                continue

            result.append({
                "uuid": edge.uuid,
                "source": edge.source_node_uuid,
                "target": edge.target_node_uuid,
                "name": edge.name or "",
                "fact": edge.fact or "",
                "group_id": edge.group_id or group_id,
                "created_at": edge.created_at.isoformat() if edge.created_at else "",
                "valid_at": edge.valid_at.isoformat() if edge.valid_at else None,
                "expired_at": edge.invalid_at.isoformat() if edge.invalid_at else None,
                "episodes": edge.episodes or [],
            })
        return result

    async def get_group_ids(self) -> dict:
        """Get all available group IDs using Graphiti (DB-neutral).

        Uses graphiti.get_groups() which delegates to driver.list_groups().
        All 4 drivers (FalkorDB, Neo4j, Kuzu, Neptune) implement this.
        """
        try:
            graphiti = self._get_graphiti()
            groups = await graphiti.get_groups()
            return {"success": True, "group_ids": groups}
        except Exception as e:
            logger.exception("Error getting group IDs")
            return {"success": False, "group_ids": [], "error": str(e)}

    async def get_graph_stats(self, group_id: str | None = None) -> dict:
        """Get graph statistics."""
        try:
            graphiti = self._get_graphiti(group_id)
            stats = await graphiti.get_graph_stats(group_id=group_id)

            return {
                "success": True,
                "stats": {
                    "nodes": stats["node_count"],
                    "edges": stats["edge_count"],
                    "episodes": stats["episode_count"],
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
            graphiti = self._get_graphiti(group_id)
            node = await graphiti.get_entity(uuid)
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
        """Create an entity node using Graphiti class (auto-generates embeddings)."""
        try:
            graphiti = self._get_graphiti(group_id)
            effective_group_id = group_id or self.settings.graphiti_group_id

            entity = await graphiti.create_entity(
                name=name,
                group_id=effective_group_id,
                entity_type=entity_type,
                summary=summary,
                attributes=attributes,
            )

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
        entity_type: str | None = None,
        group_id: str | None = None,
        attributes: dict[str, str | None] | None = None,
    ) -> dict:
        """Update an entity node using Graphiti class (auto-regenerates embeddings)."""
        try:
            graphiti = self._get_graphiti(group_id)

            # Handle attribute deletion (set value to None)
            merged_attributes = None
            if attributes:
                # First get current entity to handle deletions
                entity = await graphiti.get_entity(uuid)
                merged_attributes = dict(entity.attributes)
                for key, value in attributes.items():
                    if value is None:
                        merged_attributes.pop(key, None)
                    else:
                        merged_attributes[key] = value

            # Graphiti.update_entity handles labels, embeddings, and attributes
            await graphiti.update_entity(
                uuid=uuid,
                name=name,
                summary=summary,
                entity_type=entity_type,
                attributes=merged_attributes,
            )

            return {"success": True, "uuid": uuid}
        except NodeNotFoundError:
            return {"success": False, "error": f"Node {uuid} not found"}
        except Exception as e:
            logger.exception("Error updating entity")
            return {"success": False, "error": str(e)}

    async def delete_entity_node(self, uuid: str, group_id: str | None = None) -> dict:
        """Delete an entity node using Graphiti class."""
        try:
            graphiti = self._get_graphiti(group_id)
            await graphiti.remove_entity(uuid)
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
            graphiti = self._get_graphiti(group_id)
            edge = await graphiti.get_edge(uuid)
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
        """Create an edge using Graphiti class (auto-generates embedding)."""
        try:
            graphiti = self._get_graphiti(group_id)
            effective_group_id = group_id or self.settings.graphiti_group_id

            edge = await graphiti.create_edge(
                source_node_uuid=source_uuid,
                target_node_uuid=target_uuid,
                name=name,
                fact=fact or f"{name} relationship",
                group_id=effective_group_id,
            )

            return {
                "success": True,
                "uuid": edge.uuid,
                "name": edge.name,
                "episodes": edge.episodes,
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
        """Update an entity edge using Graphiti class (auto-regenerates embedding)."""
        try:
            graphiti = self._get_graphiti(group_id)

            await graphiti.update_edge(
                uuid=uuid,
                name=name,
                fact=fact,
            )

            return {"success": True, "uuid": uuid}
        except EdgeNotFoundError:
            return {"success": False, "error": f"Edge {uuid} not found"}
        except Exception as e:
            logger.exception("Error updating edge")
            return {"success": False, "error": str(e)}

    async def delete_entity_edge(self, uuid: str, group_id: str | None = None) -> dict:
        """Delete an entity edge using Graphiti class."""
        try:
            graphiti = self._get_graphiti(group_id)
            await graphiti.remove_edge(uuid)
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
            graphiti = self._get_graphiti(group_id)
            episode = await graphiti.get_episode(uuid)
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
            effective_group_ids = group_ids or [self.settings.graphiti_group_id]
            all_episodes = []

            # Fetch episodes from each group
            for gid in effective_group_ids:
                graphiti = self._get_graphiti(gid)
                episodes = await graphiti.get_episodes_by_group_id(gid, limit=limit)
                all_episodes.extend(episodes)

            # Sort by created_at and limit
            all_episodes.sort(key=lambda e: e.created_at or "", reverse=True)
            all_episodes = all_episodes[:limit]

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
                                } for ep in all_episodes]),
                            }
                        ],
                    },
                },
            }
        except Exception as e:
            logger.exception("Error getting episodes")
            return {"success": False, "error": str(e)}

    async def delete_episode(self, episode_uuid: str, group_id: str | None = None) -> dict:
        """Delete an episode using Graphiti class."""
        try:
            graphiti = self._get_graphiti(group_id)
            await graphiti.remove_episode(episode_uuid)
            return {"success": True, "deleted": episode_uuid}
        except NodeNotFoundError:
            return {"success": False, "error": f"Episode {episode_uuid} not found"}
        except Exception as e:
            logger.exception("Error deleting episode")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # Graph Management (DB-neutral via Graphiti class)
    # =========================================================================

    async def delete_graph(self, group_id: str) -> dict:
        """Delete an entire graph (group) using Graphiti's remove_group.

        The FalkorDriver.clone() now uses _skip_index_init=True to prevent
        auto-creation of graphs when getting a cloned driver.
        """
        try:
            graphiti = self._get_graphiti(group_id)
            await graphiti.remove_group(group_id)
            # Clear cached graphiti instance
            self._graphiti_instances.pop(group_id, None)
            return {"success": True, "deleted": group_id}
        except Exception as e:
            logger.exception("Error deleting graph")
            return {"success": False, "error": str(e)}

    async def rename_graph(self, group_id: str, new_name: str) -> dict:
        """Rename a graph using Graphiti's DB-neutral method."""
        try:
            graphiti = self._get_graphiti(group_id)
            await graphiti.rename_group(group_id, new_name)
            # Clear cached instance for old name
            self._graphiti_instances.pop(group_id, None)
            return {"success": True, "old_name": group_id, "new_name": new_name}
        except Exception as e:
            logger.exception("Error renaming graph")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # MCP-Related Operations (proxy to MCP server)
    # =========================================================================

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict:
        """Call an MCP tool via the server (for LLM-based operations)."""
        import json as json_module

        mcp_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        mcp_url = f"{self.settings.graphiti_mcp_url}/mcp"

        def parse_sse_response(text: str) -> dict | None:
            """Parse SSE response to extract JSON data."""
            for line in text.split("\n"):
                if line.startswith("data: "):
                    return json_module.loads(line[6:])
            return None

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                # Step 1: Initialize MCP session
                init_payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "graphiti-ui", "version": "1.0"},
                    },
                }
                init_response = await client.post(
                    mcp_url, json=init_payload, headers=mcp_headers
                )
                if init_response.status_code != 200:
                    return {"success": False, "error": f"MCP init failed: HTTP {init_response.status_code}"}

                session_id = init_response.headers.get("mcp-session-id")
                if not session_id:
                    return {"success": False, "error": "MCP server did not return session ID"}

                # Step 2: Call the tool with session ID
                tool_payload = {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments,
                    },
                }
                tool_headers = {**mcp_headers, "mcp-session-id": session_id}
                response = await client.post(
                    mcp_url, json=tool_payload, headers=tool_headers
                )

                if response.status_code == 200:
                    # Parse SSE response
                    result = parse_sse_response(response.text)
                    if result is None:
                        return {"success": False, "error": "Failed to parse MCP response"}
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
    # Queue Status (via MCP)
    # =========================================================================

    async def get_queue_status(self) -> dict:
        """Get queue processing status."""
        from .queue_service import get_queue_service
        service = get_queue_service()
        return await service.get_status()

    # =========================================================================
    # Query Execution
    # =========================================================================

    def _serialize_value(self, value: Any) -> Any:
        """Serialize a value for JSON response."""
        if value is None:
            return None
        # FalkorDB Node
        if hasattr(value, 'properties') and hasattr(value, 'labels'):
            return {
                'type': 'node',
                'labels': list(value.labels) if value.labels else [],
                'properties': dict(value.properties) if value.properties else {},
            }
        # FalkorDB Edge/Relationship
        if hasattr(value, 'properties') and hasattr(value, 'relation'):
            return {
                'type': 'edge',
                'relation': value.relation,
                'properties': dict(value.properties) if value.properties else {},
            }
        # Lists
        if isinstance(value, list):
            return [self._serialize_value(v) for v in value]
        # Dicts
        if isinstance(value, dict):
            return {k: self._serialize_value(v) for k, v in value.items()}
        # Primitives
        return value

    async def execute_query(self, query: str, group_id: str | None = None) -> dict:
        """Execute a read-only Cypher query."""
        try:
            # Basic safety check - only allow read queries
            query_upper = query.strip().upper()
            if any(kw in query_upper for kw in ["DELETE", "REMOVE", "SET", "CREATE", "MERGE"]):
                return {"success": False, "error": "Only read queries are allowed"}

            graphiti = self._get_graphiti(group_id)
            records, header, _ = await graphiti.execute_query(query)

            # Serialize FalkorDB objects to JSON-safe dicts
            serialized_records = [
                {k: self._serialize_value(v) for k, v in record.items()}
                for record in records
            ]

            return {
                "success": True,
                "results": serialized_records,
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
