"""Graph API routes for visualization data."""

from fastapi import APIRouter, Query
from pydantic import BaseModel
import httpx

from ..auth.dependencies import CurrentUser
from ..config import get_settings
from ..services.falkordb_service import get_falkordb_client
from ..services.graphiti_service import get_graphiti_client

router = APIRouter()


class GraphDataResponse(BaseModel):
    """Graph data response for visualization."""

    success: bool
    nodes: list[dict]
    edges: list[dict]
    triplets: list[dict]
    labels: list[str]
    stats: dict
    error: str | None = None


class GroupIdsResponse(BaseModel):
    """Response with available group IDs."""

    success: bool
    group_ids: list[str]
    error: str | None = None


@router.get("/data", response_model=GraphDataResponse)
async def get_graph_data(
    current_user: CurrentUser,
    limit: int = Query(default=500, ge=1, le=2000, description="Max nodes to return"),
    group_id: str | None = Query(default=None, description="Filter by group ID"),
) -> GraphDataResponse:
    """Get graph data for visualization.

    Returns nodes, edges, and triplets in a format suitable for D3.js visualization.
    """
    try:
        client = get_falkordb_client()
        data = client.get_graph_data(limit=limit, group_id=group_id)

        # Transform nodes to frontend expected format
        # Include all relevant properties for node details panel
        transformed_nodes = [
            {
                "id": node.get("uuid", ""),
                "name": node.get("name", "Unknown"),
                "type": node.get("primaryLabel", "Entity"),
                "group_id": node.get("group_id", ""),
                "summary": node.get("summary", ""),
                "labels": node.get("labels", []),
                "created_at": node.get("created_at", ""),
                "attributes": {
                    k: v for k, v in node.get("attributes", {}).items()
                    if not k.endswith("_embedding")  # Exclude embedding vectors
                },
            }
            for node in data["nodes"]
        ]

        # Transform edges to frontend expected format
        # Backend: source_node_uuid, target_node_uuid, type, name, fact, uuid, created_at, valid_at, expired_at
        # Frontend expects: source, target, type, fact, plus metadata
        # Note: Graphiti stores actual relationship name in 'name' field,
        # while type(r) is always 'RELATES_TO'
        transformed_edges = [
            {
                "source": edge.get("source_node_uuid", ""),
                "target": edge.get("target_node_uuid", ""),
                "type": edge.get("name") or edge.get("type", "RELATES_TO"),
                "fact": edge.get("fact", ""),
                "uuid": edge.get("uuid", ""),
                "created_at": edge.get("created_at", ""),
                "valid_at": edge.get("valid_at"),
                "expired_at": edge.get("expired_at"),
                "episodes": edge.get("episodes", []),
            }
            for edge in data["edges"]
        ]

        return GraphDataResponse(
            success=True,
            nodes=transformed_nodes,
            edges=transformed_edges,
            triplets=data["triplets"],
            labels=data["labels"],
            stats=data["stats"],
        )
    except Exception as e:
        return GraphDataResponse(
            success=False,
            nodes=[],
            edges=[],
            triplets=[],
            labels=[],
            stats={"node_count": 0, "edge_count": 0, "label_count": 0},
            error=str(e),
        )


@router.get("/groups", response_model=GroupIdsResponse)
async def get_group_ids(current_user: CurrentUser) -> GroupIdsResponse:
    """Get available group IDs for filtering."""
    try:
        client = get_falkordb_client()
        group_ids = client.get_group_ids()

        return GroupIdsResponse(
            success=True,
            group_ids=group_ids,
        )
    except Exception as e:
        return GroupIdsResponse(
            success=False,
            group_ids=[],
            error=str(e),
        )


@router.get("/node/{uuid}")
async def get_node_details(uuid: str, current_user: CurrentUser) -> dict:
    """Get detailed information about a specific node."""
    try:
        client = get_falkordb_client()
        query = f"""
        MATCH (n:Entity {{uuid: '{uuid}'}})
        RETURN n
        LIMIT 1
        """
        results = client.execute_query(query)

        if results and "n" in results[0]:
            node_data = results[0]["n"]
            props = node_data.get("properties", {})
            labels = node_data.get("labels", [])

            return {
                "success": True,
                "node": {
                    "uuid": props.get("uuid", ""),
                    "name": props.get("name", "Unknown"),
                    "summary": props.get("summary", ""),
                    "labels": labels,
                    "group_id": props.get("group_id", ""),
                    "created_at": props.get("created_at", ""),
                    "attributes": props,
                },
            }

        return {"success": False, "error": "Node not found"}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/edge/{uuid}")
async def get_edge_details(uuid: str, current_user: CurrentUser) -> dict:
    """Get detailed information about a specific edge."""
    try:
        client = get_falkordb_client()
        query = f"""
        MATCH (s:Entity)-[r {{uuid: '{uuid}'}}]->(t:Entity)
        RETURN s, r, t
        LIMIT 1
        """
        results = client.execute_query(query)

        if results:
            row = results[0]
            source = row.get("s", {})
            target = row.get("t", {})
            edge = row.get("r", {})

            source_props = source.get("properties", {}) if isinstance(source, dict) else {}
            target_props = target.get("properties", {}) if isinstance(target, dict) else {}
            edge_props = edge.get("properties", {}) if isinstance(edge, dict) else {}

            return {
                "success": True,
                "edge": {
                    "uuid": edge_props.get("uuid", ""),
                    "name": edge_props.get("name", ""),
                    "fact": edge_props.get("fact", ""),
                    "type": edge.get("type", "") if isinstance(edge, dict) else "",
                    "created_at": edge_props.get("created_at", ""),
                    "valid_at": edge_props.get("valid_at"),
                    "expired_at": edge_props.get("expired_at"),
                },
                "source": {
                    "uuid": source_props.get("uuid", ""),
                    "name": source_props.get("name", "Unknown"),
                },
                "target": {
                    "uuid": target_props.get("uuid", ""),
                    "name": target_props.get("name", "Unknown"),
                },
            }

        return {"success": False, "error": "Edge not found"}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/group/{group_id}")
async def delete_graph(group_id: str, current_user: CurrentUser) -> dict:
    """Delete an entire graph (group) from FalkorDB.

    WARNING: This permanently deletes all nodes and edges in this graph.
    """
    try:
        client = get_falkordb_client()
        success = client.delete_graph(group_id)

        if success:
            return {
                "success": True,
                "message": f"Graph '{group_id}' deleted successfully",
            }
        else:
            return {
                "success": False,
                "error": f"Failed to delete graph '{group_id}'",
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/episode/{uuid}")
async def get_episode_details(uuid: str, current_user: CurrentUser) -> dict:
    """Get detailed information about a specific episode."""
    try:
        client = get_falkordb_client()
        episode = client.get_episode_by_uuid(uuid)

        if episode:
            return {
                "success": True,
                "episode": episode,
            }

        return {"success": False, "error": "Episode not found"}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/stats")
async def get_graph_stats(current_user: CurrentUser) -> dict:
    """Get graph statistics."""
    try:
        client = get_falkordb_client()

        # Count nodes
        node_count_result = client.execute_query("MATCH (n:Entity) RETURN count(n) as count")
        node_count = node_count_result[0]["count"] if node_count_result else 0

        # Count edges
        edge_count_result = client.execute_query("MATCH ()-[r]->() RETURN count(r) as count")
        edge_count = edge_count_result[0]["count"] if edge_count_result else 0

        # Count labels
        label_result = client.execute_query("""
            MATCH (n:Entity)
            UNWIND labels(n) as label
            RETURN DISTINCT label
        """)
        label_count = len(label_result) if label_result else 0

        return {
            "success": True,
            "stats": {
                "node_count": node_count,
                "edge_count": edge_count,
                "label_count": label_count,
            },
        }

    except Exception as e:
        return {"success": False, "error": str(e), "stats": {}}


# ============================================
# Graph Editor Endpoints
# ============================================


class CreateNodeRequest(BaseModel):
    """Request to create a new node via episode."""

    name: str
    entity_type: str = "Entity"
    summary: str = ""
    group_id: str


class CreateEdgeRequest(BaseModel):
    """Request to create a new edge via episode."""

    source_name: str
    target_name: str
    relationship_type: str
    fact: str = ""
    group_id: str


class UpdateNodeRequest(BaseModel):
    """Request to update a node."""

    name: str | None = None
    summary: str | None = None
    group_id: str | None = None
    attributes: dict[str, str] | None = None


class UpdateEdgeRequest(BaseModel):
    """Request to update an edge."""

    name: str | None = None
    fact: str | None = None
    group_id: str | None = None


@router.post("/node")
async def create_node(request: CreateNodeRequest, current_user: CurrentUser) -> dict:
    """Create a new node via add_episode.

    Uses the MCP add_episode tool to create an entity. The LLM will extract
    the entity from the episode content and create proper embeddings.
    """
    try:
        graphiti = get_graphiti_client()

        # Craft episode content that describes the entity
        entity_type_text = f"({request.entity_type})" if request.entity_type != "Entity" else ""
        episode_content = f"New entity: {request.name} {entity_type_text}."
        if request.summary:
            episode_content += f" Description: {request.summary}"

        result = await graphiti.add_episode(
            name=f"Manual: Create Entity '{request.name}'",
            content=episode_content,
            source="text",
            source_description="Manual graph edit via UI",
            group_id=request.group_id,
        )

        if result.get("success"):
            return {
                "success": True,
                "message": f"Entity '{request.name}' creation initiated",
                "data": result.get("data"),
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/edge")
async def create_edge(request: CreateEdgeRequest, current_user: CurrentUser) -> dict:
    """Create a new edge via add_episode.

    Uses the MCP add_episode tool to create a relationship. The LLM will extract
    the relationship from the episode content and create proper embeddings.
    """
    try:
        graphiti = get_graphiti_client()

        # Craft episode content that describes the relationship
        episode_content = f"{request.source_name} {request.relationship_type} {request.target_name}."
        if request.fact:
            episode_content += f" {request.fact}"

        result = await graphiti.add_episode(
            name=f"Manual: Create Relationship '{request.source_name}' -> '{request.target_name}'",
            content=episode_content,
            source="text",
            source_description="Manual graph edit via UI",
            group_id=request.group_id,
        )

        if result.get("success"):
            return {
                "success": True,
                "message": f"Relationship '{request.relationship_type}' creation initiated",
                "data": result.get("data"),
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/node/{uuid}")
async def update_node(uuid: str, request: UpdateNodeRequest, current_user: CurrentUser) -> dict:
    """Update a node's properties via REST API (includes embedding regeneration)."""
    try:
        graphiti = get_graphiti_client()
        result = await graphiti.update_entity_node(
            uuid=uuid,
            name=request.name,
            summary=request.summary,
        )
        return result

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/edge/{uuid}")
async def update_edge(uuid: str, request: UpdateEdgeRequest, current_user: CurrentUser) -> dict:
    """Update an edge's properties via REST API (includes embedding regeneration)."""
    try:
        graphiti = get_graphiti_client()
        result = await graphiti.update_entity_edge(
            uuid=uuid,
            name=request.name,
            fact=request.fact,
        )
        return result

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/node/{uuid}")
async def delete_node(uuid: str, current_user: CurrentUser) -> dict:
    """Delete a node via MCP delete_entity_node tool.

    This removes the entity and all connected edges from the graph.
    """
    try:
        graphiti = get_graphiti_client()
        result = await graphiti.delete_entity_node(uuid)

        if result.get("success"):
            return {
                "success": True,
                "message": "Node deleted successfully",
                "data": result.get("data"),
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/edge/{uuid}")
async def delete_edge(uuid: str, current_user: CurrentUser) -> dict:
    """Delete an edge via MCP delete_entity_edge tool."""
    try:
        graphiti = get_graphiti_client()
        result = await graphiti.delete_entity_edge(uuid)

        if result.get("success"):
            return {
                "success": True,
                "message": "Edge deleted successfully",
                "data": result.get("data"),
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        return {"success": False, "error": str(e)}
