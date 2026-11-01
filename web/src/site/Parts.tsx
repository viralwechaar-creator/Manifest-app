import { Link } from 'react-router-dom';
import { ReactNode } from 'react';
import { Reveal } from '../components/Reveal';
import { Empty, ErrorBox, Loading } from '../components/States';

export function PageHead({ eyebrow, title, intro, crumbs }: { eyebrow?: string; title: string; intro?: ReactNode; crumbs?: [string, string?][] }) {
  return (
    <section className="phead grain">
      <div className="arc" aria-hidden /><div className="arc2" aria-hidden />
      <div className="wrap">
        {crumbs && <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link>{crumbs.map(([l, t]) => <span key={l}> / {t ? <Link to={t}>{l}</Link> : l}</span>)}</nav>}
        {eyebrow && <div className="eyebrow" style={{ marginTop: '1rem' }}>{eyebrow}</div>}
        <Reveal y={16}><h1>{title}</h1></Reveal>
        {intro && <Reveal delay={0.1}><p className="lede">{intro}</p></Reveal>}
      </div>
    </section>
  );
}

export function Async<T>({ state, empty, children }: { state: { data: T | null; loading: boolean; error: string | null }; empty?: string; children: (d: T) => ReactNode }) {
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox message={state.error} />;
  const d = state.data;
  if (d == null || (Array.isArray(d) && d.length === 0)) return <Empty>{empty ?? 'Nothing to show yet. Please check back soon.'}</Empty>;
  return <>{children(d)}</>;
}

export function PrivacyNote({ text }: { text?: string }) {
  return text ? <p className="muted" style={{ fontSize: '.8rem' }}>{text}</p> : null;
}
