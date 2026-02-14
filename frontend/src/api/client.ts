/* Graphiti UI — Admin interface for Graphiti Knowledge Graph
 * Copyright (c) 2026 Matthias Brusdeylins
 * SPDX-License-Identifier: MIT
 * 100% AI-generated code (vibe-coding with Claude) */

import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for handling errors
api.interceptors.response.use(
  response => response,
  error => {
    // Only redirect on 401 if not already on login/setup page
    // and not checking auth status
    if (error.response?.status === 401) {
      const isAuthCheck = error.config?.url?.includes('/auth/');
      const isOnAuthPage = window.location.pathname === '/login' ||
                           window.location.pathname === '/setup';

      if (!isAuthCheck && !isOnAuthPage) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);
