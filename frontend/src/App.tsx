/* Graphiti UI — Admin interface for Graphiti Knowledge Graph
 * Copyright (c) 2026 Matthias Brusdeylins
 * SPDX-License-Identifier: MIT
 * 100% AI-generated code (vibe-coding with Claude) */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { DashboardPage } from './pages/DashboardPage';
import { VisualizationPage } from './pages/VisualizationPage';
import { EntityTypesPage } from './pages/EntityTypesPage';
import { QueryPage } from './pages/QueryPage';
import { ApiKeysPage } from './pages/ApiKeysPage';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />

            {/* Protected routes with layout */}
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/visualization" element={<VisualizationPage />} />
              <Route path="/entity-types" element={<EntityTypesPage />} />
              <Route path="/query" element={<QueryPage />} />
              <Route path="/api-keys" element={<ApiKeysPage />} />
            </Route>

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
