import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { api, setApiToken, setUnauthorizedHandler } from './api';

const KEY = 'entrylink.token';

// SecureStore (Keychain / Keystore) on devices; localStorage when running in a browser.
const store = Platform.OS === 'web'
  ? {
    get: async () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    set: async (v) => { try { localStorage.setItem(KEY, v); } catch { /* ignore */ } },
    del: async () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
  }
  : { get: () => SecureStore.getItemAsync(KEY), set: (v) => SecureStore.setItemAsync(KEY, v), del: () => SecureStore.deleteItemAsync(KEY) };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(async () => {
    setApiToken(null);
    setUser(null);
    await store.del();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    (async () => {
      const saved = await store.get();
      if (saved) {
        setApiToken(saved);
        try { setUser((await api.get('/auth/me')).user); } catch { await signOut(); }
      }
      setReady(true);
    })();
  }, [signOut]);

  const accept = async ({ token, user: u }) => {
    if (u.role !== 'attendee') {
      throw new Error('Staff accounts use the EntryLink web dashboard. This app is for attendees.');
    }
    setApiToken(token);
    await store.set(token);
    setUser(u);
  };

  const signIn = async (email, password) => accept(await api.post('/auth/login', { email, password }));
  const signUp = async (fields) => accept(await api.post('/auth/signup', fields));

  return <AuthContext.Provider value={{ user, ready, signIn, signUp, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Where to go after sign-in. Only in-app paths are allowed (a deep link can't redirect elsewhere). */
export const afterSignIn = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');
