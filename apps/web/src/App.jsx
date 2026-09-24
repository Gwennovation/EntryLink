import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Layout, { NAV } from './components/Layout.jsx';
import Audit from './pages/admin/Audit.jsx';
import NotificationLog from './pages/admin/NotificationLog.jsx';
import Users from './pages/admin/Users.jsx';
import Review from './pages/coordinator/Review.jsx';
import RegistrationDetail from './pages/coordinator/RegistrationDetail.jsx';
import EventDetail from './pages/events/EventDetail.jsx';
import EventLive from './pages/events/EventLive.jsx';
import EventTickets from './pages/events/EventTickets.jsx';
import Events from './pages/events/Events.jsx';
import TicketSheet from './pages/events/TicketSheet.jsx';
import Gate from './pages/gate/Gate.jsx';
import Login from './pages/Login.jsx';

/** Route guard: only render for the listed roles; otherwise send the user to their home page. */
function Allow({ roles, children }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? children : <Navigate to={NAV[user.role][0][0]} replace />;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="empty">Loading…</div>;
  if (!user) return <Login />;
  const home = NAV[user.role]?.[0]?.[0] ?? '/';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={home} replace />} />
        <Route path="users" element={<Allow roles={['admin']}><Users /></Allow>} />
        <Route path="audit" element={<Allow roles={['admin']}><Audit /></Allow>} />
        <Route path="notifications" element={<Allow roles={['admin']}><NotificationLog /></Allow>} />
        <Route path="events" element={<Allow roles={['admin', 'organizer', 'coordinator']}><Events /></Allow>} />
        <Route path="events/:id" element={<Allow roles={['admin', 'organizer', 'coordinator']}><EventDetail /></Allow>} />
        <Route path="events/:id/live" element={<Allow roles={['organizer', 'coordinator']}><EventLive /></Allow>} />
        <Route path="events/:id/tickets" element={<Allow roles={['organizer']}><EventTickets /></Allow>} />
        <Route path="events/:id/tickets/print" element={<Allow roles={['organizer']}><TicketSheet /></Allow>} />
        <Route path="review" element={<Allow roles={['coordinator']}><Review /></Allow>} />
        <Route path="registrations/:id" element={<Allow roles={['coordinator', 'organizer']}><RegistrationDetail /></Allow>} />
        <Route path="gate" element={<Allow roles={['gate_staff']}><Gate /></Allow>} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
