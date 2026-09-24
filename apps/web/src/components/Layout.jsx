import { NavLink, Outlet } from 'react-router-dom';
import { ROLE_LABEL, useAuth } from '../auth.jsx';

export const NAV = {
  admin: [['/users', 'Users & roles'], ['/audit', 'Audit log'], ['/notifications', 'Notification log'], ['/events', 'Events']],
  organizer: [['/events', 'My events']],
  coordinator: [['/review', 'Review queue'], ['/events', 'Events & dashboards']],
  gate_staff: [['/gate', 'Gate scanner']],
};

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">EL</span>EntryLink</div>
        {(NAV[user.role] ?? []).map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>{label}</NavLink>
        ))}
        <div className="sidebar-foot">
          <div className="who">{user.full_name}</div>
          <div className="role">{ROLE_LABEL[user.role]}</div>
          <button className="small" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main><Outlet /></main>
    </div>
  );
}
