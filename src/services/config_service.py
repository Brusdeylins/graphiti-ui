# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Configuration file service.

Handles reading/writing of config.yaml
"""

from pathlib import Path
from typing import Any

import yaml

from ..config import get_settings


def get_config_path() -> Path:
    """Get path to config file."""
    settings = get_settings()
    return Path(settings.config_path)


def read_config() -> dict[str, Any]:
    """Read configuration from YAML file."""
    config_path = get_config_path()

    if not config_path.exists():
        return {}

    with open(config_path) as f:
        return yaml.safe_load(f) or {}


def write_config(config: dict[str, Any]) -> None:
    """Write configuration to YAML file."""
    config_path = get_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)

    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)
