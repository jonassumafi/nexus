// Radio picker — focused modal for switching the operator's assigned
// SRS radio preset. Replaces the earlier VoiceProfileModal (removed when
// the voice-edit sliders were cut to match SRS's architecture, which has
// no per-player voice character).
//
// Backend endpoints: GET /radio/models, PUT /radio/my-radio.

import { useEffect, useState } from 'react';
import api from '../services/api';
import useMyRadio from '../hooks/useMyRadio';

export default function RadioPickerModal({ open, onClose, tunerId = 'right' }) {
  const { radio, refetch } = useMyRadio({ tunerId });
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/radio/models')
      .then(({ data }) => { setModels(Array.isArray(data) ? data : []); setError(null); })
      .catch(err => setError(err?.message || 'Failed to load radios'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const pickRadio = async (id) => {
    if (switching || id === radio?.id) return;
    setSwitching(true);
    setError(null);
    try {
      await api.put('/radio/my-radio', { radio_type: id, tunerId });
      await refetch();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Switch failed');
    } finally {
      setSwitching(false);
    }
  };

  const reroll = async () => {
    if (switching) return;
    setSwitching(true);
    setError(null);
    try {
      await api.put('/radio/my-radio', { reroll: true, tunerId });
      await refetch();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Reroll failed');
    } finally {
      setSwitching(false);
    }
  };

  const clearCommandInherit = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      await api.put('/radio/my-radio', { radio_type: null, tunerId: 'left' });
      await refetch();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Clear failed');
    } finally {
      setSwitching(false);
    }
  };

  const byFamily = models.reduce((acc, m) => {
    const k = m.family || 'other';
    (acc[k] = acc[k] || []).push(m);
    return acc;
  }, {});
  const familyOrder = ['personal', 'ship', 'broadcast', 'other'];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '82vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg1)',
          border: '1px solid var(--rim1)',
          borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(180deg, var(--bg3), var(--bg2))',
          borderBottom: '1px solid var(--edge)',
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--fg0)',
            flex: 1,
          }}>{tunerId === 'left' ? 'Switch Command radio' : 'Switch radio'}</span>
          {tunerId === 'left' && radio && (
            <button
              className="btn"
              onClick={clearCommandInherit}
              disabled={switching}
              title="Clear and inherit the primary radio"
              style={{ fontSize: 11, padding: '5px 10px' }}
            >Inherit primary</button>
          )}
          <button
            className="btn"
            onClick={reroll}
            disabled={switching}
            style={{ fontSize: 11, padding: '5px 10px' }}
          >Random reroll</button>
          <button
            className="btn"
            onClick={onClose}
            style={{ fontSize: 11, padding: '5px 10px' }}
          >Close</button>
        </div>

        {radio && (
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--rim0)',
            background: 'color-mix(in srgb, var(--cyan) 6%, var(--bg1))',
          }}>
            <div style={{ fontSize: 10, color: 'var(--fg2)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Current rig
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg0)', marginTop: 2 }}>
              <span style={{ color: 'var(--cyan)', marginRight: 8 }}>{radio.band}</span>
              {radio.label}
            </div>
            {radio.blurb && (
              <div style={{ fontSize: 11, color: 'var(--fg2)', marginTop: 3, lineHeight: 1.4 }}>
                {radio.blurb}
              </div>
            )}
          </div>
        )}

        <div style={{
          flex: 1, overflowY: 'auto', padding: 10,
        }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--fg2)' }}>Loading…</div>}
          {error && (
            <div style={{
              padding: 8, fontSize: 11, color: 'var(--red)',
              border: '1px solid var(--red)', borderRadius: 4, marginBottom: 10,
            }}>{error}</div>
          )}
          {!loading && familyOrder.map(fam => {
            const list = byFamily[fam];
            if (!list?.length) return null;
            return (
              <div key={fam} style={{ marginBottom: 14 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--fg2)',
                  letterSpacing: '0.14em', textTransform: 'uppercase',
                  padding: '4px 2px 6px',
                }}>
                  {fam === 'ship' ? 'Ship-fit' :
                   fam === 'personal' ? 'Personal / handheld' :
                   fam === 'broadcast' ? 'Broadcast' : fam}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {list.map(m => {
                    const isCurrent = m.id === radio?.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => pickRadio(m.id)}
                        disabled={switching || isCurrent}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          background: isCurrent
                            ? 'color-mix(in srgb, var(--cyan) 14%, var(--bg2))'
                            : 'var(--bg2)',
                          border: `1px solid ${isCurrent ? 'var(--cyan)' : 'var(--rim0)'}`,
                          borderRadius: 5,
                          cursor: isCurrent ? 'default' : 'pointer',
                          color: 'var(--fg0)',
                          fontFamily: 'inherit',
                          opacity: switching && !isCurrent ? 0.5 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{
                            fontSize: 10,
                            color: 'var(--cyan)',
                            letterSpacing: '0.1em',
                            fontWeight: 700,
                            minWidth: 36,
                          }}>{m.band}</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</span>
                          {isCurrent && (
                            <span style={{
                              marginLeft: 'auto', fontSize: 10, color: 'var(--cyan)',
                              letterSpacing: '0.1em',
                            }}>CURRENT</span>
                          )}
                        </div>
                        {m.blurb && (
                          <div style={{
                            fontSize: 11, color: 'var(--fg2)', marginTop: 2, lineHeight: 1.35,
                          }}>{m.blurb}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
