"""Credentials management service.

Handles:
- Admin password (hashed, stored in credentials.yaml)
- LLM API credentials (read from environment variables)
- Embedding API credentials (read from environment variables)
"""

import os
from pathlib import Path
from typing import Any

import bcrypt
import yaml

from ..config import get_settings

# Default credentials structure (admin only - LLM/Embedder from env)
DEFAULT_CREDENTIALS = {
    "admin": {
        "password_hash": None,
        "initialized": False,
    },
}


def get_credentials_path() -> Path:
    """Get path to credentials file."""
    settings = get_settings()
    config_dir = Path(settings.config_path).parent
    return config_dir / "credentials.yaml"


def read_credentials() -> dict[str, Any]:
    """Read credentials from YAML file."""
    creds_path = get_credentials_path()

    if not creds_path.exists():
        # Create default credentials file
        write_credentials(DEFAULT_CREDENTIALS)
        return DEFAULT_CREDENTIALS.copy()

    with open(creds_path) as f:
        creds = yaml.safe_load(f) or {}

    # Merge with defaults for any missing keys
    for key, value in DEFAULT_CREDENTIALS.items():
        if key not in creds:
            creds[key] = value
        elif isinstance(value, dict):
            for subkey, subvalue in value.items():
                if subkey not in creds[key]:
                    creds[key][subkey] = subvalue

    return creds


def write_credentials(credentials: dict[str, Any]) -> None:
    """Write credentials to YAML file."""
    creds_path = get_credentials_path()
    creds_path.parent.mkdir(parents=True, exist_ok=True)

    with open(creds_path, "w") as f:
        yaml.dump(credentials, f, default_flow_style=False, sort_keys=False)


def is_initialized() -> bool:
    """Check if admin password has been set (first-run complete)."""
    creds = read_credentials()
    return creds.get("admin", {}).get("initialized", False)


def set_admin_password(password: str) -> None:
    """Set admin password (hash it and store)."""
    creds = read_credentials()
    # Hash password with bcrypt
    password_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    password_hash = bcrypt.hashpw(password_bytes, salt).decode("utf-8")
    creds["admin"]["password_hash"] = password_hash
    creds["admin"]["initialized"] = True
    write_credentials(creds)


def verify_admin_password(password: str) -> bool:
    """Verify admin password against stored hash."""
    creds = read_credentials()
    password_hash = creds.get("admin", {}).get("password_hash")

    if not password_hash:
        return False

    password_bytes = password.encode("utf-8")
    hash_bytes = password_hash.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hash_bytes)


def get_llm_credentials() -> dict[str, Any]:
    """Get LLM credentials from environment variables."""
    return {
        "api_url": os.environ.get("OPENAI_API_URL", "http://localhost:11434/v1"),
        "api_key": os.environ.get("OPENAI_API_KEY", ""),
        "model": os.environ.get("LLM_MODEL", "llama3"),
    }


def get_embedder_credentials() -> dict[str, Any]:
    """Get embedder credentials from environment variables."""
    dimensions_str = os.environ.get("EMBEDDING_DIM", "768")
    try:
        dimensions = int(dimensions_str)
    except ValueError:
        dimensions = 768

    return {
        "api_url": os.environ.get("OPENAI_API_URL", "http://localhost:11434/v1"),
        "api_key": os.environ.get("OPENAI_API_KEY", ""),
        "model": os.environ.get("EMBEDDING_MODEL", "nomic-embed-text"),
        "dimensions": dimensions,
    }
