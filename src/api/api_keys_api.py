# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""API Keys management routes."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ..auth.dependencies import CurrentUser
from ..services.api_key_service import (
    create_api_key,
    list_api_keys,
    delete_api_key,
)

router = APIRouter()


# ============================================
# Models
# ============================================


class CreateApiKeyRequest(BaseModel):
    """Request to create a new API key."""

    name: str


class ApiKeyResponse(BaseModel):
    """API key response (with full key, only at creation)."""

    name: str
    key: str
    key_prefix: str
    created_at: str


class ApiKeyListItem(BaseModel):
    """API key list item."""

    name: str
    key_prefix: str
    full_key: str = ""
    created_at: str
    last_used: str | None = None


class ApiKeyListResponse(BaseModel):
    """Response for listing API keys."""

    keys: list[ApiKeyListItem]


# ============================================
# Endpoints
# ============================================


@router.get("", response_model=ApiKeyListResponse)
async def get_api_keys(current_user: CurrentUser) -> ApiKeyListResponse:
    """List all API keys (masked)."""
    keys = list_api_keys()
    return ApiKeyListResponse(keys=[ApiKeyListItem(**k) for k in keys])


@router.post("", response_model=ApiKeyResponse, status_code=status.HTTP_201_CREATED)
async def create_new_api_key(
    request: CreateApiKeyRequest,
    current_user: CurrentUser,
) -> ApiKeyResponse:
    """Create a new API key.

    The full key is only returned at creation time.
    """
    if not request.name or not request.name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name is required",
        )

    key_data = create_api_key(request.name.strip())
    return ApiKeyResponse(**key_data)


@router.delete("/{key_prefix}")
async def delete_existing_api_key(
    key_prefix: str,
    current_user: CurrentUser,
) -> dict:
    """Delete an API key by its prefix."""
    if delete_api_key(key_prefix):
        return {"success": True, "message": "API key deleted"}

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="API key not found",
    )
