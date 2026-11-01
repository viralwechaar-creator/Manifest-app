import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { NavCategory } from './nav';

interface Result { key: string; label: string; sub: string; to: string; group: string }

/** "Jump to" search: pages instantly, students and staff as you type. Opens with Ctrl/⌘ + K. */
export function CommandPalette({ open, onClose, cats }: { open: boolean; onClose: () => void; cats: NavCategory[] }) {
  const nav = useNavigate(); const { can } = useAuth(); const [q, setQ] = useState(''); const [remote, setRemote] = useState<Result[]>([]); const [sel, setSel] = useState(0); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setRemote([]); setSel(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  const pages = useMemo<Result[]>(() => cats.flatMap((c) => c.items.map((i) => ({ key: i.to, label: i.label, sub: c.label, to: i.to, group: 'Go to' }))), [cats]);
  const local = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? pages.filter((p) => p.label.toLowerCase().includes(t) || p.sub.toLowerCase().includes(t)) : pages.slice(0, 7)).slice(0, 8); }, [q, pages]);
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) { setRemote([]); return; }
    let live = true; const h = setTimeout(async () => {
      const out: Result[] = [];
      try { if (can('students.view')) { const r = await api(`/admin/school/students${qs({ q: t })}`); out.push(...r.rows.slice(0, 5).map((s: any) => ({ key: 's' + s.id, label: s.full_name, sub: `${s.student_code}${s.class_name ? ` · ${s.class_name} ${s.section_name}` : ''}`, to: `/portal/students/${s.id}`, group: 'Students' }))); } } catch { /* not permitted or offline: skip */ }
      try { if (can('staff.view')) { const r = await api(`/admin/school/staff${qs({ q: t })}`); out.push(...r.rows.slice(0, 5).map((s: any) => ({ key: 't' + s.id, label: s.full_name, sub: `${s.staff_code} · ${s.designation}`, to: `/portal/staff/${s.id}`, group: 'Staff' }))); } } catch { /* skip */ }
      if (live) setRemote(out);
    }, 220);
    return () => { live = false; clearTimeout(h); };
  }, [q, can]);
  const results = [...local, ...remote]; useEffect(() => setSel(0), [q, remote.length]);
  const go = (r: Result) => { onClose(); nav(r.to); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === 'Enter' && results[sel]) go(results[sel]);
    if (e.key === 'Escape') onClose();
  };
  let last = '';
  return (
    <AnimatePresence>{open && (
      <motion.div className="scrim" style={{ alignItems: 'start', paddingTop: '12vh' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <motion.div className="cmd" role="dialog" aria-modal="true" aria-label="Quick search" initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
          <input ref={input} className="cmd-in" placeholder="Search pages, students or staff…" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} role="combobox" aria-expanded aria-controls="cmd-list" aria-activedescendant={results[sel] ? `cmd-${sel}` : undefined} />
          <ul id="cmd-list" role="listbox" className="cmd-list">
            {results.length === 0 && <li className="cmd-empty">Nothing found</li>}
            {results.map((r, i) => { const head = r.group !== last ? <li key={'h' + r.group} className="cmd-head" role="presentation">{r.group}</li> : null; last = r.group; return [head, <li key={r.key} id={`cmd-${i}`} role="option" aria-selected={i === sel} className={'cmd-item' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => go(r)}><span>{r.label}</span><small>{r.sub}</small></li>]; })}
          </ul>
          <div className="cmd-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>
        </motion.div>
      </motion.div>
    )}</AnimatePresence>
  );
}
