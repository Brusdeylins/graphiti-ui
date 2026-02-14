# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""API Key management service.

Stores API keys in a JSON file for MCP endpoint authentication.
"""

import json
import secrets
from datetime import datetime
from pathlib import Path
from typing import Any

# API keys storage file
API_KEYS_FILE = Path("/app/data/api_keys.json")


def _ensure_data_dir() -> None:
    """Ensure data directory exists."""
    API_KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)


def _load_api_keys() -> dict[str, Any]:
    """Load API keys from file."""
    _ensure_data_dir()
    if not API_KEYS_FILE.exists():
        return {"keys": []}
    try:
        with open(API_KEYS_FILE, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"keys": []}


def _save_api_keys(data: dict[str, Any]) -> None:
    """Save API keys to file."""
    _ensure_data_dir()
    with open(API_KEYS_FILE, "w") as f:
        json.dump(data, f, indent=2)


def generate_api_key() -> str:
    """Generate a new API key."""
    return f"gk_{secrets.token_urlsafe(32)}"


def create_api_key(name: str) -> dict[str, Any]:
    """Create a new API key.

    Args:
        name: Display name for the key

    Returns:
        Dict with key details including the full key
    """
    data = _load_api_keys()

    key = generate_api_key()

    key_entry = {
        "name": name,
        "key_prefix": key[:12],
        "full_key": key,
        "created_at": datetime.utcnow().isoformat(),
        "last_used": None,
    }

    data["keys"].append(key_entry)
    _save_api_keys(data)

    return {
        "name": name,
        "key": key,
        "key_prefix": key[:12],
        "created_at": key_entry["created_at"],
    }


def list_api_keys() -> list[dict[str, Any]]:
    """List all API keys.

    Returns:
        List of API key entries with full keys for copy functionality
    """
    data = _load_api_keys()

    return [
        {
            "name": k["name"],
            "key_prefix": k["key_prefix"],
            "full_key": k.get("full_key", ""),  # Return full key for copy
            "created_at": k["created_at"],
            "last_used": k.get("last_used"),
        }
        for k in data["keys"]
    ]


def delete_api_key(key_prefix: str) -> bool:
    """Delete an API key by prefix.

    Args:
        key_prefix: The prefix of the key to delete

    Returns:
        True if deleted, False if not found
    """
    data = _load_api_keys()

    original_count = len(data["keys"])
    data["keys"] = [k for k in data["keys"] if k["key_prefix"] != key_prefix]

    if len(data["keys"]) < original_count:
        _save_api_keys(data)
        return True

    return False


def validate_api_key(key: str) -> bool:
    """Validate an API key.

    Args:
        key: The full API key to validate

    Returns:
        True if valid, False otherwise
    """
    if not key or not key.startswith("gk_"):
        return False

    data = _load_api_keys()

    for k in data["keys"]:
        if k.get("full_key") == key:
            # Update last_used timestamp
            k["last_used"] = datetime.utcnow().isoformat()
            _save_api_keys(data)
            return True

    return False
