# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Docker container management service.

Allows restarting the MCP server container after config changes.
Requires docker.sock to be mounted.
"""

import asyncio
from pathlib import Path

from ..config import get_settings


def is_docker_available() -> bool:
    """Check if Docker socket is available."""
    return Path("/var/run/docker.sock").exists()


async def restart_mcp_container() -> dict:
    """Restart the Graphiti MCP container.

    Returns:
        dict with status and message
    """
    settings = get_settings()
    container_name = settings.graphiti_mcp_container

    if not is_docker_available():
        return {
            "success": False,
            "message": "Docker socket not available. Please restart manually.",
            "command": f"docker restart {container_name}",
        }

    try:
        # Use docker CLI via subprocess (simpler than docker-py)
        proc = await asyncio.create_subprocess_exec(
            "docker", "restart", container_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)

        if proc.returncode == 0:
            return {
                "success": True,
                "message": f"Container '{container_name}' restarted successfully.",
            }
        else:
            error_msg = stderr.decode().strip() if stderr else "Unknown error"
            return {
                "success": False,
                "message": f"Failed to restart container: {error_msg}",
            }

    except asyncio.TimeoutError:
        return {
            "success": False,
            "message": "Restart timed out. Container may still be restarting.",
        }
    except FileNotFoundError:
        return {
            "success": False,
            "message": "Docker CLI not found. Please restart manually.",
            "command": f"docker restart {container_name}",
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Error restarting container: {str(e)}",
        }


async def get_mcp_container_status() -> dict:
    """Get status of the MCP container.

    Returns:
        dict with container status
    """
    settings = get_settings()
    container_name = settings.graphiti_mcp_container

    if not is_docker_available():
        return {
            "available": False,
            "message": "Docker socket not available",
        }

    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "inspect", "-f", "{{.State.Status}}", container_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10.0)

        if proc.returncode == 0:
            status = stdout.decode().strip()
            return {
                "available": True,
                "container": container_name,
                "status": status,
                "running": status == "running",
            }
        else:
            return {
                "available": True,
                "container": container_name,
                "status": "not_found",
                "running": False,
            }

    except Exception as e:
        return {
            "available": False,
            "message": str(e),
        }
