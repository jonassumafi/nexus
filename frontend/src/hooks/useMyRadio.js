// Fetches the player's assigned radio preset once and keeps it ready
// for the DSP chain. Backend auto-assigns a random radio on first
// access, so this always resolves to something (unless the API call
// itself fails, in which case `radio` stays null and the chain falls
// back to the pure voice-profile path).

import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';

export default function useMyRadio() {
  const [radio, setRadio]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const refetch = useCallback(() => {
    setLoading(true);
    api.get('/radio/my-radio')
      .then(({ data }) => { setRadio(data?.radio || null); setError(null); })
      .catch(err => { setRadio(null); setError(err); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { radio, loading, error, refetch };
}
