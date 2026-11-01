import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export function Bell() {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<{ rows: any[]; unread: number }>({ rows: [], unread: 0 });
  const nav = useNavigate();
  const load = () => api('/admin/notifications').then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  return (
    <div className="notif">
      <button className="iconbtn" aria-label={`Notifications${d.unread ? `, ${d.unread} unread` : ''}`} aria-expanded={open} onClick={() => { setOpen(!open); if (!open) load(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0" /></svg>
        {d.unread > 0 && <span className="dot">{d.unread}</span>}
      </button>
      {open && <div className="pop">
        <div className="flex" style={{ justifyContent: 'space-between', padding: '.7rem 1rem', borderBottom: '1px solid var(--line)' }}><b>Notifications</b>{d.unread > 0 && <button className="btn ghost sm" onClick={async () => { await api('/admin/notifications/read', { method: 'POST', body: {} }); load(); }}>Mark all read</button>}</div>
        {d.rows.length === 0 && <p className="muted" style={{ padding: '1rem' }}>Nothing new.</p>}
        {d.rows.map((n) => <a key={n.id} href={n.link ?? '#'} className={n.read_at ? '' : 'unread'} onClick={async (e) => { e.preventDefault(); await api('/admin/notifications/read', { method: 'POST', body: { ids: [n.id] } }); setOpen(false); load(); if (n.link) nav(n.link); }}><b>{n.title}</b><br /><span className="muted">{n.body}</span></a>)}
      </div>}
    </div>
  );
}
