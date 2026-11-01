import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, qs } from '../api';
import { Modal } from '../components/Modal';
import { Empty, ErrorBox, Loading } from '../components/States';
import { fmtDate } from '../lib';
import { DynamicForm, FieldDef } from './DynamicForm';
import { useSchema } from './schema';

export interface EntityDef { key: string; label: string; group: string; pk: 'id' | 'slug'; fixed: boolean; fields: FieldDef[]; list: string[]; filters: string[] }

function cell(def: EntityDef, f: FieldDef, row: any, refs: Record<string, Record<number, string>>) {
  const v = row[f.name];
  if (v == null || v === '') return <span className="muted">—</span>;
  switch (f.type) {
    case 'bool': return <span className={'badge ' + (v ? 'on' : 'off')}>{v ? 'Shown' : 'Hidden'}</span>;
    case 'datetime': return fmtDate(v, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    case 'date': return fmtDate(v);
    case 'ref': return refs[f.ref!]?.[v] ?? v;
    case 'tags': return (v as string[]).join(', ');
    default: return String(v).length > 70 ? String(v).slice(0, 70) + '…' : String(v);
  }
}

export function ContentList() {
  const { entity } = useParams();
  const { schema } = useSchema();
  const nav = useNavigate();
  const def = schema?.entities.find((e: EntityDef) => e.key === entity) as EntityDef | undefined;
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [filters, setFilters] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [del, setDel] = useState<any | null>(null); const [busy, setBusy] = useState(false);
  const [refs, setRefs] = useState<Record<string, Record<number, string>>>({});

  useEffect(() => { setPage(1); setQ(''); setFilters({}); }, [entity]);
  useEffect(() => {
    if (!def) return;
    for (const f of def.fields.filter((x) => x.type === 'ref')) {
      api(`/admin/cms/options/${f.ref}`).then((o: any[]) => setRefs((r) => ({ ...r, [f.ref!]: Object.fromEntries(o.map((x) => [x.id, x.label])) }))).catch(() => {});
    }
  }, [def]);
  const load = useCallback(async () => {
    if (!def) return; setLoading(true); setErr('');
    try { const r = await api(`/admin/cms/entities/${def.key}${qs({ q, page, ...filters })}`); setRows(r.rows); setTotal(r.total); }
    catch (e) { setErr((e as ApiError).message); } finally { setLoading(false); }
  }, [def, q, page, filters]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  if (!schema) return <Loading />;
  if (!def) return <ErrorBox message="You do not have access to this content, or it does not exist." />;
  const cols = def.list.map((n) => def.fields.find((f) => f.name === n)!).filter(Boolean);
  const pages = Math.max(1, Math.ceil(total / 20));

  async function remove() {
    if (!del) return; setBusy(true);
    try { await api(`/admin/cms/entities/${def!.key}/${del[def!.pk]}`, { method: 'DELETE' }); setDel(null); await load(); }
    catch (e) { setErr((e as ApiError).message); setDel(null); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="ph1"><h1>{def.label}</h1>{!def.fixed && <button className="btn" onClick={() => nav(`/portal/content/${def.key}/new`)}>Add new</button>}</div>
      <div className="toolbar">
        <input className="input" type="search" placeholder="Search" aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        {def.filters.map((fn) => {
          const f = def.fields.find((x) => x.name === fn)!;
          if (f.type === 'select') return <select key={fn} className="input" style={{ maxWidth: 180 }} aria-label={f.label} value={filters[fn] ?? ''} onChange={(e) => { setFilters({ ...filters, [fn]: e.target.value }); setPage(1); }}><option value="">All {f.label.toLowerCase()}s</option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>;
          if (f.type === 'ref') return <RefFilter key={fn} f={f} value={filters[fn] ?? ''} onChange={(v) => { setFilters({ ...filters, [fn]: v }); setPage(1); }} />;
          return null;
        })}
      </div>
      {err && <ErrorBox message={err} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty>Nothing here yet.{!def.fixed && ' Use “Add new” to create the first one.'}</Empty> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{cols.map((c) => <th key={c.name}>{c.label}</th>)}<th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r[def.pk]}>
              {cols.map((c, i) => <td key={c.name}>{i === 0 ? <button className="link-arrow" style={{ background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => nav(`/portal/content/${def.key}/${r[def.pk]}`)}>{cell(def, c, r, refs)}</button> : cell(def, c, r, refs)}</td>)}
              <td className="act"><button className="btn ghost sm" onClick={() => nav(`/portal/content/${def.key}/${r[def.pk]}`)}>Edit</button>{!def.fixed && <> <button className="btn ghost sm" onClick={() => setDel(r)}>Delete</button></>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="pager"><span>{total} item{total === 1 ? '' : 's'}</span><button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      <Modal open={!!del} onClose={() => setDel(null)} label="Confirm delete">
        <h3>Delete this item?</h3><p className="muted">This permanently removes it from the website and cannot be undone. To keep it but hide it, edit it and turn off “Show on website” instead.</p>
        <div className="flex"><button className="btn danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button><button className="btn ghost" onClick={() => setDel(null)}>Cancel</button></div>
      </Modal>
    </>
  );
}

function RefFilter({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  const [o, setO] = useState<any[]>([]);
  useEffect(() => { api(`/admin/cms/options/${f.ref}`).then(setO).catch(() => {}); }, [f.ref]);
  return <select className="input" style={{ maxWidth: 200 }} aria-label={f.label} value={value} onChange={(e) => onChange(e.target.value)}><option value="">All {f.label.toLowerCase()}s</option>{o.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>;
}

export function ContentEdit() {
  const { entity, id } = useParams();
  const { schema } = useSchema();
  const nav = useNavigate();
  const def = schema?.entities.find((e: EntityDef) => e.key === entity) as EntityDef | undefined;
  const isNew = id === 'new';
  const [rec, setRec] = useState<any | null>(isNew ? {} : null); const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!def || isNew) return;
    api(`/admin/cms/entities/${def.key}/${id}`).then(setRec).catch((e) => setErr(e.message));
  }, [def, id, isNew]);
  if (!schema) return <Loading />;
  if (!def) return <ErrorBox message="You do not have access to this content." />;
  if (err) return <ErrorBox message={err} />;
  if (!rec) return <Loading />;
  return (
    <>
      <div className="ph1"><h1>{isNew ? `New: ${def.label}` : `Edit: ${def.label}`}</h1><button className="btn ghost" onClick={() => nav(`/portal/content/${def.key}`)}>← Back to list</button></div>
      <div className="panel" style={{ maxWidth: 780 }}>
        {saved && <div className="notice ok" role="status" style={{ marginBottom: '1rem' }}>Saved. The change is live on the website.</div>}
        <DynamicForm fields={def.fields} initial={rec} submitLabel={isNew ? 'Create' : 'Save changes'} onCancel={() => nav(`/portal/content/${def.key}`)}
          onSubmit={async (data) => {
            setSaved(false);
            if (isNew) { await api(`/admin/cms/entities/${def.key}`, { method: 'POST', body: data }); nav(`/portal/content/${def.key}`); }
            else { await api(`/admin/cms/entities/${def.key}/${id}`, { method: 'PATCH', body: data }); setSaved(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }
          }} />
      </div>
    </>
  );
}
