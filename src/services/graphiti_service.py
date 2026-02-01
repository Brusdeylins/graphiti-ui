"""Graphiti service with Graphiti class CRUD integration.

Uses the Graphiti class facade for CRUD operations with auto-embedding generation.
"""

import logging
from typing import Any

import httpx
from graphiti_core import Graphiti
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.embedder import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.errors import EdgeNotFoundError, NodeNotFoundError
from graphiti_core.nodes import EntityNode, EpisodicNode

from ..config import get_settings

logger = logging.getLogger(__name__)


class GraphitiClient:
    """Client for Graphiti operations via graphiti_core Graphiti class."""

    def __init__(self):
        self.settings = get_settings()
        self._driver: FalkorDriver | None = None
        self._embedder: OpenAIEmbedder | None = None
        self._graphiti_instances: dict[str, Graphiti] = {}

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
        """Get data from a single graph."""
        driver = self._get_driver(group_id)

        # Query nodes
        nodes_query = """
        MATCH (n:Entity)
        RETURN n, labels(n) AS labels
        LIMIT $limit
        """
        nodes_result, _, _ = await driver.execute_query(nodes_query, limit=limit)

        # Query edges
        edges_query = """
        MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
        RETURN a.uuid AS source, b.uuid AS target, r
        LIMIT $limit
        """
        edges_result, _, _ = await driver.execute_query(edges_query, limit=limit)

        nodes = self._transform_nodes(nodes_result, group_id)
        edges = self._transform_edges(edges_result, group_id)

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

    def _transform_nodes(self, nodes_result: list, group_id: str) -> list:
        """Transform node query results."""
        nodes = []
        for record in nodes_result:
            node_obj = record.get("n")
            labels = record.get("labels", [])
            if "Entity" in labels:
                labels = [l for l in labels if l != "Entity"]

            props = node_obj.properties if hasattr(node_obj, "properties") else (node_obj or {})

            standard_props = {"uuid", "name", "summary", "group_id", "created_at",
                              "name_embedding", "summary_embedding", "labels"}
            attributes = {
                k: v for k, v in props.items()
                if k not in standard_props and not k.endswith("_embedding")
            }

            nodes.append({
                "id": props.get("uuid"),
                "uuid": props.get("uuid"),
                "name": props.get("name"),
                "summary": props.get("summary", ""),
                "group_id": props.get("group_id", group_id),
                "created_at": props.get("created_at"),
                "labels": labels,
                "type": labels[0] if labels else "Entity",
                "attributes": attributes,
            })
        return nodes

    def _transform_edges(self, edges_result: list, group_id: str) -> list:
        """Transform edge query results."""
        edges = []
        for record in edges_result:
            rel_obj = record.get("r")
            props = rel_obj.properties if hasattr(rel_obj, "properties") else (rel_obj or {})

            edges.append({
                "uuid": props.get("uuid", ""),
                "source": record["source"],
                "target": record["target"],
                "name": props.get("name", ""),
                "fact": props.get("fact", ""),
                "group_id": props.get("group_id", group_id),
                "created_at": props.get("created_at", ""),
                "valid_at": props.get("valid_at"),
                "expired_at": props.get("expired_at"),
                "episodes": props.get("episodes", []),
            })
        return edges

    async def get_group_ids(self) -> dict:
        """Get all available group IDs from FalkorDB.

        FalkorDB stores each group as a separate graph (Redis key with type 'graphdata').
        """
        # Only exclude the FalkorDB database name itself (configured in config.yaml)
        # All other graphs are user-created groups that should be visible
        EXCLUDED_GRAPHS = {
            "graphiti",  # Database name from config, not a real group
            "default_db",  # FalkorDB default database name
        }

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

                # Skip known system/test graphs
                if key.lower() in EXCLUDED_GRAPHS:
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
            driver = self._get_driver(group_id)

            # Handle attribute deletion (set value to None)
            merged_attributes = None
            if attributes:
                # First get current entity to handle deletions
                entity = await EntityNode.get_by_uuid(driver, uuid)
                merged_attributes = dict(entity.attributes)
                for key, value in attributes.items():
                    if value is None:
                        merged_attributes.pop(key, None)
                    else:
                        merged_attributes[key] = value

            # Handle entity type change via direct Cypher (labels need special handling)
            if entity_type is not None:
                safe_type = entity_type.replace("'", "").replace('"', "").replace("\\", "")
                entity = await EntityNode.get_by_uuid(driver, uuid)

                # Remove old labels
                for old_label in entity.labels or []:
                    safe_old = old_label.replace("'", "").replace('"', "").replace("\\", "")
                    if safe_old and safe_old != "Entity":
                        await driver.execute_query(
                            f"MATCH (n:Entity {{uuid: $uuid}}) REMOVE n:`{safe_old}`",
                            uuid=uuid,
                        )

                # Add new label
                if safe_type and safe_type != "Entity":
                    await driver.execute_query(
                        f"MATCH (n:Entity {{uuid: $uuid}}) SET n:`{safe_type}`",
                        uuid=uuid,
                    )

            # Use Graphiti.update_entity for name/summary/attributes (handles embeddings)
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
            await graphiti.delete_entity(uuid)
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
            await graphiti.delete_edge(uuid)
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
        """Delete an episode using Graphiti class."""
        try:
            # First get episode to find its group_id
            episode = await EpisodicNode.get_by_uuid(self.driver, episode_uuid)
            graphiti = self._get_graphiti(episode.group_id)
            await graphiti.delete_episode(episode_uuid)
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
            import redis.asyncio as redis_async

            # Use GRAPH.DELETE command to properly delete FalkorDB graph
            # (simple DEL doesn't work for graphdata type keys)
            r = redis_async.Redis(
                host=self.settings.falkordb_host,
                port=self.settings.falkordb_port,
                password=self.settings.falkordb_password or None,
                decode_responses=True,
            )
            await r.execute_command("GRAPH.DELETE", group_id)
            await r.aclose()

            return {"success": True, "deleted": group_id}
        except Exception as e:
            logger.exception("Error deleting graph")
            return {"success": False, "error": str(e)}

    async def rename_graph(self, group_id: str, new_name: str) -> dict:
        """Rename a graph by copying to new name and deleting the old one.

        FalkorDB stores each graph as a separate Redis key, so renaming requires:
        1. Copy graph to new name (GRAPH.COPY)
        2. Update group_id property on all nodes/edges in the new graph
        3. Delete the old graph
        """
        try:
            import redis.asyncio as redis_async

            r = redis_async.Redis(
                host=self.settings.falkordb_host,
                port=self.settings.falkordb_port,
                password=self.settings.falkordb_password or None,
                decode_responses=True,
            )

            # Step 1: Copy graph to new name
            await r.execute_command("GRAPH.COPY", group_id, new_name)

            # Step 2: Update group_id property on all nodes/edges in the NEW graph
            new_driver = self._get_driver(new_name)
            await new_driver.execute_query(
                "MATCH (n) SET n.group_id = $new_id",
                new_id=new_name,
            )
            await new_driver.execute_query(
                "MATCH ()-[r]->() SET r.group_id = $new_id",
                new_id=new_name,
            )

            # Step 3: Delete the old graph
            await r.execute_command("GRAPH.DELETE", group_id)

            await r.aclose()

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
