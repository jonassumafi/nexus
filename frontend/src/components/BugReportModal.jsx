// Bug reporter — tiny modal with a short description + up to 3
// screenshots. Submits to /api/bug-report which emails the bundle
// via Resend. Screenshots are read as data URLs in the browser then
// sent as a plain JSON POST (no multipart, keeps the backend simple).
//
// Soft 50-word target enforced via a visible word counter; hard
// 600-character ceiling enforced server-side.

import { useRef, useState } from 'react';
import api from '../services/api';

const MAX_SHOTS = 3;
const MAX_CHARS = 600;
const SOFT_WORDS = 50;
const MAX_SHOT_BYTES = 3 * 1024 * 1024;

export default function BugReportModal({ open, onClose }) {
  const [desc, setDesc] = useState('');
  const [shots, setShots] = useState([]); // [{ dataUrl, name, bytes }]
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState({ type: 'idle', msg: '' });
  const fileRef = useRef(null);

  if (!open) return null;

  const wordCount = desc.trim() ? desc.trim().split(/\s+/).length : 0;

  const addFiles = async (files) => {
    const next = [...shots];
    for (const f of files) {
      if (next.length >= MAX_SHOTS) break;
      if (!/^image\//.test(f.type)) continue;
      if (f.size > MAX_SHOT_BYTES) {
        setState({ type: 'err', msg: `"${f.name}" is larger than 3 MB` });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      }).catch(() => null);
      if (!dataUrl) continue;
      next.push({ dataUrl, name: f.name, bytes: f.size });
    }
    setShots(next);
  };

  const removeShot = (i) => setShots(shots.filter((_, idx) => idx !== i));

  const close = () => {
    if (submitting) return;
    setDesc(''); setShots([]); setState({ type: 'idle', msg: '' });
    onClose?.();
  };

  const submit = async () => {
    if (!desc.trim()) {
      setState({ type: 'err', msg: 'please add a description' });
      return;
    }
    setSubmitting(true);
    setState({ type: 'idle', msg: '' });
    try {
      await api.post('/bug-report', {
        description: desc,
        screenshots: shots.map(s => s.dataUrl),
      });
      setState({ type: 'ok', msg: 'Report sent. Thanks!' });
      setTimeout(close, 1200);
    } catch (err) {
      const msg = err?.response?.data?.error || 'send failed, try again';
      setState({ type: 'err', msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9600,
        background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 460,
        background: 'linear-gradient(180deg, var(--bz1,#172636), var(--bz2,#0f1b27))',
        border: '1px solid var(--edge, var(--rim0, #1A3A50))',
        borderRadius: 8,
        boxShadow: '0 14px 36px rgba(0,0,0,.75), inset 0 1px 0 rgba(190,224,255,.18)',
        fontFamily: 'var(--font)',
        color: 'var(--fg1)',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '9px 14px',
          borderBottom: '1px solid var(--rim0)',
          background: 'linear-gradient(180deg, #0A1B2B, #061018)',
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
            color: 'var(--amber)',
          }}>
            REPORT A BUG
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={close}
            disabled={submitting}
            title="Close"
            style={{ width: 26, height: 22, padding: 0, fontSize: 12 }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '12px 14px' }}>
          <div style={{
            fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--fg3)', marginBottom: 4,
          }}>
            What happened? <span style={{ color: wordCount > SOFT_WORDS ? 'var(--amber)' : 'var(--fg3)' }}>
              ({wordCount}/{SOFT_WORDS} words)
            </span>
          </div>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value.slice(0, MAX_CHARS))}
            placeholder="Short description — what you did, what you expected, what actually happened."
            rows={4}
            style={{
              width: '100%',
              background: 'var(--bg0)',
              color: 'var(--fg0)',
              border: '1px solid var(--rim0)',
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
              fontFamily: 'var(--font)',
              resize: 'vertical',
              minHeight: 80,
            }}
          />

          <div style={{
            fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--fg3)', margin: '10px 0 4px',
          }}>
            Screenshots ({shots.length}/{MAX_SHOTS}) — optional
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {shots.map((s, i) => (
              <div key={i} style={{
                position: 'relative',
                width: 70, height: 54,
                border: '1px solid var(--rim0)',
                borderRadius: 4,
                overflow: 'hidden',
                background: 'var(--bg0)',
              }}>
                <img src={s.dataUrl} alt={s.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  onClick={() => removeShot(i)}
                  title="Remove"
                  style={{
                    position: 'absolute', top: 2, right: 2,
                    width: 16, height: 16, padding: 0,
                    borderRadius: 3,
                    border: 0,
                    background: 'rgba(0,0,0,.75)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 10, lineHeight: 1,
                  }}
                >✕</button>
              </div>
            ))}
            {shots.length < MAX_SHOTS && (
              <>
                <button
                  className="btn"
                  onClick={() => fileRef.current?.click()}
                  style={{
                    width: 70, height: 54,
                    padding: 0,
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  + Add
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
                />
              </>
            )}
          </div>

          {state.msg && (
            <div style={{
              marginTop: 10,
              fontSize: 11,
              color: state.type === 'err' ? 'var(--red)' : 'var(--lime)',
            }}>
              {state.msg}
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', gap: 6,
          padding: '10px 14px',
          borderTop: '1px solid var(--rim0)',
          background: 'linear-gradient(180deg, #061018, #020C14)',
        }}>
          <button className="btn" onClick={close} disabled={submitting}
            style={{ flex: 1, fontSize: 11, padding: '7px 10px' }}>
            Cancel
          </button>
          <button className="btn go" onClick={submit} disabled={submitting || !desc.trim()}
            style={{ flex: 2, fontSize: 11, padding: '7px 10px' }}>
            {submitting ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  );
}
