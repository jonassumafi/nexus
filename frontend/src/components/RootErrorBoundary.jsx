// Top-level error boundary. Catches any uncaught render error that would
// otherwise leave the Electron window / browser tab blank, and offers a
// recovery path including a "Reset theme" button that clears all
// localStorage keys we persist UI state in — useful if a bad theme or
// stale state ever becomes the thing wedging a render.

import { Component } from 'react';

export default class RootErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null, info: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    console.error('[root] render crash:', err, info);
    this.setState({ err, info });
  }

  reset = () => {
    try {
      ['nexus_theme', 'nexus_density', 'nexus_feed_collapsed',
       'nexus_missionlist_collapsed', 'nexus_chat_last_seen_ts',
       'nexus_ptt_key', 'nexus_mic_device_id', 'nexus_output_device_id',
      ].forEach(k => localStorage.removeItem(k));
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.removeAttribute('data-dens');
    } catch {}
    window.location.href = '/';
  };

  reload = () => { window.location.reload(); };

  render() {
    if (!this.state.err) return this.props.children;
    const msg = String(this.state.err?.message || this.state.err || 'Unknown error');
    const stack = String(this.state.err?.stack || '').split('\n').slice(0, 6).join('\n');
    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#020C14', color: '#CCE8FF',
        fontFamily: 'system-ui, sans-serif',
        padding: 24, textAlign: 'left',
      }}>
        <div style={{
          maxWidth: 560, width: '100%',
          background: 'linear-gradient(180deg, #0f1b27, #0a1420)',
          border: '1px solid #1A3A50',
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.2em',
            color: '#FF5544', marginBottom: 10,
          }}>
            NEXUS — RENDER ERROR
          </div>
          <div style={{ fontSize: 13, color: '#CCE8FF', marginBottom: 10, lineHeight: 1.5 }}>
            Something broke while the app was starting up. This usually
            isn't your fault.
          </div>
          <pre style={{
            fontSize: 11, color: '#99BBDD',
            background: '#000',
            border: '1px solid #1A3A50',
            padding: 10, borderRadius: 4,
            overflow: 'auto',
            maxHeight: 200,
            fontFamily: 'ui-monospace, Consolas, monospace',
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
          }}>{msg}{'\n\n'}{stack}</pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={this.reload} style={{
              flex: 1, padding: '8px 12px',
              background: 'linear-gradient(180deg, #1B3A55, #0E2236)',
              border: '1px solid #2A5A7A',
              color: '#CCE8FF',
              borderRadius: 4, cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
            }}>Reload</button>
            <button onClick={this.reset} style={{
              flex: 1, padding: '8px 12px',
              background: 'linear-gradient(180deg, #a8321f, #5e150b)',
              border: '1px solid #d44',
              color: '#fff',
              borderRadius: 4, cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
            }}>Reset theme + reload</button>
          </div>
          <div style={{ fontSize: 10, color: '#5F87A8', marginTop: 10 }}>
            If this keeps happening, screenshot this message and send it
            via Report a Bug once the app loads.
          </div>
        </div>
      </div>
    );
  }
}
