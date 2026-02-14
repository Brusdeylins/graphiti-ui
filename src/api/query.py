# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Query API routes.

These routes proxy to the Graphiti MCP server which handles database access.
This ensures database abstraction (FalkorDB vs Neo4j) is handled by Graphiti.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from ..auth.dependencies import CurrentUser
from ..services.graphiti_service import get_graphiti_client

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
    graph_id: str | None = None  # If None, query the default graph


@router.post("")
async def execute_query(request: QueryRequest, current_user: CurrentUser) -> dict:
    """Execute Cypher query via MCP server.

    Note: Only read-only queries are allowed (no DELETE, CREATE, MERGE, SET).
    """
    try:
        client = get_graphiti_client()

        # If querying specific graph
        if request.graph_id:
            result = await client.execute_query(request.query, group_id=request.graph_id)

            if result.get("success"):
                return {
                    "query": request.query,
                    "graph_id": request.graph_id,
                    "results": [{
                        "graph": request.graph_id,
                        "rows": result.get("results", []),
                        "count": result.get("count", 0),
                    }],
                    "success": True,
                }
            return {
                "query": request.query,
                "results": [{
                    "graph": request.graph_id,
                    "rows": [],
                    "count": 0,
                    "error": result.get("error"),
                }],
                "success": False,
                "error": result.get("error"),
            }

        # Query all graphs
        groups_result = await client.get_group_ids()
        group_ids = groups_result.get("group_ids", [])

        all_results = []
        for gid in group_ids:
            result = await client.execute_query(request.query, group_id=gid)
            if result.get("success"):
                all_results.append({
                    "graph": gid,
                    "rows": result.get("results", []),
                    "count": result.get("count", 0),
                })
            else:
                all_results.append({
                    "graph": gid,
                    "rows": [],
                    "count": 0,
                    "error": result.get("error"),
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
        client = get_graphiti_client()
        result = await client.get_group_ids()

        if result.get("success"):
            return {"graphs": result.get("group_ids", []), "success": True}
        return {"graphs": [], "success": False, "error": result.get("error")}
    except Exception as e:
        return {"graphs": [], "success": False, "error": str(e)}
