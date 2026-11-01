import { Link, useParams } from 'react-router-dom';
import { Img } from '../components/Img';
import { headings, Prose, slug } from '../components/Prose';
import { Reveal } from '../components/Reveal';
import { Loading } from '../components/States';
import { fmtDate } from '../lib';
import { Async, PageHead } from './Parts';
import { usePublic } from './SiteData';

function usePage(slugName: string) { return usePublic<any>(`content/pages/${slugName}`); }

/** Generic editorial page for About, Academics, Infrastructure, Admissions, Transport, Policies, etc. */
export function TextPage({ slug: pageSlug, children, intro }: { slug: string; children?: React.ReactNode; intro?: boolean }) {
  const p = usePage(pageSlug);
  if (p.loading) return <Loading />;
  const d = p.data;
  const heads = headings(d?.body);
  return (
    <>
      <PageHead eyebrow={d?.subtitle || undefined} title={d?.title ?? 'Page not found'} crumbs={[[d?.title ?? '']]} />
      <section className="section">
        <div className="wrap" style={{ display: 'grid', gridTemplateColumns: heads.length > 1 ? 'minmax(0,220px) minmax(0,1fr)' : 'minmax(0,1fr)', gap: 'clamp(1.5rem,5vw,4rem)', alignItems: 'start' }}>
          {heads.length > 1 && <nav className="toc" aria-label="On this page">{heads.map((h) => <a key={h} href={`#${slug(h)}`}>{h}</a>)}</nav>}
          <div>
            {p.error && <div className="empty">This page is not available.</div>}
            {d?.image_url && <Reveal><div style={{ borderRadius: 'var(--r)', overflow: 'hidden', marginBottom: '2rem', maxHeight: 420 }}><Img src={d.image_url} alt="" /></div></Reveal>}
            {d && <Reveal><Prose text={d.body} drop={intro} /></Reveal>}
            {children}
          </div>
        </div>
      </section>
    </>
  );
}

export function PrincipalPage() {
  const p = usePage('principal');
  if (p.loading) return <Loading />;
  const d = p.data;
  return (
    <>
      <PageHead eyebrow="From the principal's desk" title={d?.title ?? "Principal's message"} crumbs={[["Principal's message"]]} />
      <section className="section">
        <div className="wrap split">
          <Reveal><div className="portrait"><div className="ph"><Img src={d?.image_url} alt="The principal" fallback="P" /></div></div>
            {d?.subtitle && <p style={{ marginTop: '1.4rem', fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>{d.subtitle}</p>}</Reveal>
          <Reveal delay={0.1}><div className="quote-mark" aria-hidden>“</div><Prose text={d?.body} drop /></Reveal>
        </div>
      </section>
    </>
  );
}

export function VisionMissionPage() {
  const p = usePage('vision-mission');
  if (p.loading) return <Loading />;
  const d = p.data;
  const parts = (d?.body ?? '').split(/^## /m).filter(Boolean);
  const sections = parts.map((x: string) => { const [h, ...rest] = x.split('\n'); return { h: h.trim(), body: rest.join('\n').trim() }; });
  const two = sections.length >= 2;
  return (
    <>
      <PageHead eyebrow={d?.subtitle || undefined} title={d?.title ?? 'Vision & mission'} crumbs={[['Vision & mission']]} />
      {two ? (
        <div className="vm">
          {sections.slice(0, 2).map((s: any, i: number) => (
            <Reveal key={s.h} delay={i * 0.1}><div><div className="eyebrow" style={i === 0 ? { color: 'var(--olive)' } : {}}>0{i + 1}</div><h2 className="h2" style={{ margin: '1rem 0 1.4rem' }}>{s.h}</h2><Prose text={s.body} /></div></Reveal>
          ))}
        </div>
      ) : <section className="section"><div className="wrap"><Prose text={d?.body} /></div></section>}
      {sections.length > 2 && <section className="section"><div className="wrap"><Prose text={sections.slice(2).map((s: any) => `## ${s.h}\n\n${s.body}`).join('\n\n')} /></div></section>}
    </>
  );
}

export function PoliciesPage() {
  const docs = usePublic<any[]>('content/documents', { category: 'Policies' });
  return (
    <TextPage slug="policies">
      {docs.data && docs.data.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <h2 style={{ fontSize: '1.6rem', marginBottom: '1rem' }}>Policy documents</h2>
          <div className="rows">{docs.data.map((d) => <a key={d.id} className="row" href={d.file_url} target="_blank" rel="noopener noreferrer" style={{ gridTemplateColumns: '1fr auto' }}><h3>{d.title}</h3><span className="chip">PDF</span></a>)}</div>
        </div>
      )}
    </TextPage>
  );
}

export function ApplyPage() {
  const p = usePage('admissions');
  return (
    <>
      <PageHead eyebrow="Admissions" title="Online admission" crumbs={[['Admissions', '/admissions'], ['Online admission']]}
        intro="Online applications with document upload and tracking are being added to this website. Until then, begin with an enquiry and the admissions team will guide you through the next steps." />
      <section className="section"><div className="wrap" style={{ maxWidth: 760 }}>
        <Reveal><Prose text={p.data?.body} /></Reveal>
        <p style={{ marginTop: '2rem' }}><Link className="btn" to="/admissions/enquiry">Send an admission enquiry</Link></p>
      </div></section>
    </>
  );
}

export { Async, fmtDate };
