import { api } from '../../api.js';
import { ErrorNote, useLoad } from '../../components/ui.jsx';
import { dateTime } from '../../format.js';

export default function NotificationLog() {
  const { data, error } = useLoad(() => api.get('/notifications'));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notification log</h1>
          <p>Every alert the system has sent. Delivery is simulated in-app; email/SMS providers can subscribe to the same events later.</p>
        </div>
      </div>
      <div className="card">
        <ErrorNote error={error} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Recipient</th><th>Type</th><th>Title</th><th>Channel</th><th>Read</th></tr></thead>
            <tbody>
              {data?.notifications.map((n) => (
                <tr key={n.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateTime(n.created_at)}</td>
                  <td>{n.recipient_name}<div className="small muted">{n.recipient_email}</div></td>
                  <td><code>{n.type}</code></td>
                  <td>{n.title}</td>
                  <td>{n.channel}</td>
                  <td>{n.read_at ? <span className="badge ok">Read</span> : <span className="badge">Unread</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.notifications.length === 0 && <div className="empty">No notifications yet.</div>}
        </div>
      </div>
    </>
  );
}
