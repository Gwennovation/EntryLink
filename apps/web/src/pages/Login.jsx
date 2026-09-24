import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ErrorNote, useAction } from '../components/ui.jsx';

// Seeded demo accounts (see apps/api/src/db/seed.js). Only shown in development builds.
const DEMO = [
  ['Admin', 'admin@entrylink.test'],
  ['Organizer', 'organizer@entrylink.test'],
  ['Coordinator', 'coordinator@entrylink.test'],
  ['Gate', 'gate@entrylink.test'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  const submit = (e) => {
    e.preventDefault();
    run(() => login(email, password));
  };

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><span className="brand-mark">EL</span>EntryLink</div>
        <div>
          <h1>Staff sign in</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Event registration & entry management</p>
        </div>
        <ErrorNote error={error} />
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {import.meta.env.DEV && (
          <div className="demo-accounts">
            Demo accounts (password <code>EntryLink123!</code>):<br />
            {DEMO.map(([label, addr]) => (
              <button type="button" key={addr} className="small" onClick={() => { setEmail(addr); setPassword('EntryLink123!'); }}>{label}</button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
