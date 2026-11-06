// Registry boot — thin wrapper around TerminalBoot. Owns the ship fetch
// and the SFX script (download loop, signal resolution, signal established);
// visuals and sequencing are all shared.

import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import TerminalBoot from './TerminalBoot';

const PHASES = [
  { label: 'AUTHENTICATING OPERATOR',    status: 'OK'    },
  { label: 'ACCESSING FLEET REGISTRY',   status: 'OK'    },
  { label: 'VERIFYING CLEARANCE',        status: 'OK'    },
  { label: 'ESTABLISHING UPLINK',        status: 'OK'    },
  { label: 'INITIALIZING CREW EDITOR',   status: 'OK'    },
  { label: 'ESTABLISHING CONNECTION',    status: 'READY' },
];

export default function RegistryBoot({ onComplete }) {
  const [ships, setShips] = useState(null);

  const dlAudioRef   = useRef(null);
  const resAudioRef  = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    api.get('/ships?includeStats=true')
      .then(({ data }) => {
        if (cancelledRef.current) return;
        setShips(Array.isArray(data) ? data : []);
      })
      .catch(() => { if (!cancelledRef.current) setShips([]); });

    return () => {
      cancelledRef.current = true;
      const dl = dlAudioRef.current;  if (dl) { try { dl.pause(); dl.src = ''; dl.load(); } catch {} }
      const a  = resAudioRef.current; if (a)  { try { a.pause();  a.src = '';  a.load(); } catch {} }
    };
  }, []);

  const handlePhase = (idx) => {
    if (idx === 0) {
      const dl = new Audio('/sounds/download_sound.mp3');
      dlAudioRef.current = dl;
      dl.play().catch(() => {});
    }
    if (idx === 3) {
      const dl = dlAudioRef.current;
      if (dl) { try { dl.pause(); dl.currentTime = 0; } catch {} }
      const a = new Audio('/sounds/signal_resolution.mp3');
      a.volume = 0.5;
      resAudioRef.current = a;
      a.play().catch(() => {});
    }
    if (idx === PHASES.length - 1) {
      try { new Audio('/sounds/signal_established.mp3').play().catch(() => {}); } catch {}
    }
  };

  const shipCount = ships?.length ?? 0;

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000', overflow: 'hidden',
    }}>
      <TerminalBoot
        title="NEXUS INTERSTELLAR TRAFFIC SYSTEM"
        subtitle="CENTRAL SHIP REGISTRY — OPERATOR ACCESS"
        operatorLine={<>OPERATOR: <b>REGISTRY ACCESS</b> &nbsp;//&nbsp; CLEARANCE: <b>VERIFIED</b></>}
        phases={PHASES}
        phaseDelay={700}
        finalLine={`> VESSEL MANIFESTS SYNCHRONIZED — ${shipCount} RECORDS LOADED`}
        onPhaseChange={handlePhase}
        onComplete={() => onComplete?.(ships ?? [])}
        completeDelay={3000}
        awaitingLabel="AWAITING VESSEL DATA INPUT"
        readyLabel="REGISTRY TERMINAL READY"
        loadingLabel="REGISTRY TERMINAL LOADING"
      />
    </div>
  );
}
