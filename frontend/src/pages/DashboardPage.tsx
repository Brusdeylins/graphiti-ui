import { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  IconExternalLink,
  IconBrandGithub,
  IconApi,
  IconDatabase,
  IconBrain,
  IconVectorBezier2,
  IconLoader2,
} from '@tabler/icons-react';

// CSS for spinning animation
const spinKeyframes = `
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin { animation: spin 1s linear infinite; }
`;

// Inject styles once
if (typeof document !== 'undefined' && !document.getElementById('dashboard-spin-styles')) {
  const style = document.createElement('style');
  style.id = 'dashboard-spin-styles';
  style.textContent = spinKeyframes;
  document.head.appendChild(style);
}

interface LLMStatus {
  api_url: string;
  model: string;
  reachable: boolean;
  model_available: boolean;
  available_models: string[];
  error?: string;
}

interface EmbedderStatus {
  api_url: string;
  model: string;
  dimensions: number;
  reachable: boolean;
  model_available: boolean;
  available_models: string[];
  error?: string;
}

interface QueueStatus {
  total_pending: number;
  currently_processing: number;
  error?: string | null;
}

export function DashboardPage() {
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null);
  const [embedderStatus, setEmbedderStatus] = useState<EmbedderStatus | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [falkordbBrowserUrl, setFalkordbBrowserUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // Initial fetch of all status data
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [llmRes, embedderRes, statusRes] = await Promise.all([
          api.get('/config/llm/status').catch(() => ({ data: { api_url: '', model: '', reachable: false, error: 'Failed to fetch' } })),
          api.get('/config/embedder/status').catch(() => ({ data: { api_url: '', model: '', dimensions: 768, reachable: false, error: 'Failed to fetch' } })),
          api.get('/dashboard/status').catch(() => ({ data: { falkordb: { browser_url: '' } } })),
        ]);
        setLlmStatus(llmRes.data);
        setEmbedderStatus(embedderRes.data);
        setFalkordbBrowserUrl(statusRes.data?.falkordb?.browser_url || '');
        setQueueStatus(statusRes.data?.queue || null);
      } catch (error) {
        console.error('Failed to fetch status:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStatus();
  }, []);

  // Auto-refresh queue status every 2 seconds
  useEffect(() => {
    const fetchQueueStatus = async () => {
      try {
        const res = await api.get('/dashboard/status').catch(() => null);
        if (res?.data?.queue) {
          setQueueStatus(res.data.queue);
        }
      } catch {
        // Silently ignore polling errors
      }
    };

    const interval = setInterval(fetchQueueStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const mcpEndpoint = `${window.location.origin}/mcp/`;

  return (
    <div className="page-header d-print-none">
      <div className="row align-items-center mb-4">
        <div className="col">
          <h2 className="page-title">Dashboard</h2>
          <div className="text-secondary mt-1">
            Overview of your Graphiti Knowledge Graph
          </div>
        </div>
      </div>

      {/* Service Status */}
      <h3 className="mb-3">Service Status</h3>
      <div className="row row-deck row-cards mb-4">
        {/* LLM Status */}
        <div className="col-md-4">
          <div className="card">
            <div className="card-body">
              <div className="subheader">LLM Provider</div>
              {isLoading ? (
                <div className="placeholder-glow">
                  <span className="placeholder col-6"></span>
                </div>
              ) : (
                <>
                  <div className="d-flex align-items-center mt-2">
                    <IconBrain size={24} className={`me-2 ${llmStatus?.reachable && llmStatus?.model_available ? 'text-success' : 'text-danger'}`} />
                    <span className={`h3 mb-0 ${llmStatus?.reachable && llmStatus?.model_available ? 'text-success' : 'text-danger'}`}>
                      {!llmStatus?.reachable ? 'Unreachable' : !llmStatus?.model_available ? 'Model Not Found' : 'Connected'}
                    </span>
                  </div>
                  <div className="mt-2">
                    <code className={`small ${!llmStatus?.model_available && llmStatus?.reachable ? 'text-danger' : ''}`}>
                      {llmStatus?.model || 'Not configured'}
                    </code>
                  </div>
                  <div className="mt-1 text-truncate" title={llmStatus?.api_url}>
                    <code className="small">{llmStatus?.api_url || '-'}</code>
                  </div>
                  {llmStatus?.error && (
                    <div className="mt-2 text-danger small">{llmStatus.error}</div>
                  )}
                  {llmStatus?.reachable && !llmStatus?.model_available && llmStatus?.available_models?.length > 0 && (
                    <div className="mt-2">
                      <small className="text-muted">Available: {llmStatus.available_models.slice(0, 5).join(', ')}{llmStatus.available_models.length > 5 ? '...' : ''}</small>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Embedder Status */}
        <div className="col-md-4">
          <div className="card">
            <div className="card-body">
              <div className="subheader">Embedder</div>
              {isLoading ? (
                <div className="placeholder-glow">
                  <span className="placeholder col-6"></span>
                </div>
              ) : (
                <>
                  <div className="d-flex align-items-center mt-2">
                    <IconVectorBezier2 size={24} className={`me-2 ${embedderStatus?.reachable && embedderStatus?.model_available ? 'text-success' : 'text-danger'}`} />
                    <span className={`h3 mb-0 ${embedderStatus?.reachable && embedderStatus?.model_available ? 'text-success' : 'text-danger'}`}>
                      {!embedderStatus?.reachable ? 'Unreachable' : !embedderStatus?.model_available ? 'Model Not Found' : 'Connected'}
                    </span>
                  </div>
                  <div className="mt-2">
                    <code className={`small ${!embedderStatus?.model_available && embedderStatus?.reachable ? 'text-danger' : ''}`}>
                      {embedderStatus?.model || 'Not configured'}
                    </code>
                    {embedderStatus?.dimensions && <code className="small ms-2">{embedderStatus.dimensions}d</code>}
                  </div>
                  <div className="mt-1 text-truncate" title={embedderStatus?.api_url}>
                    <code className="small">{embedderStatus?.api_url || '-'}</code>
                  </div>
                  {embedderStatus?.error && (
                    <div className="mt-2 text-danger small">{embedderStatus.error}</div>
                  )}
                  {embedderStatus?.reachable && !embedderStatus?.model_available && embedderStatus?.available_models?.length > 0 && (
                    <div className="mt-2">
                      <small className="text-muted">Available: {embedderStatus.available_models.slice(0, 5).join(', ')}{embedderStatus.available_models.length > 5 ? '...' : ''}</small>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Queue Processing Status */}
        <div className="col-md-4">
          <div className="card">
            <div className="card-body">
              <div className="subheader">Processing Queue</div>
              {isLoading ? (
                <div className="placeholder-glow">
                  <span className="placeholder col-6"></span>
                </div>
              ) : (
                <>
                  <div className="d-flex align-items-center mt-2">
                    <IconLoader2 size={24} className={`me-2 ${(queueStatus?.currently_processing ?? 0) > 0 ? 'text-warning spin' : 'text-success'}`} />
                    <span className={`h3 mb-0 ${(queueStatus?.currently_processing ?? 0) > 0 ? 'text-warning' : 'text-success'}`}>
                      {(queueStatus?.currently_processing ?? 0) > 0 ? 'Processing' : 'Idle'}
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className="h2 mb-0">{queueStatus?.total_pending ?? 0}</span>
                    <span className="text-muted ms-2">pending</span>
                  </div>
                  <div className="mt-1">
                    <small className="text-muted">
                      {queueStatus?.currently_processing ?? 0} currently processing
                    </small>
                  </div>
                  {queueStatus?.error && (
                    <div className="mt-2 text-danger small">{queueStatus.error}</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MCP Endpoint Info */}
      <h3 className="mb-3">MCP Endpoint</h3>
      <div className="card mb-4">
        <div className="card-body">
          <p className="text-secondary mb-3">
            Configuration for Claude Code / Claude Desktop.
            Generate an API key on the <a href="/api-keys">API Keys</a> page.
          </p>
          <pre className="bg-dark text-light rounded p-3 mb-0">
            <code>{`{
  "mcpServers": {
    "graphiti": {
      "type": "http",
      "url": "${mcpEndpoint}",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}</code>
          </pre>
          <small className="form-hint mt-2 d-block">
            Replace <code>YOUR_API_KEY</code> with a key from the API Keys page.
          </small>
        </div>
      </div>

      {/* External Links */}
      <h3 className="mb-3">External Tools</h3>
      <div className="card">
        <div className="list-group list-group-flush">
          {falkordbBrowserUrl && (
            <a
              href={falkordbBrowserUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="list-group-item list-group-item-action d-flex align-items-center"
            >
              <IconDatabase size={20} className="me-3 text-secondary" />
              <div>
                <strong>FalkorDB Browser</strong>
                <div className="text-secondary small">Graph visualization & Cypher queries</div>
              </div>
              <IconExternalLink size={16} className="ms-auto text-secondary" />
            </a>
          )}
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="list-group-item list-group-item-action d-flex align-items-center"
          >
            <IconApi size={20} className="me-3 text-secondary" />
            <div>
              <strong>API Documentation</strong>
              <div className="text-secondary small">Swagger UI</div>
            </div>
            <IconExternalLink size={16} className="ms-auto text-secondary" />
          </a>
          <a
            href="https://github.com/getzep/graphiti"
            target="_blank"
            rel="noopener noreferrer"
            className="list-group-item list-group-item-action d-flex align-items-center"
          >
            <IconBrandGithub size={20} className="me-3 text-secondary" />
            <div>
              <strong>Graphiti</strong>
              <div className="text-secondary small">Knowledge graph library</div>
            </div>
            <IconExternalLink size={16} className="ms-auto text-secondary" />
          </a>
          <a
            href="https://github.com/getzep/zep-graph-visualization"
            target="_blank"
            rel="noopener noreferrer"
            className="list-group-item list-group-item-action d-flex align-items-center"
          >
            <IconBrandGithub size={20} className="me-3 text-secondary" />
            <div>
              <strong>Zep Graph Visualization</strong>
              <div className="text-secondary small">Reference implementation for graph visualization</div>
            </div>
            <IconExternalLink size={16} className="ms-auto text-secondary" />
          </a>
        </div>
      </div>
    </div>
  );
}
