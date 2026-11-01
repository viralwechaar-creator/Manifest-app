import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Img } from '../components/Img';
import { Lightbox } from '../components/Lightbox';
import { Modal } from '../components/Modal';
import { Prose } from '../components/Prose';
import { Reveal } from '../components/Reveal';
import { Loading } from '../components/States';
import { fmtDate, fmtTime } from '../lib';
import { Async, PageHead } from './Parts';
import { usePublic } from './SiteData';

const CATS = ['Academic', 'Cultural', 'Sports', 'Holiday', 'Meeting', 'Other'];

function EventModal({ ev, onClose }: { ev: any | null; onClose: () => void }) {
  return (
    <Modal open={!!ev} onClose={onClose} label="Event details">
      {ev && <>
        <span className="chip">{ev.category}</span><h3 style={{ marginTop: '.6rem' }}>{ev.title}</h3>
        <p className="muted">{fmtDate(ev.starts_at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, {fmtTime(ev.starts_at)}{ev.ends_at ? ` – ${fmtTime(ev.ends_at)}` : ''}{ev.location ? ` · ${ev.location}` : ''}</p>
        {ev.image_url && <Img src={ev.image_url} alt="" style={{ borderRadius: 8, marginBottom: '1rem' }} />}
        <Prose text={ev.description} />
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </>}
    </Modal>
  );
}

export function EventsPage() {
  const [cat, setCat] = useState('');
  const [when, setWhen] = useState<'upcoming' | 'all'>('upcoming');
  const st = usePublic<any[]>('content/events', { category: cat, from: when === 'upcoming' ? new Date().toISOString().slice(0, 10) : undefined, limit: 100 });
  const [sel, setSel] = useState<any | null>(null);
  return (
    <>
      <PageHead eyebrow="Campus life" title="Events" crumbs={[['Events']]} />
      <section className="section"><div className="wrap">
        <div className="filters">
          {(['upcoming', 'all'] as const).map((w) => <button key={w} className={'pill' + (when === w ? ' on' : '')} onClick={() => setWhen(w)}>{w === 'upcoming' ? 'Upcoming' : 'All events'}</button>)}
          <span style={{ width: 1, height: 24, background: 'var(--line)' }} />
          <button className={'pill' + (!cat ? ' on' : '')} onClick={() => setCat('')}>Every category</button>
          {CATS.map((c) => <button key={c} className={'pill' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <Async state={st} empty="No events found.">{(rows) => (
          <div className="rows">{rows.map((e, i) => (
            <Reveal key={e.id} delay={Math.min(i, 6) * 0.04}>
              <button className="row" style={{ width: '100%', gridTemplateColumns: '80px 1fr auto', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--line)', cursor: 'pointer', alignItems: 'center' }} onClick={() => setSel(e)}>
                <div className="event-date"><b>{fmtDate(e.starts_at, { day: 'numeric' })}</b><span>{fmtDate(e.starts_at, { month: 'short', year: '2-digit' })}</span></div>
                <div><h3>{e.title}</h3><span className="muted" style={{ fontSize: '.85rem' }}>{fmtTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</span></div>
                <span className="chip">{e.category}</span>
              </button>
            </Reveal>))}</div>)}</Async>
      </div></section>
      <EventModal ev={sel} onClose={() => setSel(null)} />
    </>
  );
}

export function CalendarPage() {
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const from = new Date(cur.getFullYear(), cur.getMonth(), 1); const to = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  const st = usePublic<any[]>('content/events', { from: from.toISOString(), to: to.toISOString(), limit: 200 });
  const [sel, setSel] = useState<any | null>(null);
  const days = useMemo(() => {
    const lead = (from.getDay() + 6) % 7; // week starts Monday
    const n = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= n; d++) cells.push(new Date(cur.getFullYear(), cur.getMonth(), d));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [cur]); // eslint-disable-line
  const byDay = (d: Date) => (st.data ?? []).filter((e) => new Date(e.starts_at).toDateString() === d.toDateString());
  const today = new Date().toDateString();
  const go = (n: number) => setCur(new Date(cur.getFullYear(), cur.getMonth() + n, 1));
  return (
    <>
      <PageHead eyebrow="Campus life" title="School calendar" crumbs={[['Calendar']]} />
      <section className="section"><div className="wrap">
        <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.9rem' }}>{cur.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
          <div className="flex"><button className="btn ghost sm" onClick={() => go(-1)} aria-label="Previous month">←</button><button className="btn ghost sm" onClick={() => setCur(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button><button className="btn ghost sm" onClick={() => go(1)} aria-label="Next month">→</button></div>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={cur.toISOString()} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            <div className="cal" role="grid" aria-label="Calendar">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div className="dow" key={d}>{d}</div>)}
              {days.map((d, i) => d ? (
                <div key={i} className={'day' + (d.toDateString() === today ? ' today' : '')}><span>{d.getDate()}</span>{byDay(d).map((e) => <button key={e.id} className={'ev ' + e.category} onClick={() => setSel(e)} title={e.title}>{e.title}</button>)}</div>
              ) : <div key={i} className="day off" />)}
            </div>
          </motion.div>
        </AnimatePresence>
        {st.loading && <Loading />}
        {st.error && <div className="notice error">{st.error}</div>}
        <div className="cal-list rows">{(st.data ?? []).map((e) => <button key={e.id} className="row" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--line)', gridTemplateColumns: '70px 1fr' }} onClick={() => setSel(e)}><time>{fmtDate(e.starts_at, { day: 'numeric', month: 'short' })}</time><span>{e.title}</span></button>)}</div>
        {!st.loading && !st.error && st.data?.length === 0 && <p className="muted" style={{ marginTop: '1rem' }}>No events this month.</p>}
      </div></section>
      <EventModal ev={sel} onClose={() => setSel(null)} />
    </>
  );
}

export function GalleryPage() {
  const albums = usePublic<any[]>('content/gallery_albums');
  return (
    <>
      <PageHead eyebrow="Campus life" title="Gallery" crumbs={[['Gallery']]} />
      <section className="section"><div className="wrap">
        <Async state={albums} empty="Photo albums will appear here.">{(rows) => (
          <div className="cards">{rows.map((a, i) => (
            <Reveal key={a.id} delay={(i % 3) * 0.07}><Link className="card" to={`/gallery/${a.id}`} style={{ height: '100%' }}>
              <div className="img" style={{ aspectRatio: '4/3' }}><Img src={a.cover_url} alt="" fallback={a.title[0]} /></div>
              <div className="body"><h3>{a.title}</h3>{a.description && <p className="muted" style={{ margin: 0 }}>{a.description}</p>}</div></Link></Reveal>))}</div>)}</Async>
      </div></section>
    </>
  );
}

export function AlbumPage() {
  const { id } = useParams();
  const album = usePublic<any>(`content/gallery_albums/${id}`);
  const items = usePublic<any[]>('content/gallery_items', { album_id: id, limit: 200 });
  const [idx, setIdx] = useState<number | null>(null);
  return (
    <>
      <PageHead eyebrow="Gallery" title={album.data?.title ?? 'Album'} intro={album.data?.description} crumbs={[['Gallery', '/gallery'], [album.data?.title ?? '']]} />
      <section className="section"><div className="wrap">
        <Async state={items} empty="This album has no photos yet.">{(rows) => (
          <>
            <div className="masonry">{rows.map((p, i) => (
              <Reveal key={p.id} delay={Math.min(i, 8) * 0.04}><button onClick={() => setIdx(i)} aria-label={`Open photo ${i + 1}${p.caption ? ': ' + p.caption : ''}`}><img src={p.image_url} alt={p.caption ?? ''} loading="lazy" /></button></Reveal>))}</div>
            <Lightbox items={rows} index={idx} onIndex={setIdx} />
          </>)}</Async>
        <p style={{ marginTop: '2rem' }}><Link className="link-arrow" to="/gallery">← All albums</Link></p>
      </div></section>
    </>
  );
}
