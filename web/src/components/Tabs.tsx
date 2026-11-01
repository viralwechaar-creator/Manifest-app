import { motion } from 'motion/react';
import { useId } from 'react';

/** Accessible tab strip with a sliding indicator. Content switching is done by the caller. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const gid = useId();
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {value === t.id && <motion.span layoutId={gid} className="bar" style={{ left: 0, right: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        </button>
      ))}
    </div>
  );
}
