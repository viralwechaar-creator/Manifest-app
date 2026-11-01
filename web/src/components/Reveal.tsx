import { motion, useReducedMotion } from 'motion/react';
import { ReactNode } from 'react';

/** Fades and lifts content in as it scrolls into view. Skipped for reduced-motion users. */
export function Reveal({ children, delay = 0, y = 24, className, as = 'div' }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: 'div' | 'li' | 'section' | 'article' }) {
  const reduce = useReducedMotion();
  const M = (motion as any)[as];
  if (reduce) { const T = as as any; return <T className={className}>{children}</T>; }
  return (
    <M className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -60px 0px' }} transition={{ duration: 0.7, delay, ease: [0.22, 0.8, 0.24, 1] }}>
      {children}
    </M>
  );
}
