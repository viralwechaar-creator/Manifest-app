import { ImgHTMLAttributes, useState } from 'react';

/** Image with a graceful fallback so a broken link never leaves a hole in the layout. */
export function Img({ src, alt, fallback, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { fallback?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className="placeholder-art" role="img" aria-label={alt}>{fallback ?? ''}</div>;
  return <img src={src} alt={alt ?? ''} loading="lazy" decoding="async" onError={() => setBad(true)} {...rest} />;
}
