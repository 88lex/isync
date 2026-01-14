/**
 * Centralized configuration for ISync frontend
 */

// API base URL - uses Vite proxy in dev, can be overridden via env
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

// WebSocket URL for status updates
export function getWebSocketUrl(path: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${path}`;
}

// App version
export const APP_VERSION = 'v2.5.0';
