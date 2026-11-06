// Fetches the player's assigned radio preset once and keeps it ready
// for the DSP chain. Backend auto-assigns a random radio on first
// access, so this always resolves to something (unless the API call
// itself fails, in which case `radio` stays null and the chain falls
// back to the pure voice-profile path).
//
// Cross-instance sync: multiple components call useMyRadio() independently
// (dashboard badge, Companion, Radio-only, picker modal). When any of
// them calls refetch() — typically after writing /radio/my-radio — a
// window custom event fires so the other instances refresh too. Without
// this, the picker could update its own view while the badge still shows
// the previous radio until the next page load.

import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';

const RADIO_CHANGED_EVENT = 'nexus:my-radio-changed';

/**
 * @param {{ tunerId?: 'left'|'right' }} [opts] default 'right' (primary)
 */
export default function useMyRadio(opts = {}) {
  const tunerId = opts.tunerId === 'left' ? 'left' : 'right';
  const [radio, setRadio]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const refetch = useCallback((broadcast = true) => {
    setLoading(true);
    api.get('/radio/my-radio', { params: { tunerId } })
      .then(({ data }) => {
        setRadio(data?.radio || null); setError(null);
        if (broadcast) {
          try { window.dispatchEvent(new CustomEvent(RADIO_CHANGED_EVENT, { detail: { tunerId } })); } catch {}
        }
      })
      .catch(err => { setRadio(null); setError(err); })
      .finally(() => setLoading(false));
  }, [tunerId]);

  useEffect(() => {
    refetch(false);
    const onChanged = (e) => {
      // Only refetch if the change was for this tuner (or legacy no-tuner
      // event for pre-v0.9 broadcasts).
      const changedTuner = e?.detail?.tunerId;
      if (changedTuner && changedTuner !== tunerId) return;
      refetch(false);
    };
    window.addEventListener(RADIO_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(RADIO_CHANGED_EVENT, onChanged);
  }, [refetch, tunerId]);

  return { radio, loading, error, refetch };
}
