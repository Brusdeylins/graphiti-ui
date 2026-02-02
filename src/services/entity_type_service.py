"""Entity Type Service - HTTP client to MCP server.

All entity type management is delegated to the MCP server which stores
entity types in a JSON file. This makes the UI database-neutral.
"""

import logging
from typing import Any

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


class EntityType:
    """Entity type model."""

    def __init__(
        self,
        name: str,
        description: str,
        fields: list[dict[str, Any]] | None = None,
        source: str = "api",
        created_at: str | None = None,
        modified_at: str | None = None,
    ):
        self.name = name
        self.description = description
        self.fields = fields or []
        self.source = source
        self.created_at = created_at
        self.modified_at = modified_at

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "fields": self.fields,
            "source": self.source,
            "created_at": self.created_at,
            "modified_at": self.modified_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EntityType":
        return cls(
            name=data["name"],
            description=data.get("description", ""),
            fields=data.get("fields", []),
            source=data.get("source", "api"),
            created_at=data.get("created_at"),
            modified_at=data.get("modified_at"),
        )


class EntityTypeService:
    """Service for managing entity types via MCP HTTP endpoints."""

    def __init__(self):
        self._mcp_url: str | None = None

    @property
    def mcp_url(self) -> str:
        """Get the MCP server URL."""
        if self._mcp_url is None:
            settings = get_settings()
            self._mcp_url = settings.graphiti_mcp_url
        return self._mcp_url

    async def get_all(self) -> list[EntityType]:
        """Get all entity types from MCP server."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{self.mcp_url}/entity-types")
                response.raise_for_status()
                data = response.json()
                return [EntityType.from_dict(t) for t in data]
        except Exception as e:
            logger.error(f"Error getting entity types from MCP: {e}")
            return []

    async def get_by_name(self, name: str) -> EntityType | None:
        """Get entity type by name from MCP server."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{self.mcp_url}/entity-types/{name}")
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                return EntityType.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            logger.error(f"Error getting entity type {name} from MCP: {e}")
            return None
        except Exception as e:
            logger.error(f"Error getting entity type {name} from MCP: {e}")
            return None

    async def create(
        self,
        name: str,
        description: str,
        fields: list[dict[str, Any]] | None = None,
    ) -> EntityType:
        """Create a new entity type via MCP server."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.mcp_url}/entity-types",
                json={
                    "name": name,
                    "description": description,
                    "fields": fields or [],
                },
            )
            if response.status_code == 409:
                raise ValueError(f"Entity type '{name}' already exists")
            response.raise_for_status()
            logger.info(f"Created entity type via MCP: {name}")
            return EntityType.from_dict(response.json())

    async def update(
        self,
        name: str,
        description: str | None = None,
        fields: list[dict[str, Any]] | None = None,
    ) -> EntityType | None:
        """Update an entity type via MCP server."""
        try:
            payload: dict[str, Any] = {}
            if description is not None:
                payload["description"] = description
            if fields is not None:
                payload["fields"] = fields

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.put(
                    f"{self.mcp_url}/entity-types/{name}",
                    json=payload,
                )
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                logger.info(f"Updated entity type via MCP: {name}")
                return EntityType.from_dict(response.json())
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise
        except Exception as e:
            logger.error(f"Error updating entity type {name} via MCP: {e}")
            return None

    async def delete(self, name: str) -> bool:
        """Delete an entity type via MCP server."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.delete(f"{self.mcp_url}/entity-types/{name}")
                if response.status_code == 404:
                    return False
                response.raise_for_status()
                logger.info(f"Deleted entity type via MCP: {name}")
                return True
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return False
            raise
        except Exception as e:
            logger.error(f"Error deleting entity type {name} via MCP: {e}")
            return False

    async def reset_to_defaults(self) -> list[EntityType]:
        """Reset entity types to defaults via MCP server."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(f"{self.mcp_url}/entity-types/reset")
            response.raise_for_status()
            result = response.json()
            logger.info(f"Reset entity types via MCP: {result.get('count', 0)} types")

            # Fetch the updated list
            return await self.get_all()

    async def close(self):
        """Close the service (no-op for HTTP client)."""
        pass


# Singleton instance
_entity_type_service: EntityTypeService | None = None


def get_entity_type_service() -> EntityTypeService:
    """Get the EntityTypeService singleton."""
    global _entity_type_service
    if _entity_type_service is None:
        _entity_type_service = EntityTypeService()
    return _entity_type_service
