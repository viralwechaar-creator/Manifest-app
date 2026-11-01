import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Img } from '../components/Img';
import { Reveal } from '../components/Reveal';
import { fmtDate } from '../lib';
import { parseStats } from '../lib';
import { useSettings, usePublic } from './SiteData';
import { Prose } from '../components/Prose';

export function Home() {
  const { s } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const imgY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '12%']);
  const blobY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '-40%']);
  const textY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '18%']);
  const news = usePublic<any[]>('content/news', { limit: 4, list: 1 });
  const events = usePublic<any[]>('content/events', { limit: 4, from: new Date().toISOString().slice(0, 10) });
  const about = usePublic<any>('content/pages/about');
  const ach = usePublic<any[]>('content/achievements', { limit: 3 });
  const stats = parseStats(s.stats);
  const words = (s.hero_headline || 'Welcome').split(' ');
  const last = words.pop();

  return (
    <>
      {s.admissions_open_text && (
        <div className="banner"><div className="wrap"><span>{s.admissions_open_text}</span><Link to="/admissions/enquiry">Enquire now →</Link></div></div>
      )}
      <section className="hero grain" ref={ref}>
        <div className="wrap hero-grid">
          <motion.div style={{ y: textY }}>
            <div className="eyebrow">{s.school_name}</div>
            <h1>{words.join(' ')} <em>{last}</em></h1>
            <p className="lede">{s.hero_subtext}</p>
            <div className="hero-actions">
              <Link className="btn" to="/admissions/enquiry">Admission enquiry</Link>
              <Link className="btn ghost" to="/about">Discover the school</Link>
            </div>
          </motion.div>
          <div className="hero-art" aria-hidden={!s.hero_image_url}>
            <motion.div className="blob1" style={{ y: blobY }} />
            <div className="ring" />
            <div className="frame"><motion.div style={{ y: imgY, height: '100%' }}><Img src={s.hero_image_url} alt="Our campus" fallback={(s.school_name || 'S')[0]} /></motion.div></div>
            {s.tagline && <motion.div className="tag" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6, duration: 0.7 }}>{s.tagline}</motion.div>}
          </div>
        </div>
      </section>

      {stats.length > 0 && (
        <div className="wrap"><Reveal><div className="stats">{stats.map(([l, v]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}</div></Reveal></div>
      )}

      {about.data?.body && (
        <section className="section">
          <div className="wrap split">
            <Reveal><div className="eyebrow">About us</div><h2 className="h2" style={{ marginTop: '1rem' }}>{about.data.title}</h2>
              {about.data.subtitle && <p className="muted" style={{ marginTop: '.8rem' }}>{about.data.subtitle}</p>}
              <p style={{ marginTop: '1.5rem' }}><Link className="link-arrow" to="/about">Read our story →</Link></p></Reveal>
            <Reveal delay={0.1}><Prose text={about.data.body.split(/\n{2,}/).slice(0, 3).join('\n\n')} /></Reveal>
          </div>
        </section>
      )}

      <section className="section dark grain">
        <div className="wrap split rev">
          <div>
            <Reveal><div className="eyebrow">Latest</div><h2 className="h2" style={{ margin: '1rem 0 1.5rem' }}>News & announcements</h2></Reveal>
            {news.loading ? <div className="skeleton" style={{ height: 160 }} /> : news.data?.length ? (
              <div className="rows" style={{ borderColor: 'rgba(255,255,255,.2)' }}>
                {news.data.map((n, i) => (
                  <Reveal key={n.id} delay={i * 0.06}>
                    <Link to={`/news/${n.id}`} className="row" style={{ borderColor: 'rgba(255,255,255,.2)' }}>
                      <time style={{ color: '#a9bba5' }}>{fmtDate(n.published_at)}</time>
                      <div><h3>{n.title}</h3>{n.summary && <p style={{ margin: '.3rem 0 0', color: '#c8d3c6', fontSize: '.92rem' }}>{n.summary}</p>}</div>
                      <span className="chip">{n.kind}</span>
                    </Link>
                  </Reveal>
                ))}
              </div>
            ) : <p className="muted">No news has been published yet.</p>}
            <p style={{ marginTop: '1.5rem' }}><Link className="link-arrow" to="/news" style={{ color: '#fff', borderColor: 'var(--olive)' }}>All news →</Link></p>
          </div>
          <div>
            <Reveal><div className="eyebrow">Coming up</div><h2 className="h2" style={{ margin: '1rem 0 1.5rem' }}>Events</h2></Reveal>
            {events.loading ? <div className="skeleton" style={{ height: 160 }} /> : events.data?.length ? events.data.map((e, i) => (
              <Reveal key={e.id} delay={i * 0.06}>
                <div className="flex" style={{ padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,.2)', alignItems: 'center', flexWrap: 'nowrap' }}>
                  <div className="event-date"><b style={{ color: '#fff' }}>{fmtDate(e.starts_at, { day: 'numeric' })}</b><span style={{ color: '#a9bba5' }}>{fmtDate(e.starts_at, { month: 'short' })}</span></div>
                  <div><b style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: '1.15rem' }}>{e.title}</b>{e.location && <div style={{ fontSize: '.84rem', color: '#a9bba5' }}>{e.location}</div>}</div>
                </div>
              </Reveal>
            )) : <p className="muted">No upcoming events.</p>}
            <p style={{ marginTop: '1.5rem' }}><Link className="link-arrow" to="/calendar" style={{ color: '#fff', borderColor: 'var(--olive)' }}>Full calendar →</Link></p>
          </div>
        </div>
      </section>

      {ach.data && ach.data.length > 0 && (
        <section className="section">
          <div className="wrap">
            <Reveal><div className="eyebrow">Proud moments</div><h2 className="h2" style={{ margin: '1rem 0 2rem' }}>Achievements</h2></Reveal>
            <div className="cards">
              {ach.data.map((a, i) => (
                <Reveal key={a.id} delay={i * 0.08}><div className="card hover">{a.image_url && <div className="img"><Img src={a.image_url} alt="" /></div>}<div className="body">{a.category && <span className="chip sage">{a.category}</span>}<h3>{a.title}</h3>{a.description && <p className="muted" style={{ margin: 0 }}>{a.description.slice(0, 140)}</p>}</div></div></Reveal>
              ))}
            </div>
            <p style={{ marginTop: '1.5rem' }}><Link className="link-arrow" to="/achievements">All achievements →</Link></p>
          </div>
        </section>
      )}

      <section className="section tint grain">
        <div className="wrap" style={{ textAlign: 'center', maxWidth: 760 }}>
          <Reveal><div className="eyebrow" style={{ justifyContent: 'center' }}>Join us</div><h2 className="display" style={{ margin: '1rem 0 1.2rem', fontSize: 'clamp(2rem,5vw,3.6rem)' }}>Come and see the school for yourself</h2>
            <p className="lede" style={{ margin: '0 auto 1.8rem' }}>Send an enquiry and the admissions team will get back to you.</p>
            <Link className="btn" to="/admissions/enquiry">Start an enquiry</Link></Reveal>
        </div>
      </section>
    </>
  );
}
