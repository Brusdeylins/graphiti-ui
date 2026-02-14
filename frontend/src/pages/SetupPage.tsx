/* Graphiti UI — Admin interface for Graphiti Knowledge Graph
 * Copyright (c) 2026 Matthias Brusdeylins
 * SPDX-License-Identifier: MIT
 * 100% AI-generated code (vibe-coding with Claude) */

import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { IconBrandGraphql, IconInfoCircle } from '@tabler/icons-react';

export function SetupPage() {
  const { user, isLoading: authLoading, isInitialized, setup } = useAuth();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
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

  if (isInitialized) {
    return <Navigate to="/login" replace />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== passwordConfirm) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      await setup(password, passwordConfirm);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map((e: any) => e.msg).join(', '));
      } else {
        setError('Setup failed');
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
              Graphiti Setup
            </h1>
            <p className="text-center text-secondary mb-4">
              Welcome! Create an admin password to get started.
            </p>

            <div className="alert alert-info" role="alert">
              <div className="d-flex">
                <div className="me-2">
                  <IconInfoCircle size={20} />
                </div>
                <div>
                  <h4 className="alert-title">Password Requirements</h4>
                  <div className="text-secondary">
                    <ul className="mb-0 ps-3">
                      <li>Minimum 8 characters</li>
                      <li>Remember this password - it cannot be recovered!</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-3">
                <label className="form-label">Admin Password</label>
                <input
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>

              <div className="mb-4">
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  className="form-control"
                  value={passwordConfirm}
                  onChange={e => setPasswordConfirm(e.target.value)}
                  minLength={8}
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
                      Setting up...
                    </>
                  ) : (
                    'Complete Setup'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
