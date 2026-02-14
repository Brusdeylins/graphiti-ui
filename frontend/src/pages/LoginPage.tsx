/* Graphiti UI — Admin interface for Graphiti Knowledge Graph
 * Copyright (c) 2026 Matthias Brusdeylins
 * SPDX-License-Identifier: MIT
 * 100% AI-generated code (vibe-coding with Claude) */

import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { IconBrandGraphql } from '@tabler/icons-react';

export function LoginPage() {
  const { user, isLoading: authLoading, isInitialized, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Wait for auth check to complete before rendering
  if (authLoading) {
    return (
      <div className="page page-center">
        <div className="container-tight py-4 text-center">
          <div className="spinner-border text-primary" role="status" />
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return <Navigate to="/setup" replace />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map((e: any) => e.msg).join(', '));
      } else {
        setError('Login failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="page page-center">
      <div className="container container-tight py-4">
        <div className="card card-md">
          <div className="card-body">
            <h1 className="h2 text-center mb-4 d-flex align-items-center justify-content-center gap-2">
              <IconBrandGraphql size={32} className="text-primary" />
              Graphiti
            </h1>
            <p className="text-center text-secondary mb-4">
              Knowledge Graph Admin
            </p>

            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} autoComplete="off">
              <div className="mb-3">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  className="form-control"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="form-footer">
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" />
                      Logging in...
                    </>
                  ) : (
                    'Login'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="text-center text-secondary mt-3">
          Enter your credentials to access the admin panel.
        </div>
      </div>
    </div>
  );
}
