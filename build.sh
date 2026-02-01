#!/bin/bash
# Build Graphiti UI container
# Note: Build context is the parent directory to include graphiti-milofax

set -e

# Navigate to project directory (parent of graphiti-ui)
cd "$(dirname "$0")/.."

echo "Building Graphiti UI container..."
echo "Build context: $(pwd)"
docker build --no-cache -t graphiti-ui:latest -f graphiti-ui/Dockerfile .

echo ""
echo "Done."
echo ""
echo "For production (from /v/graphiti/):"
echo "  stack rebuild"
echo ""
