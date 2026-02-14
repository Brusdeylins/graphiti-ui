/* Graphiti UI — Admin interface for Graphiti Knowledge Graph
 * Copyright (c) 2026 Matthias Brusdeylins
 * SPDX-License-Identifier: MIT
 * 100% AI-generated code (vibe-coding with Claude) */

import { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  IconKey,
  IconPlus,
  IconCopy,
  IconTrash,
  IconCheck,
  IconAlertCircle,
} from '@tabler/icons-react';

interface ApiKey {
  name: string;
  key_prefix: string;
  full_key: string;
  created_at: string;
  last_used: string | null;
}

interface NewApiKey {
  name: string;
  key: string;
  key_prefix: string;
  created_at: string;
}

export function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [keyName, setKeyName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newKey, setNewKey] = useState<NewApiKey | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'danger'; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    try {
      const res = await api.get('/api-keys');
      setApiKeys(res.data.keys || []);
    } catch (error) {
      console.error('Failed to load API keys:', error);
      showNotification('danger', 'Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  };

  const showNotification = (type: 'success' | 'danger', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const createApiKey = async () => {
    if (!keyName.trim()) {
      showNotification('danger', 'Please enter a name for the API key');
      return;
    }

    setIsCreating(true);
    try {
      const res = await api.post('/api-keys', { name: keyName.trim() });
      setNewKey(res.data);
      setShowModal(true);
      setKeyName('');
      loadApiKeys();
    } catch (error) {
      console.error('Failed to create API key:', error);
      showNotification('danger', 'Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const deleteApiKey = async (keyPrefix: string, name: string) => {
    if (!confirm(`Are you sure you want to delete the API key "${name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await api.delete(`/api-keys/${encodeURIComponent(keyPrefix)}`);
      showNotification('success', 'API key deleted successfully');
      loadApiKeys();
    } catch (error) {
      console.error('Failed to delete API key:', error);
      showNotification('danger', 'Failed to delete API key');
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showNotification('success', 'API key copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      showNotification('danger', 'Failed to copy to clipboard');
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const mcpEndpoint = `${window.location.origin}/mcp/`;

  return (
    <div className="page-header d-print-none">
      <div className="row align-items-center mb-4">
        <div className="col">
          <h2 className="page-title">API Keys</h2>
          <div className="text-secondary mt-1">
            Manage API keys for external MCP access
          </div>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`alert alert-${notification.type} alert-dismissible mb-4`} role="alert">
          <div className="d-flex">
            {notification.type === 'success' ? (
              <IconCheck size={20} className="me-2" />
            ) : (
              <IconAlertCircle size={20} className="me-2" />
            )}
            <div>{notification.message}</div>
          </div>
          <button
            type="button"
            className="btn-close"
            onClick={() => setNotification(null)}
          />
        </div>
      )}

      {/* Create API Key Card */}
      <div className="card mb-4">
        <div className="card-header">
          <h3 className="card-title">
            <IconPlus size={20} className="me-2" />
            Create New API Key
          </h3>
        </div>
        <div className="card-body py-3">
          <label className="form-label">API Key Name</label>
          <div className="input-group">
            <input
              type="text"
              className="form-control"
              placeholder="e.g., Claude Code, Development"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createApiKey()}
            />
            <button
              className="btn btn-primary"
              onClick={createApiKey}
              disabled={isCreating}
            >
              <IconKey size={16} className="me-1" />
              {isCreating ? 'Creating...' : 'Generate'}
            </button>
          </div>
          <small className="form-hint">
            Use a descriptive name to identify where this key will be used.
          </small>
        </div>
      </div>

      {/* Existing API Keys */}
      <div className="card mb-4">
        <div className="card-header">
          <h3 className="card-title">
            <IconKey size={20} className="me-2" />
            Existing API Keys
          </h3>
        </div>
        {isLoading ? (
          <div className="card-body">
            <div className="d-flex justify-content-center py-4">
              <div className="spinner-border text-primary" role="status" />
            </div>
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="card-body">
            <div className="empty">
              <div className="empty-icon">
                <IconKey size={32} />
              </div>
              <p className="empty-title">No API keys created yet</p>
              <p className="empty-subtitle text-muted">
                Create your first API key above to get started
              </p>
            </div>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-vcenter card-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>API Key</th>
                  <th>Created</th>
                  <th>Last Used</th>
                  <th className="w-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => {
                  const maskedKey = key.full_key
                    ? `${key.full_key.substring(0, 10)}...${key.full_key.substring(key.full_key.length - 10)}`
                    : `${key.key_prefix}...`;
                  return (
                    <tr key={key.key_prefix}>
                      <td>
                        <div className="d-flex align-items-center">
                          <IconKey size={16} className="me-2 text-muted" />
                          <span className="fw-bold">{key.name}</span>
                        </div>
                      </td>
                      <td>
                        <code className="text-muted" title={key.full_key}>{maskedKey}</code>
                      </td>
                      <td className="text-muted">{formatDate(key.created_at)}</td>
                      <td className="text-muted">
                        {key.last_used ? formatDate(key.last_used) : 'Never'}
                      </td>
                      <td>
                        <div className="btn-list flex-nowrap">
                          {key.full_key && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => copyToClipboard(key.full_key)}
                              title="Copy API key"
                            >
                              <IconCopy size={16} />
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => deleteApiKey(key.key_prefix, key.name)}
                            title="Delete API key"
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MCP Configuration */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">MCP Configuration with API Key</h3>
        </div>
        <div className="card-body">
          <p className="text-secondary mb-3">
            For Claude Code / Claude Desktop with Bearer token authentication:
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
            Replace <code>YOUR_API_KEY</code> with a key generated above.
          </small>
        </div>
      </div>

      {/* New Key Modal */}
      {showModal && newKey && (
        <div className="modal modal-blur fade show d-block" tabIndex={-1}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <IconCheck size={20} className="text-success me-2" />
                  API Key Created Successfully
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowModal(false)}
                />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-bold">API Key Name:</label>
                  <div className="text-muted">{newKey.name}</div>
                </div>

                <div className="mb-3">
                  <label className="form-label fw-bold">API Key:</label>
                  <div className="input-group">
                    <input
                      type="text"
                      className="form-control font-monospace"
                      value={newKey.key}
                      readOnly
                    />
                    <button
                      className="btn btn-primary"
                      onClick={() => copyToClipboard(newKey.key)}
                    >
                      {copied ? (
                        <>
                          <IconCheck size={16} className="me-1" />
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
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" onClick={() => setShowModal(false)} />
        </div>
      )}
    </div>
  );
}
