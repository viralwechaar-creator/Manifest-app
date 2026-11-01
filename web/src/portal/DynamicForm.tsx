import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { toLocalInput } from '../lib';

export interface FieldDef { name: string; label: string; type: string; required?: boolean; options?: string[]; help?: string; ref?: string; readonly?: boolean; max?: number }

function Upload({ value, onChange, accept, kind }: { value: string; onChange: (v: string) => void; accept: string; kind: 'image' | 'file' }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function pick(file?: File) {
    if (!file) return; setBusy(true); setErr('');
    try { const fd = new FormData(); fd.append('file', file); const r = await api<{ url: string }>('/admin/uploads', { method: 'POST', form: fd }); onChange(r.url); }
    catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <div>
      <div className="upload">
        {kind === 'image' && value && <img className="thumb" src={value} alt="" />}
        {kind === 'file' && value && <a href={value} target="_blank" rel="noopener noreferrer" className="link-arrow">View current file</a>}
        <input ref={input} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}</button>
        {value && <button type="button" className="btn ghost sm" onClick={() => onChange('')}>Remove</button>}
      </div>
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
}

function RefSelect({ entity, value, onChange, id }: { entity: string; value: any; onChange: (v: number | null) => void; id: string }) {
  const [opts, setOpts] = useState<{ id: number; label: string }[]>([]);
  useEffect(() => { api(`/admin/cms/options/${entity}`).then(setOpts).catch(() => {}); }, [entity]);
  return <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}><option value="">— none —</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>;
}

export function DynamicForm({ fields, initial, onSubmit, onCancel, submitLabel = 'Save' }: {
  fields: FieldDef[]; initial: Record<string, any>; onSubmit: (data: Record<string, any>) => Promise<void>; onCancel?: () => void; submitLabel?: string;
}) {
  const [v, setV] = useState<Record<string, any>>(() => {
    const x: Record<string, any> = {};
    for (const f of fields) {
      let val = initial[f.name];
      if (f.type === 'datetime') val = toLocalInput(val);
      if (f.type === 'date') val = val ? String(val).slice(0, 10) : '';
      if (f.type === 'tags') val = Array.isArray(val) ? val.join(', ') : '';
      if (f.type === 'bool') val = val ?? (f.name === 'published');
      if (f.type === 'select' && f.required && !val) val = f.options![0];
      x[f.name] = val ?? (f.type === 'number' || f.type === 'ref' ? '' : '');
    }
    return x;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const set = (k: string, val: any) => setV((p) => ({ ...p, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const out: Record<string, any> = {};
    for (const f of fields) {
      if (f.readonly) continue;
      const val = v[f.name];
      switch (f.type) {
        case 'datetime': out[f.name] = val ? new Date(val).toISOString() : (f.required ? '' : null); break;
        case 'tags': out[f.name] = String(val).split(',').map((s) => s.trim()).filter(Boolean); break;
        case 'number': out[f.name] = val === '' || val == null ? (f.required ? '' : null) : Number(val); break;
        case 'ref': out[f.name] = val === '' || val == null ? null : Number(val); break;
        default: out[f.name] = val;
      }
    }
    try { await onSubmit(out); } catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate>
      {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err.message}</div>}
      {fields.map((f) => {
        const id = 'pf-' + f.name; const e = err?.fields?.[f.name];
        let ctl: React.ReactNode;
        switch (f.type) {
          case 'longtext': ctl = <textarea id={id} value={v[f.name]} onChange={(x) => set(f.name, x.target.value)} style={{ minHeight: f.max && f.max > 5000 ? 260 : 120 }} />; break;
          case 'bool': ctl = <label className="check"><input id={id} type="checkbox" checked={!!v[f.name]} onChange={(x) => set(f.name, x.target.checked)} /><span>Yes</span></label>; break;
          case 'select': ctl = <select id={id} value={v[f.name]} onChange={(x) => set(f.name, x.target.value)}>{!f.required && <option value="">—</option>}{f.options!.map((o) => <option key={o}>{o}</option>)}</select>; break;
          case 'image': ctl = <Upload kind="image" accept="image/jpeg,image/png,image/webp" value={v[f.name]} onChange={(x) => set(f.name, x)} />; break;
          case 'file': ctl = <Upload kind="file" accept="application/pdf" value={v[f.name]} onChange={(x) => set(f.name, x)} />; break;
          case 'ref': ctl = <RefSelect id={id} entity={f.ref!} value={v[f.name]} onChange={(x) => set(f.name, x)} />; break;
          case 'datetime': ctl = <input id={id} type="datetime-local" value={v[f.name]} onChange={(x) => set(f.name, x.target.value)} />; break;
          case 'date': ctl = <input id={id} type="date" value={v[f.name]} onChange={(x) => set(f.name, x.target.value)} />; break;
          case 'number': ctl = <input id={id} type="number" value={v[f.name]} onChange={(x) => set(f.name, x.target.value)} />; break;
          default: ctl = <input id={id} type="text" value={v[f.name]} readOnly={f.readonly} onChange={(x) => set(f.name, x.target.value)} />;
        }
        return (
          <div key={f.name} className={'field' + (e ? ' invalid' : '')}>
            <label htmlFor={id}>{f.label}{f.required && ' *'}</label>
            {ctl}
            {f.help && <span className="help">{f.help}</span>}
            {e && <span className="err" role="alert">{e}</span>}
          </div>
        );
      })}
      <div className="flex" style={{ marginTop: '1rem' }}>
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
