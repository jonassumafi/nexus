import { useState, useCallback } from 'react';

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem('nexus_token'));
  const [user, setUser] = useState(() => {
    const t = localStorage.getItem('nexus_token');
    return t ? decodeJwtPayload(t) : null;
  });

  const login = useCallback((newToken) => {
    localStorage.setItem('nexus_token', newToken);
    setToken(newToken);
    setUser(decodeJwtPayload(newToken));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('nexus_token');
    setToken(null);
    setUser(null);
  }, []);

  return {
    user,
    token,
    login,
    logout,
    isAuthenticated: !!token,
  };
}
