"""MCP Proxy endpoint with API key authentication.

Proxies requests to the Graphiti MCP server after validating API keys.
"""

import httpx
from fastapi import APIRouter, Request, Response, HTTPException, status

from ..config import get_settings
from ..services.api_key_service import validate_api_key

router = APIRouter()


def get_api_key_from_header(request: Request) -> str | None:
    """Extract API key from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]  # Remove "Bearer " prefix
    return None


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def proxy_mcp(request: Request, path: str) -> Response:
    """Proxy requests to MCP server after API key validation.

    Requires a valid API key in the Authorization header:
    Authorization: Bearer gk_...
    """
    # Check for API key
    api_key = get_api_key_from_header(request)

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header with Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not validate_api_key(api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Forward request to MCP server
    # The MCP server's endpoint is at /mcp, so we prepend it
    # Strip trailing slashes to avoid 307 redirects
    settings = get_settings()
    mcp_url = f"{settings.graphiti_mcp_url}/mcp"
    if path:
        path = path.rstrip("/")
        if path:
            mcp_url = f"{mcp_url}/{path}"

    # Get request body if present
    body = await request.body()

    # Forward headers (except Authorization and Host)
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in ("host", "authorization", "content-length")
    }
    headers["Content-Type"] = request.headers.get("Content-Type", "application/json")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.request(
                method=request.method,
                url=mcp_url,
                content=body if body else None,
                headers=headers,
                params=dict(request.query_params),
            )

            # Return response with original status and headers
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers={
                    key: value
                    for key, value in response.headers.items()
                    if key.lower() not in ("transfer-encoding", "content-encoding")
                },
                media_type=response.headers.get("content-type", "application/json"),
            )

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="MCP server timeout",
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Cannot connect to MCP server",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"MCP proxy error: {str(e)[:100]}",
        )
