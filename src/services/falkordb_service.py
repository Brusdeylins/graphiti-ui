"""FalkorDB direct connection service.

Provides direct access to FalkorDB for graph visualization data.
"""

import os
from typing import Any
from redis import Redis
from falkordb import FalkorDB

from ..config import get_settings


class FalkorDBClient:
    """Client for direct FalkorDB access."""

    def __init__(self):
        self.settings = get_settings()
        self._client: FalkorDB | None = None
        self._graph = None

    def _get_connection_params(self) -> dict:
        """Get connection parameters from environment."""
        # Parse from MCP URL or use defaults
        # FalkorDB runs on the same network as graphiti-mcp
        host = os.environ.get("FALKORDB_HOST", "falkordb")
        port = int(os.environ.get("FALKORDB_PORT", "6379"))
        password = os.environ.get("FALKORDB_PASSWORD", None)
        database = os.environ.get("FALKORDB_DATABASE", "graphiti")

        return {
            "host": host,
            "port": port,
            "password": password if password else None,
            "database": database,
        }

    def connect(self) -> bool:
        """Establish connection to FalkorDB."""
        try:
            params = self._get_connection_params()
            self._client = FalkorDB(
                host=params["host"],
                port=params["port"],
                password=params["password"],
            )
            self._graph = self._client.select_graph(params["database"])
            return True
        except Exception as e:
            print(f"FalkorDB connection error: {e}")
            return False

    def get_graph(self):
        """Get the graph instance, connecting if needed."""
        if self._graph is None:
            self.connect()
        return self._graph

    def execute_query(self, query: str) -> list[dict]:
        """Execute a Cypher query and return results as dicts."""
        try:
            graph = self.get_graph()
            if graph is None:
                return []

            result = graph.query(query)
            return self._result_to_dicts(result)
        except Exception as e:
            print(f"FalkorDB query error: {e}")
            return []

    def _result_to_dicts(self, result) -> list[dict]:
        """Convert FalkorDB result to list of dictionaries."""
        if result is None:
            return []

        rows = []
        for record in result.result_set:
            row = {}
            for i, header in enumerate(result.header):
                col_name = header[1] if isinstance(header, tuple) else header
                value = record[i]
                # Convert FalkorDB node/edge objects to dicts
                row[col_name] = self._convert_value(value)
            rows.append(row)
        return rows

    def _convert_value(self, value) -> Any:
        """Convert FalkorDB value to Python native type."""
        if value is None:
            return None

        # Check if it's a Node
        if hasattr(value, 'labels') and hasattr(value, 'properties'):
            return {
                "id": value.id,
                "labels": list(value.labels) if value.labels else [],
                "properties": dict(value.properties) if value.properties else {},
            }

        # Check if it's an Edge
        if hasattr(value, 'relation') and hasattr(value, 'src_node'):
            return {
                "id": value.id,
                "type": value.relation,
                "source_id": value.src_node,
                "target_id": value.dest_node,
                "properties": dict(value.properties) if value.properties else {},
            }

        return value

    def get_all_nodes(self, limit: int = 500, group_id: str | None = None) -> list[dict]:
        """Get all entity nodes from the graph.

        Note: Graphiti stores each group_id as a separate graph in FalkorDB.
        If group_id is specified, we query that specific graph.
        Otherwise, we query all known graphs.
        """
        if group_id:
            # Query specific graph for this group_id
            return self._get_nodes_from_graph(group_id, limit)
        else:
            # Query all graphs and combine results
            all_nodes = []
            for gid in self.get_group_ids():
                nodes = self._get_nodes_from_graph(gid, limit // max(1, len(self.get_group_ids())))
                all_nodes.extend(nodes)
                if len(all_nodes) >= limit:
                    break
            return all_nodes[:limit]

    def _get_nodes_from_graph(self, graph_name: str, limit: int) -> list[dict]:
        """Get nodes from a specific graph."""
        try:
            params = self._get_connection_params()
            client = FalkorDB(
                host=params["host"],
                port=params["port"],
                password=params["password"],
            )
            graph = client.select_graph(graph_name)
            query = f"""
            MATCH (n:Entity)
            RETURN n
            LIMIT {limit}
            """
            result = graph.query(query)
            nodes = []
            for record in result.result_set:
                value = record[0]
                if hasattr(value, 'labels') and hasattr(value, 'properties'):
                    props = dict(value.properties) if value.properties else {}
                    labels = list(value.labels) if value.labels else []

                    primary_label = "Entity"
                    for label in labels:
                        if label != "Entity":
                            primary_label = label
                            break

                    nodes.append({
                        "uuid": props.get("uuid", str(value.id)),
                        "name": props.get("name", "Unknown"),
                        "summary": props.get("summary", ""),
                        "labels": labels,
                        "primaryLabel": primary_label,
                        "group_id": graph_name,  # Use graph name as group_id
                        "created_at": props.get("created_at", ""),
                        "attributes": {k: v for k, v in props.items()
                                       if k not in ["uuid", "name", "summary", "group_id", "created_at"]},
                    })
            return nodes
        except Exception as e:
            print(f"Error getting nodes from graph {graph_name}: {e}")
            return []

    def get_all_edges(self, limit: int = 1000, group_id: str | None = None) -> list[dict]:
        """Get all edges (facts) from the graph."""
        if group_id:
            return self._get_edges_from_graph(group_id, limit)
        else:
            all_edges = []
            for gid in self.get_group_ids():
                edges = self._get_edges_from_graph(gid, limit // max(1, len(self.get_group_ids())))
                all_edges.extend(edges)
                if len(all_edges) >= limit:
                    break
            return all_edges[:limit]

    def _get_edges_from_graph(self, graph_name: str, limit: int) -> list[dict]:
        """Get edges from a specific graph."""
        try:
            params = self._get_connection_params()
            client = FalkorDB(
                host=params["host"],
                port=params["port"],
                password=params["password"],
            )
            graph = client.select_graph(graph_name)
            query = f"""
            MATCH (s:Entity)-[r]->(t:Entity)
            RETURN s.uuid as source_uuid, t.uuid as target_uuid,
                   type(r) as rel_type, r.uuid as uuid, r.name as name,
                   r.fact as fact, r.created_at as created_at,
                   r.valid_at as valid_at, r.expired_at as expired_at,
                   r.episodes as episodes
            LIMIT {limit}
            """
            result = graph.query(query)
            edges = []
            for record in result.result_set:
                # Map result columns by index based on query order
                edges.append({
                    "uuid": record[3] if len(record) > 3 else "",
                    "source_node_uuid": record[0] if len(record) > 0 else "",
                    "target_node_uuid": record[1] if len(record) > 1 else "",
                    "type": record[2] if len(record) > 2 else "RELATES_TO",
                    "name": record[4] if len(record) > 4 else "",
                    "fact": record[5] if len(record) > 5 else "",
                    "created_at": record[6] if len(record) > 6 else "",
                    "valid_at": record[7] if len(record) > 7 else None,
                    "expired_at": record[8] if len(record) > 8 else None,
                    "episodes": record[9] if len(record) > 9 else [],
                })
            return edges
        except Exception as e:
            print(f"Error getting edges from graph {graph_name}: {e}")
            return []

    def get_graph_data(self, limit: int = 500, group_id: str | None = None) -> dict:
        """Get complete graph data for visualization."""
        nodes = self.get_all_nodes(limit=limit, group_id=group_id)
        edges = self.get_all_edges(limit=limit * 2, group_id=group_id)

        # Build node UUID lookup for edge filtering
        node_uuids = {n["uuid"] for n in nodes}

        # Filter edges to only include those connecting existing nodes
        valid_edges = [
            e for e in edges
            if e["source_node_uuid"] in node_uuids and e["target_node_uuid"] in node_uuids
        ]

        # Convert to triplet format
        node_map = {n["uuid"]: n for n in nodes}
        triplets = []
        for edge in valid_edges:
            source = node_map.get(edge["source_node_uuid"])
            target = node_map.get(edge["target_node_uuid"])
            if source and target:
                triplets.append({
                    "sourceNode": source,
                    "edge": edge,
                    "targetNode": target,
                })

        # Get unique labels for color mapping
        all_labels = set()
        all_labels.add("Entity")
        for node in nodes:
            if node.get("primaryLabel"):
                all_labels.add(node["primaryLabel"])

        return {
            "nodes": nodes,
            "edges": valid_edges,
            "triplets": triplets,
            "labels": sorted(list(all_labels)),
            "stats": {
                "node_count": len(nodes),
                "edge_count": len(valid_edges),
                "label_count": len(all_labels),
            },
        }

    def delete_graph(self, graph_name: str) -> bool:
        """Delete an entire graph from FalkorDB.

        WARNING: This permanently deletes all data in the graph.
        """
        try:
            params = self._get_connection_params()
            from redis import Redis
            r = Redis(
                host=params["host"],
                port=params["port"],
                password=params["password"],
            )
            # Delete the graph key and its telemetry
            r.delete(graph_name)
            r.delete(f"telemetry{{{graph_name}}}")
            return True
        except Exception as e:
            print(f"Error deleting graph {graph_name}: {e}")
            return False

    def get_episode_by_uuid(self, episode_uuid: str, group_id: str | None = None) -> dict | None:
        """Get an episode node by UUID.

        Args:
            episode_uuid: UUID of the episode to fetch
            group_id: Optional graph name to search in. If None, searches all graphs.
        """
        if group_id:
            return self._get_episode_from_graph(episode_uuid, group_id)
        else:
            # Search all graphs
            for gid in self.get_group_ids():
                result = self._get_episode_from_graph(episode_uuid, gid)
                if result:
                    return result
            return None

    def _get_episode_from_graph(self, episode_uuid: str, graph_name: str) -> dict | None:
        """Get an episode from a specific graph."""
        try:
            params = self._get_connection_params()
            client = FalkorDB(
                host=params["host"],
                port=params["port"],
                password=params["password"],
            )
            graph = client.select_graph(graph_name)
            query = f"""
            MATCH (e:Episodic {{uuid: '{episode_uuid}'}})
            RETURN e.uuid as uuid, e.name as name, e.content as content,
                   e.source as source, e.source_description as source_description,
                   e.valid_at as valid_at, e.created_at as created_at
            LIMIT 1
            """
            result = graph.query(query)
            if result.result_set:
                record = result.result_set[0]
                return {
                    "uuid": record[0] if len(record) > 0 else "",
                    "name": record[1] if len(record) > 1 else "",
                    "content": record[2] if len(record) > 2 else "",
                    "source": record[3] if len(record) > 3 else "",
                    "source_description": record[4] if len(record) > 4 else "",
                    "valid_at": record[5] if len(record) > 5 else None,
                    "created_at": record[6] if len(record) > 6 else "",
                    "group_id": graph_name,
                }
            return None
        except Exception as e:
            print(f"Error getting episode {episode_uuid} from graph {graph_name}: {e}")
            return None

    def get_group_ids(self) -> list[str]:
        """Get all unique group IDs (graph names) in FalkorDB.

        In Graphiti, each group_id is stored as a separate graph in FalkorDB.
        """
        try:
            params = self._get_connection_params()
            from redis import Redis
            r = Redis(
                host=params["host"],
                port=params["port"],
                password=params["password"],
                decode_responses=True,
            )
            # Get all keys and filter out telemetry keys
            all_keys = r.keys("*")
            # Filter: exclude telemetry keys and known non-graph keys
            graph_names = [
                k for k in all_keys
                if not k.startswith("telemetry{")
                and k not in ["graphiti"]  # Exclude empty default graph
            ]
            return sorted(graph_names)
        except Exception as e:
            print(f"Error getting group IDs: {e}")
            return []


# Global client instance
_client: FalkorDBClient | None = None


def get_falkordb_client() -> FalkorDBClient:
    """Get the FalkorDB client singleton."""
    global _client
    if _client is None:
        _client = FalkorDBClient()
    return _client
