"""Graph API routes for visualization data.

These routes proxy to the Graphiti MCP server which handles the database access.
This ensures database abstraction (FalkorDB vs Neo4j) is handled by Graphiti.
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..auth.dependencies import CurrentUser
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
    limit: int = Query(default=500, ge=1, le=10000, description="Max nodes to return"),
    group_id: str | None = Query(default=None, description="Filter by group ID"),
) -> GraphDataResponse:
    """Get graph data for visualization.

    Returns nodes, edges, and triplets in a format suitable for D3.js visualization.
    Proxies to MCP server /graph/data endpoint.
    """
    try:
        client = get_graphiti_client()
        data = await client.get_graph_data(limit=limit, group_id=group_id)

        if not data.get("success", False):
            return GraphDataResponse(
                success=False,
                nodes=[],
                edges=[],
                triplets=[],
                labels=[],
                stats={"node_count": 0, "edge_count": 0, "label_count": 0},
                error=data.get("error", "Unknown error"),
            )

        # Transform nodes to frontend expected format
        # Include all relevant properties for node details panel
        # MCP now returns 'id' and 'type' directly (in addition to 'uuid' and 'primaryLabel')
        transformed_nodes = [
            {
                "id": node.get("id", node.get("uuid", "")),
                "name": node.get("name", "Unknown"),
                "type": node.get("type", node.get("primaryLabel", "Entity")),
                "group_id": node.get("group_id", ""),
                "summary": node.get("summary", ""),
                "labels": node.get("labels", []),
                "created_at": node.get("created_at", ""),
                "attributes": {
                    k: v for k, v in node.get("attributes", {}).items()
                    if not k.endswith("_embedding")  # Exclude embedding vectors
                },
            }
            for node in data.get("nodes", [])
        ]

        # Transform edges to frontend expected format
        # MCP Backend now returns: source, target (UUIDs), type, name, fact, uuid, etc.
        # Frontend expects: source, target, type, fact, plus metadata
        # Note: Graphiti stores actual relationship name in 'name' field,
        # while type(r) is always 'RELATES_TO'
        transformed_edges = [
            {
                "source": edge.get("source", ""),
                "target": edge.get("target", ""),
                "type": edge.get("name") or edge.get("type", "RELATES_TO"),
                "fact": edge.get("fact", ""),
                "uuid": edge.get("uuid", ""),
                "created_at": edge.get("created_at", ""),
                "valid_at": edge.get("valid_at"),
                "expired_at": edge.get("expired_at"),
                "episodes": edge.get("episodes", []),
            }
            for edge in data.get("edges", [])
        ]

        return GraphDataResponse(
            success=True,
            nodes=transformed_nodes,
            edges=transformed_edges,
            triplets=data.get("triplets", []),
            labels=data.get("labels", []),
            stats=data.get("stats", {}),
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
        client = get_graphiti_client()
        result = await client.get_group_ids()

        if not result.get("success", False):
            return GroupIdsResponse(
                success=False,
                group_ids=[],
                error=result.get("error"),
            )

        return GroupIdsResponse(
            success=True,
            group_ids=result.get("group_ids", []),
        )
    except Exception as e:
        return GroupIdsResponse(
            success=False,
            group_ids=[],
            error=str(e),
        )


@router.get("/node/{uuid}")
async def get_node_details(
    uuid: str,
    current_user: CurrentUser,
    group_id: str | None = Query(default=None, description="Graph to search in"),
) -> dict:
    """Get detailed information about a specific node."""
    try:
        client = get_graphiti_client()
        result = await client.get_node_details(uuid, group_id=group_id)

        if result.get("success"):
            node = result.get("node", {})
            return {
                "success": True,
                "node": {
                    "uuid": node.get("uuid", ""),
                    "name": node.get("name", "Unknown"),
                    "summary": node.get("summary", ""),
                    "labels": node.get("labels", []),
                    "group_id": node.get("group_id", ""),
                    "created_at": node.get("created_at", ""),
                    "attributes": node,  # Full node data as attributes
                },
            }

        return {"success": False, "error": result.get("error", "Node not found")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/edge/{uuid}")
async def get_edge_details(
    uuid: str,
    current_user: CurrentUser,
    group_id: str | None = Query(default=None, description="Graph to search in"),
) -> dict:
    """Get detailed information about a specific edge."""
    try:
        client = get_graphiti_client()
        result = await client.get_edge_details(uuid, group_id=group_id)

        if result.get("success"):
            return {
                "success": True,
                "edge": result.get("edge", {}),
                "source": result.get("source", {}),
                "target": result.get("target", {}),
            }

        return {"success": False, "error": result.get("error", "Edge not found")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/group/{group_id}")
async def delete_graph(group_id: str, current_user: CurrentUser) -> dict:
    """Delete an entire graph (group) via MCP server.

    WARNING: This permanently deletes all nodes and edges in this graph.
    """
    try:
        client = get_graphiti_client()
        result = await client.delete_graph(group_id)

        if result.get("success"):
            return {
                "success": True,
                "message": result.get("message", f"Graph '{group_id}' deleted successfully"),
            }
        return {
            "success": False,
            "error": result.get("error", f"Failed to delete graph '{group_id}'"),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


class RenameGroupRequest(BaseModel):
    """Request to rename a graph/group."""

    new_name: str


@router.put("/group/{group_id}/rename")
async def rename_graph(group_id: str, request: RenameGroupRequest, current_user: CurrentUser) -> dict:
    """Rename a graph (group_id) via MCP server.

    Args:
        group_id: Current graph/group name to rename
        request.new_name: New name for the graph/group
    """
    try:
        if not request.new_name or not request.new_name.strip():
            return {"success": False, "error": "New name cannot be empty"}

        new_name = request.new_name.strip()
        if new_name == group_id:
            return {"success": False, "error": "New name is the same as current name"}

        client = get_graphiti_client()
        result = await client.rename_graph(group_id, new_name)

        if result.get("success"):
            return {
                "success": True,
                "message": result.get("message", f"Graph renamed from '{group_id}' to '{new_name}'"),
                "new_name": new_name,
            }
        return {
            "success": False,
            "error": result.get("error", "Failed to rename graph"),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/episode/{uuid}")
async def get_episode_details(
    uuid: str,
    current_user: CurrentUser,
    group_id: str | None = Query(default=None, description="Graph to search in"),
) -> dict:
    """Get detailed information about a specific episode."""
    try:
        client = get_graphiti_client()
        result = await client.get_episode_details(uuid, group_id=group_id)

        if result.get("success"):
            return {
                "success": True,
                "episode": result.get("episode", {}),
            }

        return {"success": False, "error": result.get("error", "Episode not found")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/stats")
async def get_graph_stats(
    current_user: CurrentUser,
    group_id: str | None = Query(default=None, description="Filter by group ID"),
) -> dict:
    """Get graph statistics."""
    try:
        client = get_graphiti_client()
        result = await client.get_graph_stats(group_id=group_id)

        if result.get("success"):
            return {
                "success": True,
                "stats": result.get("stats", {}),
            }

        return {
            "success": False,
            "error": result.get("error"),
            "stats": {"node_count": 0, "edge_count": 0, "label_count": 0},
        }

    except Exception as e:
        return {"success": False, "error": str(e), "stats": {}}


@router.get("/queue/status")
async def get_queue_status(current_user: CurrentUser) -> dict:
    """Get queue processing status for UI indicator."""
    try:
        client = get_graphiti_client()
        result = await client.get_queue_status()

        return {
            "success": result.get("success", False),
            "processing": result.get("processing", False),
            "pending_count": result.get("pending_count", 0),
            "active_workers": result.get("active_workers", 0),
        }
    except Exception as e:
        return {
            "success": False,
            "processing": False,
            "pending_count": 0,
            "active_workers": 0,
            "error": str(e),
        }


# ============================================
# Graph Editor Endpoints (proxy to MCP server)
# ============================================


class CreateNodeDirectRequest(BaseModel):
    """Request to create a node directly (no LLM)."""

    name: str
    entity_type: str = "Entity"
    summary: str = ""
    group_id: str
    attributes: dict[str, str] | None = None


class CreateEdgeDirectRequest(BaseModel):
    """Request to create an edge directly (no LLM)."""

    source_uuid: str
    target_uuid: str
    relationship_type: str
    fact: str = ""
    group_id: str


class SendKnowledgeRequest(BaseModel):
    """Request to send knowledge to LLM for extraction."""

    content: str
    group_id: str


class UpdateNodeRequest(BaseModel):
    """Request to update a node."""

    name: str | None = None
    summary: str | None = None
    entity_type: str | None = None  # Change node label/type
    group_id: str | None = None
    attributes: dict[str, str | None] | None = None  # null values = delete attribute


class UpdateEdgeRequest(BaseModel):
    """Request to update an edge."""

    name: str | None = None
    fact: str | None = None
    group_id: str | None = None


@router.post("/node/direct")
async def create_node_direct(request: CreateNodeDirectRequest, current_user: CurrentUser) -> dict:
    """Create a new node directly without LLM processing.

    Creates the entity exactly as specified with embeddings only.
    """
    try:
        client = get_graphiti_client()
        result = await client.create_entity_direct(
            name=request.name,
            entity_type=request.entity_type,
            summary=request.summary,
            group_id=request.group_id,
            attributes=request.attributes,
        )

        if result.get("success"):
            return {
                "success": True,
                "message": f"Entity '{request.name}' created",
                "uuid": result.get("uuid"),
                "data": result,
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/edge/direct")
async def create_edge_direct(request: CreateEdgeDirectRequest, current_user: CurrentUser) -> dict:
    """Create a new edge directly without LLM processing.

    Creates the relationship exactly as specified with embeddings only.
    """
    try:
        client = get_graphiti_client()
        result = await client.create_edge_direct(
            source_uuid=request.source_uuid,
            target_uuid=request.target_uuid,
            name=request.relationship_type,
            fact=request.fact,
            group_id=request.group_id,
        )

        if result.get("success"):
            return {
                "success": True,
                "message": f"Relationship '{request.relationship_type}' created",
                "uuid": result.get("uuid"),
                "data": result,
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/knowledge")
async def send_knowledge(request: SendKnowledgeRequest, current_user: CurrentUser) -> dict:
    """Send knowledge to LLM for extraction.

    The LLM will analyze the text and extract entities and relationships.
    Results appear asynchronously after processing.
    """
    try:
        client = get_graphiti_client()
        result = await client.send_knowledge(
            content=request.content,
            group_id=request.group_id,
        )

        if result.get("success"):
            return {
                "success": True,
                "message": "Knowledge submitted for LLM processing",
                "data": result.get("data"),
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/node/{uuid}")
async def update_node(
    uuid: str, request: UpdateNodeRequest, current_user: CurrentUser, group_id: str | None = None
) -> dict:
    """Update a node's properties via MCP server (includes embedding regeneration).

    Args:
        uuid: Node UUID to update
        group_id: Graph/group ID (required for FalkorDB)
    """
    try:
        client = get_graphiti_client()
        result = await client.update_entity_node(
            uuid=uuid,
            name=request.name,
            summary=request.summary,
            entity_type=request.entity_type,
            group_id=group_id,
            attributes=request.attributes,
        )
        return result

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.put("/edge/{uuid}")
async def update_edge(
    uuid: str, request: UpdateEdgeRequest, current_user: CurrentUser, group_id: str | None = None
) -> dict:
    """Update an edge's properties via MCP server (includes embedding regeneration).

    Args:
        uuid: Edge UUID to update
        group_id: Graph/group ID (required for FalkorDB)
    """
    try:
        client = get_graphiti_client()
        result = await client.update_entity_edge(
            uuid=uuid,
            name=request.name,
            fact=request.fact,
            group_id=group_id,
        )
        return result

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/node/{uuid}")
async def delete_node(uuid: str, current_user: CurrentUser, group_id: str | None = None) -> dict:
    """Delete a node via MCP server.

    This removes the entity and all connected edges from the graph.

    Args:
        uuid: Node UUID to delete
        group_id: Graph/group ID (required for FalkorDB)
    """
    try:
        client = get_graphiti_client()
        result = await client.delete_entity_node(uuid, group_id=group_id)

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
async def delete_edge(uuid: str, current_user: CurrentUser, group_id: str | None = None) -> dict:
    """Delete an edge via MCP server.

    Args:
        uuid: Edge UUID to delete
        group_id: Graph/group ID (required for FalkorDB)
    """
    try:
        client = get_graphiti_client()
        result = await client.delete_entity_edge(uuid, group_id=group_id)

        if result.get("success"):
            return {
                "success": True,
                "message": "Edge deleted successfully",
                "data": result.get("data"),
            }
        return {"success": False, "error": result.get("error", "Unknown error")}

    except Exception as e:
        return {"success": False, "error": str(e)}
