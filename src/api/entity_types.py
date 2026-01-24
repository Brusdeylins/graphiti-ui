"""Entity Types API routes - proxies to MCP Server."""

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..auth.dependencies import CurrentUser
from ..config import get_settings

router = APIRouter()


class EntityTypeField(BaseModel):
    """Entity type field model."""

    name: str = Field(..., description="Field name")
    type: str = Field(default="str", description="Field type: str, int, float, bool")
    required: bool = Field(default=False, description="Whether the field is required")
    description: str = Field(default="", description="Field description for LLM extraction")


class EntityType(BaseModel):
    """Entity type model."""

    name: str = Field(..., description="PascalCase name")
    description: str = Field(..., description="Description for LLM extraction")
    fields: list[EntityTypeField] = Field(default_factory=list, description="Structured fields")
    source: str | None = Field(default=None, description="Source: config or api")
    created_at: str | None = Field(default=None, description="Creation timestamp")
    modified_at: str | None = Field(default=None, description="Last modification timestamp")


class EntityTypeCreate(BaseModel):
    """Create entity type request."""

    name: str = Field(..., pattern=r"^[A-Z][a-zA-Z0-9]*$", description="PascalCase name")
    description: str = Field(..., min_length=10, description="Description for LLM extraction")
    fields: list[EntityTypeField] = Field(default_factory=list, description="Structured fields")


class EntityTypeUpdate(BaseModel):
    """Update entity type request."""

    description: str | None = Field(default=None, min_length=10, description="Description for LLM extraction")
    fields: list[EntityTypeField] | None = Field(default=None, description="Structured fields")


async def _mcp_request(method: str, path: str, json_data: dict | None = None) -> dict:
    """Make a request to the MCP server."""
    settings = get_settings()
    url = f"{settings.graphiti_mcp_url}{path}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        if method == "GET":
            response = await client.get(url)
        elif method == "POST":
            response = await client.post(url, json=json_data)
        elif method == "PUT":
            response = await client.put(url, json=json_data)
        elif method == "DELETE":
            response = await client.delete(url)
        else:
            raise ValueError(f"Unknown method: {method}")

        if response.status_code >= 400:
            error_detail = response.json().get("error", response.text)
            raise HTTPException(status_code=response.status_code, detail=error_detail)

        return response.json()


@router.get("")
async def list_entity_types(current_user: CurrentUser) -> list[EntityType]:
    """List all entity types from MCP server database."""
    data = await _mcp_request("GET", "/entity-types")
    entity_types = data.get("entity_types", [])
    return [EntityType(**et) for et in entity_types]


@router.post("", response_model=EntityType)
async def create_entity_type(
    entity_type: EntityTypeCreate,
    current_user: CurrentUser,
) -> EntityType:
    """Create a new entity type in MCP server database."""
    data = await _mcp_request("POST", "/entity-types", json_data={
        "name": entity_type.name,
        "description": entity_type.description,
        "fields": [f.model_dump() for f in entity_type.fields],
    })
    return EntityType(**data)


@router.post("/reset")
async def reset_entity_types(current_user: CurrentUser) -> dict:
    """Reset entity types to config defaults."""
    data = await _mcp_request("POST", "/entity-types/reset")
    return data


@router.get("/{name}", response_model=EntityType)
async def get_entity_type(name: str, current_user: CurrentUser) -> EntityType:
    """Get a specific entity type from MCP server database."""
    data = await _mcp_request("GET", f"/entity-types/{name}")
    return EntityType(**data)


@router.put("/{name}", response_model=EntityType)
async def update_entity_type(
    name: str,
    update: EntityTypeUpdate,
    current_user: CurrentUser,
) -> EntityType:
    """Update an entity type in MCP server database."""
    update_data = {}
    if update.description is not None:
        update_data["description"] = update.description
    if update.fields is not None:
        update_data["fields"] = [f.model_dump() for f in update.fields]

    data = await _mcp_request("PUT", f"/entity-types/{name}", json_data=update_data)
    return EntityType(**data)


@router.delete("/{name}")
async def delete_entity_type(name: str, current_user: CurrentUser) -> dict:
    """Delete an entity type from MCP server database."""
    await _mcp_request("DELETE", f"/entity-types/{name}")
    return {"message": f"Entity type '{name}' deleted"}
