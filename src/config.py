"""Application configuration using Pydantic Settings."""

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application
    app_name: str = "Graphiti"
    debug: bool = False

    # Graphiti MCP Server
    graphiti_mcp_url: str = "http://graphiti-mcp:8000"
    graphiti_mcp_external_url: str = "http://localhost:8000"
    graphiti_mcp_container: str = "graphiti-mcp"  # Container name for restart

    # FalkorDB Browser (for external links)
    falkordb_browser_url: str = "http://localhost:3000"

    # Config file path (mounted volume)
    config_path: str = "/config/config.yaml"

    # Authentication
    admin_username: str = "admin"
    # Passwort wird NICHT mehr aus .env geladen - wird beim Setup in credentials.yaml gesetzt!

    # Secret Key - wird auto-generiert wenn nicht gesetzt
    secret_key: str = ""

    # JWT Settings
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 43200  # 30 Tage

    # CORS (if needed)
    cors_origins: list[str] = ["*"]

    def get_secret_key(self) -> str:
        """Get or generate secret key."""
        if self.secret_key:
            return self.secret_key

        # Auto-generate and persist secret key
        secret_file = Path(self.config_path).parent / ".secret_key"
        if secret_file.exists():
            return secret_file.read_text().strip()

        # Generate new secret key
        new_key = secrets.token_hex(32)
        secret_file.parent.mkdir(parents=True, exist_ok=True)
        secret_file.write_text(new_key)
        return new_key


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
