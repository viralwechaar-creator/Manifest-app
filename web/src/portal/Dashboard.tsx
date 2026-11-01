import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Loading } from '../components/States';

const LABELS: Record<string, [string, string?]> = {
  newEnquiries: ['New enquiries', '/portal/inbox/enquiries'], newMessages: ['Unread messages', '/portal/inbox/messages'], enquiriesThisMonth: ['Enquiries this month'],
  publishedNews: ['Published stories', '/portal/content/news'], upcomingEvents: ['Upcoming events', '/portal/content/events'], galleryPhotos: ['Gallery photos', '/portal/content/gallery_items'], activeUsers: ['Active users', '/portal/users'],
};

export function Dashboard() {
  const { me } = useAuth();
  const reduce = useReducedMotion();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { api('/admin/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorBox message={err} />;
  if (!d) return <Loading />;
  const entries = Object.entries(d.counts) as [string, number][];
  const max = Math.max(1, ...d.enquiryTrend.map((x: any) => x.count));
  const total = d.enquiryTrend.reduce((a: number, x: any) => a + x.count, 0);
  return (
    <>
      <div className="ph1"><h1>Hello, {me!.user.displayName.split(' ')[0]}</h1></div>
      {entries.length === 0 && <div className="panel"><p>Your account does not have any dashboard modules yet. Modules for your role are added as the school system grows.</p></div>}
      {entries.length > 0 && <div className="kpis">{entries.map(([k, v]) => { const [l, to] = LABELS[k] ?? [k]; const inner = <><b>{v}</b><span>{l}</span></>; return to ? <Link key={k} to={to} className="kpi">{inner}</Link> : <div key={k} className="kpi">{inner}</div>; })}</div>}
      {d.enquiryTrend.length > 0 && (
        <div className="panel">
          <h2>Admission enquiries, last 30 days <span className="muted" style={{ fontSize: '.9rem' }}>({total} total)</span></h2>
          <div className="bars" role="img" aria-label={`Bar chart of enquiries per day, ${total} in the last 30 days`}>
            {d.enquiryTrend.map((x: any, i: number) => <motion.div key={x.day} title={`${x.day}: ${x.count}`} initial={reduce ? false : { height: 0 }} animate={{ height: `${(x.count / max) * 100}%` }} transition={{ delay: i * 0.015, duration: 0.5 }} style={{ opacity: x.count ? 1 : 0.35 }} />)}
          </div>
        </div>
      )}
    </>
  );
}
