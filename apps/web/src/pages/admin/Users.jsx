import { useState } from 'react';
import { api } from '../../api.js';
import { ROLE_LABEL, useAuth } from '../../auth.jsx';
import { ErrorNote, useAction, useLoad } from '../../components/ui.jsx';
import { dateTime } from '../../format.js';

const ROLES = Object.keys(ROLE_LABEL);
const EMPTY = { full_name: '', email: '', phone: '', role: 'coordinator', password: '' };

export default function Users() {
  const { user: me } = useAuth();
  const [filter, setFilter] = useState({ role: '', q: '' });
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const { data, error, reload } = useLoad(() => api.get(`/users?${qs}`), [qs]);
  const [form, setForm] = useState(null);
  const create = useAction();
  const update = useAction();

  const submit = async (e) => {
    e.preventDefault();
    const body = { ...form, phone: form.phone || undefined };
    if (await create.run(() => api.post('/users', body))) { setForm(null); reload(); }
  };
  const patch = async (u, changes) => { if (await update.run(() => api.patch(`/users/${u.id}`, changes))) reload(); };
  const resetPassword = async (u) => {
    const password = window.prompt(`New temporary password for ${u.full_name} (min 8 characters):`);
    if (password) await update.run(() => api.post(`/users/${u.id}/reset-password`, { password }));
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Users & roles</h1><p>Create staff accounts and control who can do what. Attendees sign up in the mobile app.</p></div>
        {!form && <button className="primary" onClick={() => setForm(EMPTY)}>+ New user</button>}
      </div>

      {form && (
        <form className="card stack" onSubmit={submit} style={{ marginBottom: 16 }}>
          <h2>New user</h2>
          <ErrorNote error={create.error} />
          <div className="form-grid">
            <label>Full name<input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
            <label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>Phone <span className="field-hint">optional</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>Role
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <label>Temporary password<input required minLength={8} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          </div>
          <div className="row">
            <button className="primary" disabled={create.busy}>Create user</button>
            <button type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <input placeholder="Search name or email" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          <select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value })}>
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <ErrorNote error={error || update.error} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>
              {data?.users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id}>
                    <td>{u.full_name}{self && <span className="muted"> (you)</span>}</td>
                    <td>{u.email}</td>
                    <td>
                      <select value={u.role} disabled={self || update.busy} onChange={(e) => patch(u, { role: e.target.value })}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td><span className={`badge ${u.is_active ? 'ok' : ''}`}>{u.is_active ? 'Active' : 'Deactivated'}</span></td>
                    <td className="muted">{dateTime(u.created_at)}</td>
                    <td className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="small" onClick={() => resetPassword(u)}>Reset password</button>
                      {!self && (
                        <button className={`small ${u.is_active ? 'danger' : ''}`} onClick={() => patch(u, { is_active: !u.is_active })}>
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data?.users.length === 0 && <div className="empty">No users match.</div>}
        </div>
      </div>
    </>
  );
}
