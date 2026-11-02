import { Component, ReactNode } from 'react';

/** Shows a readable message with a Reload button instead of a blank screen if something fails while drawing a page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('page error', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '1.5rem', textAlign: 'center', background: 'var(--paper)', color: 'var(--ink)' }}>
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: '1.6rem', marginBottom: '.6rem' }}>Something went wrong</h1>
          <p>This page could not be shown. Reloading usually fixes it.</p>
          <p style={{ fontSize: '.8rem', opacity: .7, wordBreak: 'break-word' }}>{this.state.error.message}</p>
          <p style={{ display: 'flex', gap: '.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => window.location.reload()}>Reload</button>
            <a className="btn ghost" href="/">Go to the website</a>
          </p>
        </div>
      </div>
    );
  }
}
