import { Fragment } from 'react';

/**
 * Renders admin-written plain text safely. Nothing is ever inserted as HTML, so content
 * cannot inject scripts. Supports "## heading", "### subheading", "- bullets" and paragraphs.
 */
export function Prose({ text, drop }: { text?: string | null; drop?: boolean }) {
  if (!text?.trim()) return null;
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className={'prose' + (drop ? ' drop' : '')}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*-\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{l.replace(/^\s*-\s+/, '')}</li>)}</ul>;
        return (
          <Fragment key={i}>
            {lines.map((l, j) => {
              if (l.startsWith('### ')) return <h3 key={j}>{l.slice(4)}</h3>;
              if (l.startsWith('## ')) return <h2 key={j} id={slug(l.slice(3))}>{l.slice(3)}</h2>;
              return null;
            })}
            {lines.some((l) => !/^#{2,3} /.test(l)) && <p>{lines.filter((l) => !/^#{2,3} /.test(l)).map((l, j, a) => <Fragment key={j}>{l}{j < a.length - 1 && <br />}</Fragment>)}</p>}
          </Fragment>
        );
      })}
    </div>
  );
}
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const headings = (text?: string | null) => (text ?? '').split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
