"""Graphiti UI - FastAPI Application Entry Point."""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings

# Import routers
from .api import router as api_router
from .auth import router as auth_router
from .api.mcp_proxy import router as mcp_proxy_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan handler."""
    settings = get_settings()
    print(f"Starting {settings.app_name}...")
    print(f"Graphiti MCP URL: {settings.graphiti_mcp_url}")
    print(f"Config Path: {settings.config_path}")
    yield
    print("Shutting down...")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description="Admin Interface for Graphiti Knowledge Graph",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        redirect_slashes=False,  # Prevent 307 redirects on POST requests
    )

    # Add CORS middleware for MCP client access
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include API routers
    app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
    app.include_router(api_router, prefix="/api", tags=["api"])
    app.include_router(mcp_proxy_router, prefix="/mcp", tags=["mcp"])

    # Determine frontend dist directory
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
    if not frontend_dist.exists():
        # Fallback for Docker - frontend built to /app/frontend/dist
        frontend_dist = Path("/app/frontend/dist")

    if frontend_dist.exists():
        # Serve static assets from Vite build
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        # Serve index.html for all non-API routes (SPA routing)
        @app.get("/{path:path}")
        async def serve_spa(path: str) -> FileResponse:
            """Serve React SPA for all routes."""
            # Check if it's a static file request
            file_path = frontend_dist / path
            if file_path.is_file():
                return FileResponse(file_path)
            # Otherwise serve index.html for client-side routing
            return FileResponse(frontend_dist / "index.html")
    else:
        # Fallback message when frontend not built
        @app.get("/{path:path}")
        async def frontend_not_found(path: str) -> dict:
            """Frontend not built."""
            return {
                "error": "Frontend not built",
                "message": "Run 'npm run build' in the frontend directory",
                "path": path,
            }

    return app


app = create_app()
