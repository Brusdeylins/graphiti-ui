# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Entity Types API routes - proxies to MCP server."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..auth.dependencies import CurrentUser
from ..services.entity_type_service import get_entity_type_service

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

    description: str | None = Field(default=None, min_length=10, description="Description")
    fields: list[EntityTypeField] | None = Field(default=None, description="Structured fields")


@router.get("")
async def list_entity_types(current_user: CurrentUser) -> list[EntityType]:
    """List all entity types from MCP server."""
    service = get_entity_type_service()
    entity_types = await service.get_all()
    return [
        EntityType(
            name=et.name,
            description=et.description,
            fields=[EntityTypeField(**f) for f in et.fields],
            source=et.source,
            created_at=et.created_at,
            modified_at=et.modified_at,
        )
        for et in entity_types
    ]


@router.post("", response_model=EntityType)
async def create_entity_type(
    entity_type: EntityTypeCreate,
    current_user: CurrentUser,
) -> EntityType:
    """Create a new entity type via MCP server."""
    service = get_entity_type_service()
    try:
        et = await service.create(
            name=entity_type.name,
            description=entity_type.description,
            fields=[f.model_dump() for f in entity_type.fields],
        )
        return EntityType(
            name=et.name,
            description=et.description,
            fields=[EntityTypeField(**f) for f in et.fields],
            source=et.source,
            created_at=et.created_at,
            modified_at=et.modified_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/reset")
async def reset_entity_types(current_user: CurrentUser) -> dict:
    """Reset entity types to config defaults via MCP server."""
    service = get_entity_type_service()
    try:
        entity_types = await service.reset_to_defaults()
        return {
            "success": True,
            "message": f"Reset {len(entity_types)} entity types from config",
            "count": len(entity_types),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}", response_model=EntityType)
async def get_entity_type(name: str, current_user: CurrentUser) -> EntityType:
    """Get a specific entity type from MCP server."""
    service = get_entity_type_service()
    et = await service.get_by_name(name)
    if not et:
        raise HTTPException(status_code=404, detail=f"Entity type '{name}' not found")
    return EntityType(
        name=et.name,
        description=et.description,
        fields=[EntityTypeField(**f) for f in et.fields],
        source=et.source,
        created_at=et.created_at,
        modified_at=et.modified_at,
    )


@router.put("/{name}", response_model=EntityType)
async def update_entity_type(
    name: str,
    update: EntityTypeUpdate,
    current_user: CurrentUser,
) -> EntityType:
    """Update an entity type via MCP server."""
    service = get_entity_type_service()

    fields = [f.model_dump() for f in update.fields] if update.fields else None
    et = await service.update(
        name=name,
        description=update.description,
        fields=fields,
    )

    if not et:
        raise HTTPException(status_code=404, detail=f"Entity type '{name}' not found")

    return EntityType(
        name=et.name,
        description=et.description,
        fields=[EntityTypeField(**f) for f in et.fields],
        source=et.source,
        created_at=et.created_at,
        modified_at=et.modified_at,
    )


@router.delete("/{name}")
async def delete_entity_type(name: str, current_user: CurrentUser) -> dict:
    """Delete an entity type via MCP server."""
    service = get_entity_type_service()
    success = await service.delete(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Entity type '{name}' not found")
    return {"message": f"Entity type '{name}' deleted"}
