import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Img } from '../components/Img';
import { Prose } from '../components/Prose';
import { Reveal } from '../components/Reveal';
import { Loading } from '../components/States';
import { fmtDate } from '../lib';
import { Async, PageHead } from './Parts';
import { usePublic } from './SiteData';
import { TextPage } from './TextPages';

function Filters({ options, value, onChange, q, onQ }: { options: string[]; value: string; onChange: (v: string) => void; q?: string; onQ?: (v: string) => void }) {
  return (
    <div className="filters">
      {options.length > 1 && ['All', ...options].map((o) => <button key={o} className={'pill' + ((o === 'All' ? '' : o) === value ? ' on' : '')} onClick={() => onChange(o === 'All' ? '' : o)}>{o}</button>)}
      {onQ && <input className="input search" type="search" placeholder="Search" aria-label="Search" value={q} onChange={(e) => onQ(e.target.value)} />}
    </div>
  );
}

export function DepartmentsPage() {
  const st = usePublic<any[]>('content/departments');
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <PageHead eyebrow="Academics" title="Departments" crumbs={[['Departments']]} />
      <section className="section"><div className="wrap">
        <Async state={st} empty="Departments will be listed here soon.">{(rows) => (
          <div className="cards">{rows.map((d, i) => (
            <Reveal key={d.id} delay={(i % 3) * 0.07}>
              <div className="card hover" style={{ height: '100%' }}>
                {d.image_url && <div className="img"><Img src={d.image_url} alt="" /></div>}
                <div className="body"><h3>{d.name}</h3>
                  <div className="muted" style={{ fontSize: '.92rem' }}>{open === d.id ? <Prose text={d.description} /> : (d.description ?? '').slice(0, 130)}</div>
                  {d.description && d.description.length > 130 && <button className="link-arrow" style={{ background: 'none', border: 0, cursor: 'pointer', width: 'fit-content', padding: 0 }} onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Show less' : 'Read more'}</button>}
                  <Link className="link-arrow" style={{ width: 'fit-content' }} to={`/faculty?department_id=${d.id}`}>Meet the faculty →</Link>
                </div></div>
            </Reveal>))}</div>)}</Async>
      </div></section>
    </>
  );
}

export function FacultyPage() {
  const params = new URLSearchParams(location.search);
  const [dept, setDept] = useState(params.get('department_id') ?? '');
  const [q, setQ] = useState('');
  const deps = usePublic<any[]>('content/departments');
  const st = usePublic<any[]>('content/faculty', { department_id: dept, q });
  return (
    <>
      <PageHead eyebrow="People" title="Our faculty" crumbs={[['Faculty']]} />
      <section className="section"><div className="wrap">
        <div className="filters">
          <button className={'pill' + (dept === '' ? ' on' : '')} onClick={() => setDept('')}>All</button>
          {deps.data?.map((d) => <button key={d.id} className={'pill' + (dept === String(d.id) ? ' on' : '')} onClick={() => setDept(String(d.id))}>{d.name}</button>)}
          <input className="input search" type="search" placeholder="Search by name" aria-label="Search faculty" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Async state={st} empty="No faculty found.">{(rows) => (
          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))' }}>{rows.map((f, i) => (
            <Reveal key={f.id} delay={(i % 4) * 0.06}><div className="card faculty-card hover" style={{ height: '100%' }}>
              <div className="img" style={{ aspectRatio: '4/5' }}><Img src={f.photo_url} alt={f.name} fallback={f.name[0]} /></div>
              <div className="body"><h3 style={{ fontSize: '1.15rem' }}>{f.name}</h3><span className="chip sage">{f.designation}</span>{f.qualification && <span className="muted" style={{ fontSize: '.84rem' }}>{f.qualification}</span>}{f.bio && <p className="muted" style={{ fontSize: '.84rem', margin: 0 }}>{f.bio}</p>}</div>
            </div></Reveal>))}</div>)}</Async>
      </div></section>
    </>
  );
}

export function CurriculumPage() {
  const st = usePublic<any[]>('content/curriculum');
  const stages = useMemo(() => [...new Set((st.data ?? []).map((x) => x.stage))], [st.data]);
  const [stage, setStage] = useState('');
  const rows = (st.data ?? []).filter((r) => !stage || r.stage === stage);
  return (
    <>
      <PageHead eyebrow="Academics" title="Classes & curriculum" crumbs={[['Academics', '/academics'], ['Curriculum']]} />
      <section className="section"><div className="wrap">
        <Filters options={stages} value={stage} onChange={setStage} />
        <Async state={st} empty="Curriculum details will be published soon.">{() => (
          <div className="stack">{rows.map((r, i) => (
            <Reveal key={r.id} delay={i * 0.04}><div className="split" style={{ gridTemplateColumns: '1fr 2fr', padding: '1.6rem 0', borderTop: '1px solid var(--line)' }}>
              <div><span className="chip">{r.stage}</span><h3 style={{ fontSize: '1.7rem', margin: '.7rem 0 .3rem' }}>{r.title}</h3>{r.class_label && <span className="muted">{r.class_label}</span>}</div>
              <div><Prose text={r.description} />{r.subjects?.length > 0 && <div className="flex" style={{ gap: '.4rem' }}>{r.subjects.map((s: string) => <span className="chip sage" key={s}>{s}</span>)}</div>}</div>
            </div></Reveal>))}</div>)}</Async>
      </div></section>
    </>
  );
}

export function NewsPage() {
  const [kind, setKind] = useState(''); const [q, setQ] = useState('');
  const st = usePublic<any[]>('content/news', { kind, q, list: 1 });
  return (
    <>
      <PageHead eyebrow="Updates" title="News & announcements" crumbs={[['News']]} />
      <section className="section"><div className="wrap">
        <Filters options={['news', 'announcement']} value={kind} onChange={setKind} q={q} onQ={setQ} />
        <Async state={st} empty="No stories match.">{(rows) => (
          <div className="cards">{rows.map((n, i) => (
            <Reveal key={n.id} delay={(i % 3) * 0.07}><Link to={`/news/${n.id}`} className="card" style={{ height: '100%' }}>
              {n.image_url && <div className="img"><Img src={n.image_url} alt="" /></div>}
              <div className="body"><div className="flex"><span className="chip">{n.kind}</span>{n.pinned && <span className="chip sage">Pinned</span>}<time className="muted" style={{ fontSize: '.8rem' }}>{fmtDate(n.published_at)}</time></div><h3>{n.title}</h3>{n.summary && <p className="muted" style={{ margin: 0 }}>{n.summary}</p>}</div>
            </Link></Reveal>))}</div>)}</Async>
      </div></section>
    </>
  );
}

export function NewsDetail() {
  const { id } = useParams();
  const st = usePublic<any>(`content/news/${id}`);
  if (st.loading) return <Loading />;
  if (!st.data) return <><PageHead title="Story not found" /><section className="section"><div className="wrap"><Link className="link-arrow" to="/news">← Back to news</Link></div></section></>;
  const n = st.data;
  return (
    <>
      <PageHead eyebrow={`${n.kind} · ${fmtDate(n.published_at)}`} title={n.title} crumbs={[['News', '/news'], [n.title]]} intro={n.summary} />
      <section className="section"><div className="wrap" style={{ maxWidth: 820 }}>
        {n.image_url && <Reveal><div style={{ borderRadius: 'var(--r)', overflow: 'hidden', marginBottom: '2rem' }}><Img src={n.image_url} alt="" /></div></Reveal>}
        <Prose text={n.body} drop /><p style={{ marginTop: '2rem' }}><Link className="link-arrow" to="/news">← All news</Link></p>
      </div></section>
    </>
  );
}

export function AchievementsPage() {
  const [cat, setCat] = useState('');
  const all = usePublic<any[]>('content/achievements');
  const cats = useMemo(() => [...new Set((all.data ?? []).map((a) => a.category).filter(Boolean))] as string[], [all.data]);
  const rows = (all.data ?? []).filter((a) => !cat || a.category === cat);
  return (
    <>
      <PageHead eyebrow="Campus life" title="Achievements" crumbs={[['Achievements']]} />
      <section className="section"><div className="wrap">
        <Filters options={cats} value={cat} onChange={setCat} />
        <Async state={all} empty="Achievements will appear here.">{() => (
          <div className="cards">{rows.map((a, i) => (<Reveal key={a.id} delay={(i % 3) * 0.07}><div className="card hover" style={{ height: '100%' }}>{a.image_url && <div className="img"><Img src={a.image_url} alt="" /></div>}
            <div className="body"><div className="flex">{a.category && <span className="chip sage">{a.category}</span>}<time className="muted" style={{ fontSize: '.8rem' }}>{fmtDate(a.achieved_on)}</time></div><h3>{a.title}</h3><p className="muted" style={{ margin: 0 }}>{a.description}</p></div></div></Reveal>))}</div>)}</Async>
      </div></section>
    </>
  );
}

export function AlumniPage() {
  const st = usePublic<any[]>('content/alumni');
  return (
    <TextPage slug="alumni">
      <div style={{ marginTop: '2.5rem' }}>
        <Async state={st} empty="Alumni stories will be added soon.">{(rows) => (
          <div className="cards">{rows.map((a, i) => (<Reveal key={a.id} delay={(i % 3) * 0.07}><div className="card hover" style={{ height: '100%' }}>
            <div className="img"><Img src={a.photo_url} alt={a.name} fallback={a.name[0]} /></div>
            <div className="body"><h3>{a.name}</h3><span className="muted" style={{ fontSize: '.85rem' }}>{[a.batch_year && `Batch of ${a.batch_year}`, a.occupation].filter(Boolean).join(' · ')}</span><p style={{ margin: 0 }}>{a.story}</p></div></div></Reveal>))}</div>)}</Async>
      </div>
    </TextPage>
  );
}

export function CareersPage() {
  const st = usePublic<any[]>('content/job_openings');
  const { s } = { s: {} as any };
  void s;
  return (
    <TextPage slug="careers">
      <div style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>Open positions</h2>
        <Async state={st} empty="There are no open positions right now. Please check back later.">{(rows) => (
          <div className="stack">{rows.map((j) => (<Reveal key={j.id}><div className="panel"><div className="flex" style={{ justifyContent: 'space-between' }}><h3 style={{ fontSize: '1.4rem' }}>{j.title}</h3><span className="chip">{j.employment_type}</span></div>
            <p className="muted" style={{ fontSize: '.88rem' }}>{[j.department, j.closes_on && `Apply by ${fmtDate(j.closes_on)}`].filter(Boolean).join(' · ')}</p><Prose text={j.description} />
            <Link className="link-arrow" to={`/contact?subject=${encodeURIComponent('Application: ' + j.title)}`}>Apply through the contact form →</Link></div></Reveal>))}</div>)}</Async>
      </div>
    </TextPage>
  );
}

export function DocumentsPage() {
  const [cat, setCat] = useState('');
  const st = usePublic<any[]>('content/documents');
  const cats = useMemo(() => [...new Set((st.data ?? []).map((d) => d.category))] as string[], [st.data]);
  const rows = (st.data ?? []).filter((d) => !cat || d.category === cat);
  return (
    <>
      <PageHead eyebrow="Resources" title="Documents" crumbs={[['Documents']]} />
      <section className="section"><div className="wrap" style={{ maxWidth: 900 }}>
        <Filters options={cats} value={cat} onChange={setCat} />
        <Async state={st} empty="No documents have been published.">{() => (
          <div className="rows">{rows.map((d) => <a key={d.id} className="row" href={d.file_url} target="_blank" rel="noopener noreferrer" style={{ gridTemplateColumns: '1fr auto auto' }}><h3>{d.title}</h3><span className="chip sage">{d.category}</span><span className="link-arrow">Open</span></a>)}</div>)}</Async>
      </div></section>
    </>
  );
}
