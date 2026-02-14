# Graphiti UI — Admin interface for Graphiti Knowledge Graph
# Copyright (c) 2026 Matthias Brusdeylins
# SPDX-License-Identifier: MIT
# 100% AI-generated code (vibe-coding with Claude)

"""Configuration models matching Graphiti config.yaml structure."""

from typing import Any

from pydantic import BaseModel, Field


class EntityTypeConfig(BaseModel):
    """Entity type configuration."""

    name: str = Field(..., pattern=r"^[A-Z][a-zA-Z0-9]*$")
    description: str = Field(..., min_length=10)


class LLMProviderConfig(BaseModel):
    """LLM provider configuration."""

    api_key: str = Field(default="${OLLAMA_API_KEY}")
    api_url: str = Field(default="http://localhost:11434/v1")
    organization_id: str | None = None


class LLMConfig(BaseModel):
    """LLM configuration."""

    provider: str = Field(default="openai")
    model: str = Field(default="llama3")
    max_tokens: int = Field(default=4096)
    providers: dict[str, LLMProviderConfig] = Field(default_factory=dict)


class EmbedderProviderConfig(BaseModel):
    """Embedder provider configuration."""

    api_key: str = Field(default="${OLLAMA_API_KEY}")
    api_url: str = Field(default="http://localhost:11434/v1")


class EmbedderConfig(BaseModel):
    """Embedder configuration."""

    provider: str = Field(default="openai")
    model: str = Field(default="nomic-embed-text")
    dimensions: int = Field(default=768)
    providers: dict[str, EmbedderProviderConfig] = Field(default_factory=dict)


class DatabaseProviderConfig(BaseModel):
    """Database provider configuration."""

    uri: str
    password: str | None = None
    database: str | None = None


class DatabaseConfig(BaseModel):
    """Database configuration."""

    provider: str = Field(default="falkordb")
    providers: dict[str, DatabaseProviderConfig] = Field(default_factory=dict)


class GraphitiSectionConfig(BaseModel):
    """Graphiti section configuration."""

    group_id: str = Field(default="main")
    episode_id_prefix: str = Field(default="")
    user_id: str = Field(default="mcp_user")
    entity_types: list[EntityTypeConfig] = Field(default_factory=list)


class ServerConfig(BaseModel):
    """Server configuration."""

    transport: str = Field(default="http")
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)


class GraphitiConfig(BaseModel):
    """Complete Graphiti configuration matching config.yaml."""

    server: ServerConfig = Field(default_factory=ServerConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    embedder: EmbedderConfig = Field(default_factory=EmbedderConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    graphiti: GraphitiSectionConfig = Field(default_factory=GraphitiSectionConfig)
