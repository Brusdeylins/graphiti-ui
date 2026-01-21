import { useState, useEffect, type FormEvent } from 'react';
import { api } from '../api/client';
import { IconPlayerPlay, IconClock, IconCopy, IconCheck } from '@tabler/icons-react';

interface QueryResult {
  data: any;
  executionTime?: number;
}

export function QueryPage() {
  const [query, setQuery] = useState('MATCH (n) RETURN n LIMIT 25');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphs, setGraphs] = useState<string[]>([]);
  const [selectedGraph, setSelectedGraph] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    if (result?.data) {
      navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    const fetchGraphs = async () => {
      try {
        const response = await api.get('/query/graphs');
        if (response.data.success) {
          setGraphs(response.data.graphs);
        }
      } catch (err) {
        console.error('Failed to load graphs:', err);
      }
    };
    fetchGraphs();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);

    const startTime = Date.now();

    try {
      const response = await api.post('/query', {
        query,
        graph_id: selectedGraph || null,
      });
      setResult({
        data: response.data,
        executionTime: Date.now() - startTime,
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Query failed');
    } finally {
      setIsLoading(false);
    }
  };

  const exampleQueries = [
    { label: 'Get all nodes', query: 'MATCH (n) RETURN n LIMIT 25' },
    { label: 'Get all relationships', query: 'MATCH ()-[r]->() RETURN r LIMIT 25' },
    { label: 'Count nodes by type', query: 'MATCH (n) RETURN labels(n) AS type, count(n) AS count' },
    { label: 'Find connected nodes', query: 'MATCH (a)-[r]-(b) RETURN a, r, b LIMIT 25' },
  ];

  return (
    <div className="page-header d-print-none">
      <div className="row align-items-center mb-4">
        <div className="col">
          <h2 className="page-title">Query</h2>
          <div className="text-secondary mt-1">
            Execute Cypher queries against the knowledge graph
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="row mb-3">
              <div className="col-auto">
                <label className="form-label">Graph</label>
                <select
                  value={selectedGraph}
                  onChange={e => setSelectedGraph(e.target.value)}
                  className="form-select"
                >
                  <option value="">All Graphs</option>
                  {graphs.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label">Cypher Query</label>
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                rows={6}
                className="form-control font-monospace"
                placeholder="MATCH (n) RETURN n LIMIT 25"
              />
            </div>
            <div className="d-flex align-items-center gap-3">
              <button
                type="submit"
                disabled={isLoading || !query.trim()}
                className="btn btn-primary"
              >
                {isLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" />
                    Executing...
                  </>
                ) : (
                  <>
                    <IconPlayerPlay size={16} className="me-1" />
                    Execute Query
                  </>
                )}
              </button>
              {result?.executionTime && (
                <span className="text-secondary d-flex align-items-center">
                  <IconClock size={16} className="me-1" />
                  {result.executionTime}ms
                </span>
              )}
            </div>
          </form>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger mb-4" role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className="card mb-4" style={{ minWidth: 0, overflow: 'hidden' }}>
          <div className="card-header d-flex align-items-center">
            <h3 className="card-title mb-0">Results</h3>
            <button
              onClick={copyToClipboard}
              className="btn btn-sm btn-outline-secondary ms-auto"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <IconCheck size={16} className="me-1 text-success" />
                  Copied!
                </>
              ) : (
                <>
                  <IconCopy size={16} className="me-1" />
                  Copy
                </>
              )}
            </button>
          </div>
          <div className="card-body p-0">
            <pre className="bg-dark text-light m-0 p-3" style={{ maxHeight: '400px', overflow: 'auto' }}>
              <code>{JSON.stringify(result.data, null, 2)}</code>
            </pre>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Example Queries</h3>
        </div>
        <div className="list-group list-group-flush">
          {exampleQueries.map(example => (
            <button
              key={example.label}
              onClick={() => setQuery(example.query)}
              className="list-group-item list-group-item-action"
            >
              <div className="fw-medium">{example.label}</div>
              <code className="text-secondary small">{example.query}</code>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
