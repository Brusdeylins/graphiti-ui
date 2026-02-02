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

    # Graphiti MCP Server (optional, for MCP-specific features)
    graphiti_mcp_url: str = "http://graphiti-mcp:8000"
    graphiti_mcp_external_url: str = "http://localhost:8000"
    graphiti_mcp_container: str = "graphiti-mcp"  # Container name for restart

    # Graph Database Configuration
    graph_provider: str = "falkordb"  # falkordb, neo4j, kuzu, neptune

    # FalkorDB Connection
    falkordb_host: str = "falkordb"
    falkordb_port: int = 6379
    falkordb_password: str = ""
    falkordb_database: str = "graphiti"

    # Neo4j Connection (if graph_provider=neo4j)
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = ""
    neo4j_database: str = "neo4j"

    # Kuzu Connection (if graph_provider=kuzu)
    kuzu_db_path: str = ":memory:"

    # Neptune Connection (if graph_provider=neptune)
    # host format: neptune-db://<endpoint> or neptune-graph://<graphid>
    neptune_host: str = ""
    neptune_port: int = 8182
    neptune_aoss_host: str = ""  # OpenSearch Serverless host (required)
    neptune_aoss_port: int = 443

    # Graphiti Settings
    graphiti_group_id: str = "main"  # Default group_id for graph operations

    # LLM Configuration (for embeddings)
    openai_api_key: str = ""
    openai_api_url: str = "https://api.openai.com/v1"
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536

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
