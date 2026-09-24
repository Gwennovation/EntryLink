import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

export const ROLE_LABEL = {
  admin: 'System Admin',
  organizer: 'Event Organizer',
  coordinator: 'Registration Coordinator',
  gate_staff: 'Gate Staff',
  attendee: 'Attendee',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api.get('/auth/me').then((r) => setUser(r.user)).catch(logout).finally(() => setLoading(false));
  }, [logout]);

  const login = async (email, password) => {
    const { token, user: u } = await api.post('/auth/login', { email, password });
    if (u.role === 'attendee') {
      // The web dashboard is for staff; attendees use the mobile app.
      throw new Error('Attendee accounts use the EntryLink mobile app. This dashboard is for event staff.');
    }
    setToken(token);
    setUser(u);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
