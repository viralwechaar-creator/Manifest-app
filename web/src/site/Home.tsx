import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Img } from '../components/Img';
import { Prose } from '../components/Prose';
import { Reveal } from '../components/Reveal';
import { DEFAULT_HERO, DEFAULT_HERO_WIDE, fmtDate, parseStats } from '../lib';
import { usePublic, useSettings } from './SiteData';

const QUICK = [
  ['Academics', '/academics'], ['Admissions', '/admissions'], ['Campus life', '/gallery'], ['News & events', '/news'], ['Contact', '/contact'],
];

export function Home() {
  const { s } = useSettings();
  const heroRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '22%']);
  const bgScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.12]);
  const wordX = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '-14%']);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, reduce ? 1 : 0]);
  const news = usePublic<any[]>('content/news', { limit: 4, list: 1 });
  const events = usePublic<any[]>('content/events', { limit: 4, from: new Date().toISOString().slice(0, 10) });
  const about = usePublic<any>('content/pages/about');
  const ach = usePublic<any[]>('content/achievements', { limit: 3 });
  const stats = parseStats(s.stats);
  const name = s.school_name || 'School';
  const words = (s.hero_headline || 'Welcome').split(' ');
  const last = words.pop();

  return (
    <>
      <section className="fhero" ref={heroRef} aria-label="Welcome">
        <motion.div className="fhero-bg" style={{ y: bgY, scale: bgScale }}>
          {s.hero_image_url
            ? <img src={s.hero_image_url} alt="" fetchPriority="high" />
            : <picture><source media="(min-width: 861px)" srcSet={DEFAULT_HERO_WIDE} /><img src={DEFAULT_HERO} alt="" fetchPriority="high" /></picture>}
        </motion.div>
        <div className="fhero-shade" aria-hidden />
        <motion.div className="fhero-word" style={{ x: wordX }} aria-hidden>{name}</motion.div>
        <div className="fhero-side" aria-hidden>{s.tagline || name}</div>
        <motion.div className="wrap fhero-copy" style={{ opacity: fade }}>
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.2, ease: [0.22, 0.8, 0.24, 1] }}>
            <div className="eyebrow">{s.admissions_open_text || name}</div>
            <h1>{words.join(' ')} <em>{last}</em></h1>
          </motion.div>
          <motion.div className="fhero-actions" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.45, ease: [0.22, 0.8, 0.24, 1] }}>
            <p>{s.hero_subtext}</p>
            <Link className="btn light" to="/admissions/enquiry">Admission enquiry</Link>
            <a className="scrollcue" href="#glance" aria-label="Scroll to content"><span /></a>
          </motion.div>
        </motion.div>
      </section>

      <section id="glance" className="section">
        <div className="wrap glance">
          <Reveal><div className="eyebrow">01 · At a glance</div><h2 className="h2" style={{ marginTop: '1rem' }}>{name}<br /><span className="faded">in numbers.</span></h2></Reveal>
          {stats.length > 0 ? (
            <div className="glance-grid">{stats.map(([l, v], i) => <Reveal key={l} delay={i * 0.08}><div className="gstat"><b>{v}</b><span>{l}</span></div></Reveal>)}</div>
          ) : (
            <Reveal delay={0.1}><p className="lede">{s.hero_subtext}</p></Reveal>
          )}
        </div>
      </section>

      <section className="panels">
        <Reveal className="panel-a">
          <div className="big-num">02</div>
          <div>
            <div className="eyebrow">About us</div>
            <h2 className="h2" style={{ margin: '.9rem 0 1.1rem' }}>{about.data?.title ?? 'Our school'}</h2>
            <div className="clip"><Prose text={about.data?.body?.split(/\n{2,}/).slice(0, 2).join('\n\n')} /></div>
            <Link className="link-arrow" to="/about">Read our story →</Link>
          </div>
        </Reveal>
        <div className="panel-b"><Img src={about.data?.image_url || s.hero_image_url || DEFAULT_HERO} alt="" fallback={name[0]} /><span className="vlabel">Campus</span></div>
        <nav className="panel-c" aria-label="Quick links">
          <ol>{QUICK.map(([l, to], i) => <li key={to}><Link to={to}><span>{String(i + 1).padStart(2, '0')}</span>{l}</Link></li>)}</ol>
          <div className="mini"><small>Admissions</small><p>{s.admissions_open_text || 'Enquire about joining us.'}</p><Link to="/admissions/enquiry" className="link-arrow" style={{ color: '#fff', borderColor: '#fff' }}>Enquire →</Link></div>
        </nav>
      </section>

      <section className="section dark grain">
        <div className="wrap split rev">
          <div>
            <Reveal><div className="eyebrow">03 · Latest</div><h2 className="h2" style={{ margin: '1rem 0 1.5rem' }}>News & announcements</h2></Reveal>
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
            <Reveal><div className="eyebrow">04 · Coming up</div><h2 className="h2" style={{ margin: '1rem 0 1.5rem' }}>Events</h2></Reveal>
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
            <Reveal><div className="eyebrow">05 · Proud moments</div><h2 className="h2" style={{ margin: '1rem 0 2rem' }}>Achievements</h2></Reveal>
            <div className="cards">
              {ach.data.map((a, i) => (
                <Reveal key={a.id} delay={i * 0.08}><div className="card hover">{a.image_url && <div className="img"><Img src={a.image_url} alt="" /></div>}<div className="body">{a.category && <span className="chip sage">{a.category}</span>}<h3>{a.title}</h3>{a.description && <p className="muted" style={{ margin: 0 }}>{a.description.slice(0, 140)}</p>}</div></div></Reveal>
              ))}
            </div>
            <p style={{ marginTop: '1.5rem' }}><Link className="link-arrow" to="/achievements">All achievements →</Link></p>
          </div>
        </section>
      )}

      <section className="cta">
        <div className="wrap">
          <Reveal><div className="cta-word" aria-hidden>visit us.</div></Reveal>
          <Reveal delay={0.1}><div className="cta-row"><p className="lede" style={{ margin: 0 }}>Send an enquiry and the admissions team will get back to you.</p><Link className="btn" to="/admissions/enquiry">Start an enquiry</Link></div></Reveal>
        </div>
      </section>
    </>
  );
}
