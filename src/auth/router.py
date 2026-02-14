# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Authentication API routes."""

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..services.credentials_service import (
    is_initialized,
    set_admin_password,
    verify_admin_password,
)
from .dependencies import CurrentUser
from .jwt import create_access_token

router = APIRouter()


class LoginRequest(BaseModel):
    """Login request model."""

    username: str
    password: str


class LoginResponse(BaseModel):
    """Login response model."""

    message: str
    username: str


class UserResponse(BaseModel):
    """Current user response model."""

    username: str


class SetupRequest(BaseModel):
    """First-run setup request model."""

    password: str = Field(..., min_length=8, description="Admin password (min 8 chars)")
    password_confirm: str = Field(..., description="Confirm password")


class SetupStatusResponse(BaseModel):
    """Setup status response."""

    initialized: bool
    message: str


class LogoutResponse(BaseModel):
    """Logout response model."""

    message: str


@router.get("/setup-status", response_model=SetupStatusResponse)
async def get_setup_status() -> SetupStatusResponse:
    """Check if initial setup has been completed."""
    initialized = is_initialized()
    return SetupStatusResponse(
        initialized=initialized,
        message="Setup complete" if initialized else "Setup required - please set admin password",
    )


@router.post("/setup", response_model=LoginResponse)
async def initial_setup(
    form: SetupRequest,
    response: Response
) -> LoginResponse:
    """First-run setup: Set admin password."""
    # Check if already initialized
    if is_initialized():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Setup already completed. Use /login instead.",
        )

    # Validate passwords match
    if form.password != form.password_confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match",
        )

    # Set admin password
    set_admin_password(form.password)

    settings = get_settings()

    # Auto-login after setup
    token = create_access_token(data={"sub": settings.admin_username})

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=settings.jwt_expire_minutes * 60,
    )

    return LoginResponse(message="Setup complete", username=settings.admin_username)


@router.post("/login", response_model=LoginResponse)
async def login(
    form: LoginRequest,
    response: Response
) -> LoginResponse:
    """Authenticate user and set JWT cookie."""
    settings = get_settings()

    # Check if setup is required
    if not is_initialized():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Initial setup required. Please complete setup first.",
        )

    # Verify credentials
    if form.username != settings.admin_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    if not verify_admin_password(form.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # Create JWT token
    token = create_access_token(data={"sub": form.username})

    # Set httponly cookie
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=settings.jwt_expire_minutes * 60,
    )

    return LoginResponse(message="Login successful", username=form.username)


@router.post("/logout", response_model=LogoutResponse)
async def logout_post(response: Response) -> LogoutResponse:
    """Clear authentication cookie (POST)."""
    response.delete_cookie(key="access_token")
    return LogoutResponse(message="Logged out successfully")


@router.get("/logout", response_model=LogoutResponse)
async def logout_get(response: Response) -> LogoutResponse:
    """Clear authentication cookie (GET) and redirect to login."""
    response.delete_cookie(key="access_token")
    return LogoutResponse(message="Logged out successfully")


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: CurrentUser) -> UserResponse:
    """Get current authenticated user info."""
    return UserResponse(username=current_user["username"])
