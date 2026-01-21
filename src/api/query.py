"""Query API routes."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..auth.dependencies import CurrentUser
from ..services.graphiti_service import get_graphiti_client
from ..services.falkordb_service import get_falkordb_client

router = APIRouter()


class NodeSearchRequest(BaseModel):
    """Node search request."""

    query: str
    entity_types: list[str] | None = None
    limit: int = 10


class FactSearchRequest(BaseModel):
    """Fact search request."""

    query: str
    limit: int = 10


class CypherQueryRequest(BaseModel):
    """Raw Cypher query request."""

    query: str


@router.post("/nodes")
async def search_nodes(request: NodeSearchRequest, current_user: CurrentUser) -> dict:
    """Search for nodes in the knowledge graph."""
    client = get_graphiti_client()
    result = await client.search_nodes(
        query=request.query,
        limit=request.limit,
        entity_types=request.entity_types,
    )

    if result["success"]:
        data = result.get("data", {})
        # Extract nodes from MCP response
        content = data.get("content", [])
        nodes = []
        if content and isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    # Parse text content (MCP returns text)
                    nodes.append({"text": item.get("text", "")})

        return {
            "query": request.query,
            "results": nodes,
            "total": len(nodes),
            "success": True,
        }

    return {
        "query": request.query,
        "results": [],
        "total": 0,
        "success": False,
        "error": result.get("error", "Unknown error"),
    }


@router.post("/facts")
async def search_facts(request: FactSearchRequest, current_user: CurrentUser) -> dict:
    """Search for facts (edges) in the knowledge graph."""
    client = get_graphiti_client()
    result = await client.search_facts(
        query=request.query,
        limit=request.limit,
    )

    if result["success"]:
        data = result.get("data", {})
        content = data.get("content", [])
        facts = []
        if content and isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    facts.append({"text": item.get("text", "")})

        return {
            "query": request.query,
            "results": facts,
            "total": len(facts),
            "success": True,
        }

    return {
        "query": request.query,
        "results": [],
        "total": 0,
        "success": False,
        "error": result.get("error", "Unknown error"),
    }


@router.get("/health")
async def check_graphiti_health(current_user: CurrentUser) -> dict:
    """Check Graphiti MCP server health."""
    client = get_graphiti_client()
    return await client.health_check()


class QueryRequest(BaseModel):
    """Query request with optional graph selection."""

    query: str
    graph_id: str | None = None  # If None, query all graphs


def convert_value(value):
    """Safely convert FalkorDB values to JSON-serializable types."""
    if value is None:
        return None
    # Node
    if hasattr(value, 'labels') and hasattr(value, 'properties'):
        props = {}
        if value.properties:
            for k, v in value.properties.items():
                # Skip large embedding arrays
                if 'embedding' in k.lower():
                    props[k] = f"[{len(v)} floats]" if isinstance(v, list) else v
                else:
                    props[k] = convert_value(v)
        return {
            "type": "node",
            "labels": list(value.labels) if value.labels else [],
            "properties": props,
        }
    # Edge
    if hasattr(value, 'relation') and hasattr(value, 'src_node'):
        props = {}
        if value.properties:
            for k, v in value.properties.items():
                if 'embedding' in k.lower():
                    props[k] = f"[{len(v)} floats]" if isinstance(v, list) else v
                else:
                    props[k] = convert_value(v)
        return {
            "type": "edge",
            "relation": value.relation,
            "properties": props,
        }
    # List
    if isinstance(value, list):
        return [convert_value(v) for v in value]
    # Dict
    if isinstance(value, dict):
        return {k: convert_value(v) for k, v in value.items()}
    return value


@router.post("")
@router.post("/")
async def execute_query(request: QueryRequest, current_user: CurrentUser) -> dict:
    """Execute Cypher query against FalkorDB."""
    try:
        from falkordb import FalkorDB
        import os

        client = get_falkordb_client()

        # Determine which graphs to query
        if request.graph_id:
            group_ids = [request.graph_id]
        else:
            group_ids = client.get_group_ids()

        all_results = []
        for gid in group_ids:
            try:
                db = FalkorDB(
                    host=os.environ.get("FALKORDB_HOST", "falkordb"),
                    port=int(os.environ.get("FALKORDB_PORT", "6379")),
                    password=os.environ.get("FALKORDB_PASSWORD"),
                )
                graph = db.select_graph(gid)
                result = graph.query(request.query, timeout=10000)  # 10 seconds

                # Convert result to list of dicts
                rows = []
                for record in result.result_set:
                    row = {}
                    for i, header in enumerate(result.header):
                        # Header can be tuple or list: [type_id, name] or (type_id, name)
                        col_name = header[1] if isinstance(header, (tuple, list)) else str(header)
                        row[col_name] = convert_value(record[i])
                    rows.append(row)

                all_results.append({
                    "graph": gid,
                    "rows": rows,
                    "count": len(rows),
                })
            except Exception as e:
                all_results.append({
                    "graph": gid,
                    "rows": [],
                    "count": 0,
                    "error": str(e),
                })

        return {
            "query": request.query,
            "graph_id": request.graph_id,
            "results": all_results,
            "success": True,
        }
    except Exception as e:
        return {
            "query": request.query,
            "results": [],
            "success": False,
            "error": str(e),
        }


@router.get("/graphs")
async def get_available_graphs(current_user: CurrentUser) -> dict:
    """Get list of available graphs for querying."""
    try:
        client = get_falkordb_client()
        graphs = client.get_group_ids()
        return {"graphs": graphs, "success": True}
    except Exception as e:
        return {"graphs": [], "success": False, "error": str(e)}


@router.post("/cypher")
async def execute_cypher(request: CypherQueryRequest, current_user: CurrentUser) -> dict:
    """Execute raw Cypher query against FalkorDB (alias for /)."""
    return await execute_query(QueryRequest(query=request.query), current_user)
