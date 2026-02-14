#!/bin/bash
# Build Graphiti UI container

set -e

cd "$(dirname "$0")"

echo "Building Graphiti UI container..."
echo "Build context: $(pwd)"
docker build --no-cache -t graphiti-ui:latest .

echo ""
echo "Done."
echo ""
echo "For production (from /v/graphiti/):"
echo "  stack rebuild"
echo ""
