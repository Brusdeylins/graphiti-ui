# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""JWT token handling."""

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

from ..config import get_settings


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """Create a JWT access token."""
    settings = get_settings()
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)

    to_encode.update({"exp": expire})
    secret_key = settings.get_secret_key()
    return jwt.encode(to_encode, secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT token."""
    settings = get_settings()
    try:
        secret_key = settings.get_secret_key()
        payload = jwt.decode(token, secret_key, algorithms=[settings.jwt_algorithm])
        return payload
    except JWTError:
        return None
