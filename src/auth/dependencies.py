# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Authentication dependencies."""

from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status

from .jwt import decode_token


async def get_current_user(
    access_token: Annotated[str | None, Cookie()] = None,
) -> dict:
    """Get the current authenticated user from JWT cookie."""
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = decode_token(access_token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    username = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    return {"username": username}


# Dependency type alias
CurrentUser = Annotated[dict, Depends(get_current_user)]
