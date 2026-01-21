# Graphiti Knowledge Graph

Admin interface and MCP proxy for Graphiti Knowledge Graph.

## Features

- **Dashboard** - Service status (LLM, Embedder), MCP configuration
- **Visualization** - Interactive D3.js graph with node details
- **Query** - Cypher query editor with graph selection
- **Config** - Entity types, LLM/Embedding settings
- **API Keys** - Manage MCP API keys

## Tech Stack

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | React 18 + TypeScript |
| Build Tool | Vite |
| UI Framework | [Tabler](https://tabler.io) (Bootstrap 5) |
| Icons | @tabler/icons-react |
| Graph Rendering | D3.js (Force-Directed Layout) |
| HTTP Client | Axios |

### Backend
| Component | Technology |
|-----------|------------|
| Framework | FastAPI (Python 3.11) |
| ASGI Server | Uvicorn |
| Validation | Pydantic |
| Auth | JWT (python-jose) |
| DB Client | FalkorDB Python SDK |

### Infrastructure
| Component | Technology |
|-----------|------------|
| Graph Database | FalkorDB (Redis-based) |
| MCP Server | zepai/knowledge-graph-mcp |
| Reverse Proxy | Traefik v2 |

## Directory Structure

```
graphiti-ui/
├── README.md                   # This file
├── build.sh                    # Build script
├── Dockerfile                  # Multi-stage build
├── pyproject.toml              # Python dependencies
├── .env.example                # Environment template
├── docker-compose.example.yml  # Local development
├── frontend/                   # React frontend
└── src/                        # FastAPI backend
```

## Quick Start (Development)

### With Docker (recommended)

```bash
# Prepare environment
cp .env.example .env

# Start local stack (FalkorDB + MCP + UI)
docker compose -f docker-compose.example.yml up -d

# Open browser
open http://localhost:8080
```

### Without Docker (local development)

```bash
# Backend dependencies
pip install -e .

# Frontend dependencies
cd frontend && npm install && cd ..

# Environment
cp .env.example .env

# Start FalkorDB separately
docker run -d -p 6379:6379 -p 3000:3000 falkordb/falkordb:latest

# Start backend
uvicorn src.main:app --reload --port 8080

# Start frontend (separate terminal)
cd frontend && npm run dev
```

## Production Build

```bash
./build.sh

# Or manually
docker build -t graphiti-ui:latest .
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| **API Endpoints** | | |
| `GRAPHITI_MCP_URL` | MCP server URL (internal) | `http://graphiti-mcp:8000` |
| `GRAPHITI_MCP_EXTERNAL_URL` | MCP server URL (external) | `http://localhost:8000` |
| `GRAPHITI_MCP_CONTAINER` | Container name for restart | `graphiti-mcp` |
| `FALKORDB_BROWSER_URL` | FalkorDB browser URL | `http://localhost:3000` |
| **FalkorDB Connection** | | |
| `FALKORDB_HOST` | Hostname | `falkordb` |
| `FALKORDB_PORT` | Port | `6379` |
| `FALKORDB_PASSWORD` | Redis auth password | _(empty)_ |
| `FALKORDB_DATABASE` | Graph name | `graphiti` |
| **LLM/Embedding** | | |
| `OLLAMA_API_URL` | OpenAI-compatible API URL | `http://localhost:11434/v1` |
| `OLLAMA_API_KEY` | API key | `sk-ollama` |
| `LLM_MODEL` | LLM model name | `claude` |
| `EMBEDDING_MODEL` | Embedding model | `nomic-embed-text` |
| `EMBEDDING_DIM` | Vector dimensions | `768` |
| **Auth** | | |
| `ADMIN_USERNAME` | Admin username | `admin` |
| `SECRET_KEY` | JWT signing key | _(auto-generated)_ |
| `JWT_EXPIRE_MINUTES` | Session timeout | `480` (8h) |
| **Config** | | |
| `CONFIG_PATH` | Path to config.yaml | `/config/config.yaml` |
| `DEBUG` | Debug mode | `false` |

## Links

- [Graphiti GitHub](https://github.com/getzep/graphiti)
- [FalkorDB](https://github.com/FalkorDB/FalkorDB)
- [Tabler UI](https://tabler.io/)
- [MCP Specification](https://modelcontextprotocol.io/)

## License

MIT
