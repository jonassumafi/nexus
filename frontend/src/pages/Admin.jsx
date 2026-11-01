// Admin panel — platform-owner tooling. First real section is radio
// rig reassignment (list all operators, swap their SRS preset, or roll
// a fresh random one). More admin tooling can be added as sibling
// panels below.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import TitleBar from '../components/TitleBar';

export default function Admin() {
  const navigate = useNavigate();
  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--void)',
      color: 'var(--fg1)', fontFamily: 'var(--font)',
      overflow: 'hidden',
    }}>
      <TitleBar title="NEXUS" subtitle="Admin" />
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '10px 16px',
        background: 'var(--bg1)',
        borderBottom: '1px solid var(--rim0)',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
          color: 'var(--blue)',
        }}>
          ADMIN · PLATFORM OWNER
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => navigate('/dashboard')}
          style={{ fontSize: 12, padding: '6px 12px' }}>
          ← Back to dashboard
        </button>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: 20,
      }}>
        <RadioReassignmentPanel />
      </div>
    </div>
  );
}

function RadioReassignmentPanel() {
  const [users, setUsers]   = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [busy, setBusy]       = useState({});   // userId → bool while saving
  const [feedback, setFeedback] = useState({}); // userId → { type, msg }

  const refetch = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/admin/users'),
      api.get('/radio/models'),
    ]).then(([u, m]) => {
      setUsers(Array.isArray(u.data) ? u.data : []);
      setModels(Array.isArray(m.data) ? m.data : []);
    }).catch(err => {
      console.error('[admin radio] load failed:', err);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  const modelsById = useMemo(() => {
    const m = new Map();
    for (const r of models) m.set(r.id, r);
    return m;
  }, [models]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.citizen_name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.radio_type || '').toLowerCase().includes(q)
    );
  }, [users, filter]);

  const assign = async (userId, body) => {
    setBusy(b => ({ ...b, [userId]: true }));
    setFeedback(f => ({ ...f, [userId]: null }));
    try {
      const { data } = await api.put(`/radio/user/${userId}/radio`, body);
      setUsers(us => us.map(u => u._id === userId ? { ...u, radio_type: data.radio_type } : u));
      setFeedback(f => ({ ...f, [userId]: { type: 'ok', msg: `→ ${data.radio_type}` } }));
      setTimeout(() => setFeedback(f => ({ ...f, [userId]: null })), 2500);
    } catch (err) {
      setFeedback(f => ({ ...f, [userId]: { type: 'err', msg: err?.response?.data?.error || 'failed' } }));
    } finally {
      setBusy(b => ({ ...b, [userId]: false }));
    }
  };

  return (
    <div className="raised" style={{ padding: '16px 20px' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline',
        gap: 10, marginBottom: 14,
      }}>
        <div className="h3" style={{ margin: 0 }}>Radio rig assignments</div>
        <div style={{ fontSize: 11, color: 'var(--fg3)' }}>
          {users.length} operator{users.length === 1 ? '' : 's'} · {models.length} rigs available
        </div>
        <div style={{ flex: 1 }} />
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by name or rig id…"
          style={{
            width: 240, fontSize: 12,
            background: 'var(--inset)',
            border: '1px solid var(--rim0)',
            borderRadius: 4, padding: '5px 10px',
            color: 'var(--fg1)',
          }}
        />
        <button className="btn" onClick={refetch} style={{ fontSize: 11, padding: '5px 10px' }}>
          ↺ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '20px 0', fontSize: 12, color: 'var(--fg3)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '20px 0', fontSize: 12, color: 'var(--fg3)' }}>No operators match that filter.</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr auto auto auto',
          columnGap: 10, rowGap: 6,
          fontSize: 12,
          alignItems: 'center',
        }}>
          <HeaderCell>Operator</HeaderCell>
          <HeaderCell>Current rig</HeaderCell>
          <HeaderCell align="right">Pick</HeaderCell>
          <HeaderCell align="right">Re-roll</HeaderCell>
          <HeaderCell align="right">Status</HeaderCell>

          {filtered.map(u => {
            const rig = modelsById.get(u.radio_type);
            const fb = feedback[u._id];
            return (
              <div key={u._id} style={{ display: 'contents' }}>
                <div style={{
                  padding: '6px 0',
                  borderTop: '1px solid var(--rim0)',
                  color: 'var(--fg0)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {u.citizen_name || u.username || '—'}
                </div>
                <div style={{
                  padding: '6px 0',
                  borderTop: '1px solid var(--rim0)',
                  color: 'var(--fg2)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {rig ? `${rig.label} · ${rig.band}` : (u.radio_type || <span style={{ color: 'var(--fg3)', fontStyle: 'italic' }}>unassigned</span>)}
                </div>
                <div style={{ padding: '6px 0', borderTop: '1px solid var(--rim0)', textAlign: 'right' }}>
                  <select
                    value={u.radio_type || ''}
                    onChange={e => {
                      const v = e.target.value;
                      if (v) assign(u._id, { radio_type: v });
                    }}
                    disabled={busy[u._id]}
                    style={{
                      fontSize: 11, padding: '3px 6px',
                      background: 'var(--inset)',
                      border: '1px solid var(--rim0)',
                      color: 'var(--fg1)',
                      borderRadius: 3,
                      minWidth: 180,
                    }}
                  >
                    <option value="">—</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.label} · {m.band} ({m.family_label})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ padding: '6px 0', borderTop: '1px solid var(--rim0)', textAlign: 'right' }}>
                  <button
                    className="btn"
                    disabled={busy[u._id]}
                    onClick={() => assign(u._id, { reroll: true })}
                    title="Assign a random rig"
                    style={{ fontSize: 10, padding: '3px 8px' }}
                  >
                    ↺ Random
                  </button>
                </div>
                <div style={{
                  padding: '6px 0',
                  borderTop: '1px solid var(--rim0)',
                  textAlign: 'right',
                  fontSize: 10,
                  color: fb?.type === 'err' ? 'var(--red)' : fb?.type === 'ok' ? 'var(--lime)' : 'var(--fg3)',
                  minWidth: 80,
                }}>
                  {busy[u._id] ? '…' : (fb?.msg || '')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HeaderCell({ children, align = 'left' }) {
  return (
    <div style={{
      fontSize: 10, color: 'var(--fg3)',
      letterSpacing: '0.14em', textTransform: 'uppercase',
      padding: '0 0 6px',
      textAlign: align,
    }}>
      {children}
    </div>
  );
}
