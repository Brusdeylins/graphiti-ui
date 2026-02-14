/* Graphiti UI — Admin interface for Graphiti Knowledge Graph
 * Copyright (c) 2026 Matthias Brusdeylins
 * SPDX-License-Identifier: MIT
 * 100% AI-generated code (vibe-coding with Claude) */

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from '../api/client';

interface User {
  username: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setup: (password: string, passwordConfirm: string) => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(true);

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me');
      setUser({ username: response.data.username });
    } catch {
      setUser(null);
    }
  };

  const checkSetupStatus = async () => {
    try {
      const response = await api.get('/auth/setup-status');
      setIsInitialized(response.data.initialized);
    } catch {
      setIsInitialized(true); // Assume initialized on error
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await checkSetupStatus();
      await checkAuth();
      setIsLoading(false);
    };
    init();
  }, []);

  const login = async (username: string, password: string) => {
    await api.post('/auth/login', { username, password });
    await checkAuth();
  };

  const logout = async () => {
    await api.get('/auth/logout');
    setUser(null);
  };

  const setup = async (password: string, passwordConfirm: string) => {
    await api.post('/auth/setup', { password, password_confirm: passwordConfirm });
    setIsInitialized(true);
    await checkAuth();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isInitialized, login, logout, setup, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
