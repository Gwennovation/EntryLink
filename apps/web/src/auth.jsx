import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

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
  const [loading, setLoading] = useState(true);

  // Session expired or revoked server-side: just drop the local user.
  const forget = useCallback(() => setUser(null), []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(forget);
    // The cookie is invisible to JS, so ask the API whether we're signed in.
    api.get('/auth/me').then((r) => setUser(r.user)).catch(forget).finally(() => setLoading(false));
  }, [forget]);

  const login = async (email, password) => {
    const { user: u } = await api.post('/auth/login', { email, password, session: 'cookie' });
    if (u.role === 'attendee') {
      // The web dashboard is for staff; attendees use the mobile app.
      await api.post('/auth/logout').catch(() => {});
      throw new Error('Attendee accounts use the EntryLink mobile app. This dashboard is for event staff.');
    }
    setUser(u);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
