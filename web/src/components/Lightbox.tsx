import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';

export interface LbItem { image_url: string; caption?: string | null }

export function Lightbox({ items, index, onIndex }: { items: LbItem[]; index: number | null; onIndex: (i: number | null) => void }) {
  useEffect(() => {
    if (index === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onIndex(null);
      if (e.key === 'ArrowRight') onIndex((index + 1) % items.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + items.length) % items.length);
    };
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [index, items.length, onIndex]);
  const it = index !== null ? items[index] : null;
  return (
    <AnimatePresence>
      {it && index !== null && (
        <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onIndex(null)}>
          <button className="lb-btn" style={{ top: 16, right: 16 }} aria-label="Close" onClick={() => onIndex(null)}>✕</button>
          {items.length > 1 && <>
            <button className="lb-btn" style={{ left: 12 }} aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + items.length) % items.length); }}>←</button>
            <button className="lb-btn" style={{ right: 12 }} aria-label="Next photo" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % items.length); }}>→</button>
          </>}
          <motion.figure key={index} style={{ margin: 0 }} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} onClick={(e) => e.stopPropagation()}>
            <img src={it.image_url} alt={it.caption ?? ''} />
            {it.caption && <figcaption className="cap">{it.caption}</figcaption>}
          </motion.figure>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
