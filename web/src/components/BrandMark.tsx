import { DEFAULT_LOGO } from '../lib';

/** The school's logo in a small white tile, readable on any background. Uses the logo set in Site settings, else the default leaf. */
export function BrandMark({ logoUrl, style }: { logoUrl?: string; name?: string; style?: React.CSSProperties }) {
  return <span className="brand-mark has-logo" aria-hidden style={style}><img src={logoUrl || DEFAULT_LOGO} alt="" /></span>;
}
