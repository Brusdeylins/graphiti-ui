/* Graphiti UI — Admin interface for Graphiti Knowledge Graph
 * Copyright (c) 2026 Matthias Brusdeylins
 * SPDX-License-Identifier: MIT
 * 100% AI-generated code (vibe-coding with Claude) */

import { Outlet, Navigate, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  IconDashboard,
  IconGraph,
  IconCategory,
  IconTerminal2,
  IconKey,
  IconSun,
  IconMoon,
  IconLogout,
  IconBrandGraphql,
} from '@tabler/icons-react';

export function Layout() {
  const { user, isLoading, isInitialized, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="page page-center">
        <div className="container-tight py-4">
          <div className="text-center">
            <div className="spinner-border text-primary" role="status" />
            <p className="mt-3 text-secondary">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return <Navigate to="/setup" replace />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isVisualization = location.pathname === '/visualization';

  const navItems = [
    { path: '/dashboard', icon: IconDashboard, label: 'Dashboard' },
    { path: '/visualization', icon: IconGraph, label: 'Visualization' },
    { path: '/query', icon: IconTerminal2, label: 'Query' },
    { path: '/entity-types', icon: IconCategory, label: 'Entity Types' },
    { path: '/api-keys', icon: IconKey, label: 'API Keys' },
  ];

  return (
    <div className="page">
      {/* Sidebar */}
      <aside className="navbar navbar-vertical navbar-expand-lg" data-bs-theme="dark">
        <div className="container-fluid">
          {/* Brand */}
          <h1 className="navbar-brand navbar-brand-autodark mb-0">
            <a href="/" className="d-flex flex-column align-items-center">
              <div className="d-flex align-items-center">
                <IconBrandGraphql size={36} className="icon-lg me-2" strokeWidth={1.5} />
                <span className="navbar-brand-text" style={{ fontSize: '1.25rem', fontWeight: 600 }}>Graphiti</span>
              </div>
              <span className="text-muted" style={{ fontSize: '0.65rem', marginTop: '-2px' }}>v1.2</span>
            </a>
          </h1>

          {/* Mobile toggle */}
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#sidebar-menu"
          >
            <span className="navbar-toggler-icon" />
          </button>

          {/* Navigation */}
          <div className="collapse navbar-collapse d-flex flex-column" id="sidebar-menu">
            <ul className="navbar-nav pt-lg-3">
              {navItems.map(({ path, icon: Icon, label }) => (
                <li className={`nav-item ${location.pathname === path ? 'active' : ''}`} key={path}>
                  <NavLink
                    to={path}
                    className={({ isActive }) =>
                      `nav-link ${isActive ? 'active' : ''}`
                    }
                  >
                    <span className="nav-link-icon d-md-none d-lg-inline-block">
                      <Icon size={20} />
                    </span>
                    <span className="nav-link-title">{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>

            {/* Bottom section */}
            <div className="mt-auto w-100">
              <hr className="my-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }} />
              <ul className="navbar-nav">
                <li className="nav-item">
                  <button
                    className="nav-link w-100 text-start border-0 bg-transparent"
                    onClick={toggleTheme}
                  >
                    <span className="nav-link-icon d-md-none d-lg-inline-block">
                      {theme === 'light' ? <IconMoon size={20} /> : <IconSun size={20} />}
                    </span>
                    <span className="nav-link-title">
                      {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
                    </span>
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    className="nav-link w-100 text-start border-0 bg-transparent text-danger"
                    onClick={logout}
                  >
                    <span className="nav-link-icon d-md-none d-lg-inline-block">
                      <IconLogout size={20} />
                    </span>
                    <span className="nav-link-title">Logout</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="page-wrapper">
        <div className={isVisualization ? 'page-body' : 'page-body'}>
          <div className={isVisualization ? 'container-fluid' : 'container-xl'}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
