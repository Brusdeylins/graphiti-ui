"""Driver Factory - creates database-neutral GraphDriver instances.

Reads graph_provider from config and creates the appropriate driver.
"""

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from graphiti_core.driver.driver import GraphDriver

from ..config import Settings

logger = logging.getLogger(__name__)


def create_driver(settings: Settings) -> "GraphDriver":
    """Create a GraphDriver based on config settings.

    Args:
        settings: Application settings with database configuration.

    Returns:
        GraphDriver instance for the configured provider.

    Raises:
        ValueError: If graph_provider is not supported.
    """
    provider = settings.graph_provider.lower()

    if provider == "falkordb":
        from graphiti_core.driver.falkordb_driver import FalkorDriver

        logger.info(f"Creating FalkorDriver: {settings.falkordb_host}:{settings.falkordb_port}")
        return FalkorDriver(
            host=settings.falkordb_host,
            port=settings.falkordb_port,
            password=settings.falkordb_password or None,
            database=settings.falkordb_database,
        )

    elif provider == "neo4j":
        from graphiti_core.driver.neo4j_driver import Neo4jDriver

        logger.info(f"Creating Neo4jDriver: {settings.neo4j_uri}")
        return Neo4jDriver(
            uri=settings.neo4j_uri,
            user=settings.neo4j_user or None,
            password=settings.neo4j_password or None,
            database=settings.neo4j_database,
        )

    elif provider == "kuzu":
        from graphiti_core.driver.kuzu_driver import KuzuDriver

        logger.info(f"Creating KuzuDriver: {settings.kuzu_db_path}")
        return KuzuDriver(db=settings.kuzu_db_path)

    elif provider == "neptune":
        from graphiti_core.driver.neptune_driver import NeptuneDriver

        logger.info(f"Creating NeptuneDriver: {settings.neptune_host}")
        return NeptuneDriver(
            host=settings.neptune_host,
            port=settings.neptune_port,
            aoss_host=settings.neptune_aoss_host,
            aoss_port=settings.neptune_aoss_port,
        )

    else:
        raise ValueError(
            f"Unsupported graph_provider: {provider}. "
            f"Supported: falkordb, neo4j, kuzu, neptune"
        )
