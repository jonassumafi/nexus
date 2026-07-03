import { useState, useEffect, useRef } from 'react';
import api from '../services/api';

// ─── SVG layout constants (match reference HTML) ────────────────────────────
const MID_Y        = 100;
const TX_W         = 68;
const TX_H         = 30;
const MAIN_W       = 105;
const MAIN_H       = 64;
const GROUP_LEAD   = 80;   // x of first group's sub-tree left edge
const GROUP_STRIDE = 340;  // px between group starts
const SCROLL_SPEED = 0.20; // px per requestAnimationFrame tick

// ─── DOS line definitions ────────────────────────────────────────────────────
const DOS_DEFS = [
  { text: '> INITIALIZING NEXUS REGISTRY ACCESS PROTOCOL...', color: '#66AADD' },
  { text: '> AUTHENTICATING OPERATOR CREDENTIALS...',          color: '#66AADD' },
  { text: '> CREDENTIALS VERIFIED — CLEARANCE LEVEL: OPERATOR', color: '#33DDAA' },
  { text: '> ESTABLISHING UPLINK TO UEE CENTRAL DATABASE...', color: '#66AADD' },
  // ← audio plays then onended gates the rest
  { text: '> SIGNAL ACQUIRED — NODE 7 ONLINE',               color: '#33DDAA' },
  // line 5 is injected dynamically with actual ship count
  { text: '> INITIATING BLOCKCHAIN SYNC — DOWNLOADING VESSEL DATA...', color: '#66AADD' },
  { text: '> VERIFYING MERKLE TREE INTEGRITY...',             color: '#2A6A9A' },
];

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export default function RegistryBoot({ onComplete }) {
  const [dosLines,      setDosLines]      = useState([]);
  const [signalVisible, setSignalVisible] = useState(false);
  const [activeBars,    setActiveBars]    = useState(0);
  const [signalLocked,  setSignalLocked]  = useState(false);
  const [vpVisible,     setVpVisible]     = useState(false);
  const [counter,       setCounter]       = useState('');
  const [finalText,     setFinalText]     = useState('');
  const [finalVisible,  setFinalVisible]  = useState(false);

  const svgRef          = useRef(null);
  const vpRef           = useRef(null);
  const shipsRef        = useRef([]);
  const groupDataRef    = useRef([]);
  const groupVerified   = useRef({});
  const verifiedCount   = useRef(0);
  const scrollX         = useRef(0);
  const allDone         = useRef(false);
  const rafId           = useRef(null);
  const onCompleteRef   = useRef(onComplete);
  const tids            = useRef([]);  // setTimeout IDs
  const iids            = useRef([]);  // setInterval IDs
  const audioRef        = useRef(null);
  const cancelledRef    = useRef(false);
  const seqStarted      = useRef(false);
  // Stable NTT amounts per ship._id — generated once, never re-derived
  const nttRef          = useRef({});

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      allDone.current = true;
      cancelAnimationFrame(rafId.current);
      tids.current.forEach(clearTimeout);
      iids.current.forEach(clearInterval);
      const a = audioRef.current;
      if (a) { try { a.pause(); a.src = ''; a.load(); } catch {} }
    };
  }, []);

  // Fetch ships and start sequence
  useEffect(() => {
    api.get('/ships?includeStats=true')
      .then(({ data }) => {
        if (cancelledRef.current) return;
        const list = Array.isArray(data) ? data : [];
        shipsRef.current = list;
        // Generate stable NTT amounts once
        list.forEach(s => {
          if (!nttRef.current[s._id]) {
            nttRef.current[s._id] = (Math.random() * 30 + 5).toFixed(3);
          }
        });
        startSequence(list);
      })
      .catch(() => {
        if (!cancelledRef.current) startSequence([]);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function sched(fn, delay) {
    const id = setTimeout(() => { if (!cancelledRef.current) fn(); }, delay);
    tids.current.push(id);
    return id;
  }

  function addLine(text, color) {
    if (cancelledRef.current) return;
    setDosLines(prev => [...prev, { id: Date.now() + Math.random(), text, color }]);
  }

  function startSequence(ships) {
    if (seqStarted.current) return;
    seqStarted.current = true;

    const shipCount = ships.length;

    // Lines 0-3 at 1200ms intervals
    sched(() => addLine(DOS_DEFS[0].text, DOS_DEFS[0].color), 0);
    sched(() => addLine(DOS_DEFS[1].text, DOS_DEFS[1].color), 1200);
    sched(() => addLine(DOS_DEFS[2].text, DOS_DEFS[2].color), 2400);
    sched(() => {
      addLine(DOS_DEFS[3].text, DOS_DEFS[3].color);

      // Play audio after line 3, gate remaining lines on onended
      const audio = new Audio('/sounds/signal_resolution.mp3');
      audioRef.current = audio;
      audio.volume = 0.5;
      audio.play().catch(() => {});

      audio.onended = () => {
        if (cancelledRef.current) return;

        addLine(DOS_DEFS[4].text, DOS_DEFS[4].color);
        sched(() => addLine(`> VESSEL MANIFESTS DETECTED: ${shipCount} RECORDS`, '#FFBB33'), 1200);
        sched(() => addLine(DOS_DEFS[5].text, DOS_DEFS[5].color), 2400);
        sched(() => {
          addLine(DOS_DEFS[6].text, DOS_DEFS[6].color);

          // 600ms after last dos line, show signal bars
          sched(() => {
            setSignalVisible(true);
            animateBars(() => {
              // bars done → fade in viewport, start blockchain
              setVpVisible(true);
              sched(() => {
                buildGroups(ships);
                startScroll(ships.length);
              }, 100); // tiny buffer for vp fade-in transition
            });
          }, 600);
        }, 3600);
      };

      // If audio fails to fire onended (e.g. blocked), fall through after 8s
      sched(() => {
        if (!cancelledRef.current && verifiedCount.current === 0 && !seqStarted.current) {
          audio.onended?.();
        }
      }, 8000);
    }, 3600);
  }

  function animateBars(cb) {
    let i = 0;
    const tick = () => {
      if (cancelledRef.current) return;
      if (i < 5) {
        setActiveBars(i + 1);
        i++;
        const id = setTimeout(tick, 220);
        tids.current.push(id);
      } else {
        setSignalLocked(true);
        const id = setTimeout(cb, 500);
        tids.current.push(id);
      }
    };
    tick();
  }

  function buildGroups(ships) {
    const svg = svgRef.current;
    if (!svg) return;

    const groups = ships.map((ship, gi) => {
      const x      = GROUP_LEAD + gi * GROUP_STRIDE;
      const mainX  = x + 140;
      const hash   = '#' + ship._id.toString().slice(-8).toUpperCase();
      const ntt    = nttRef.current[ship._id];
      return { x, mainX, ship, hash, ntt, subtrees: ['CREW', 'LOGS', 'CARGO'] };
    });
    groupDataRef.current = groups;

    const totalW = groups.length > 0
      ? groups[groups.length - 1].mainX + MAIN_W + 120
      : 720;
    svg.setAttribute('width', Math.max(totalW, 720));

    const sp = 38; // vertical spacing between sub-tree rows

    groups.forEach((g, gi) => {
      const txCount = g.subtrees.length;
      const sy = MID_Y - ((txCount - 1) / 2) * sp;
      const mcx = g.x + TX_W + 24; // convergence x for connector branches

      g.subtrees.forEach((label, ti) => {
        const ty  = sy + ti * sp - TX_H / 2;
        const tid = `${gi}_${ti}`;

        // Connector path: sub-tree right edge → midpoint column → VESSEL block
        svg.appendChild(svgEl('path', {
          d: `M${g.x + TX_W},${ty + TX_H / 2} L${mcx},${ty + TX_H / 2} L${mcx},${MID_Y} L${g.mainX},${MID_Y}`,
          fill: 'none', stroke: '#1A3D55', 'stroke-width': 1, id: `conn_${tid}`,
        }));
        // Background rect
        svg.appendChild(svgEl('rect', {
          x: g.x, y: ty, width: TX_W, height: TX_H,
          fill: '#06121C', stroke: '#1A3D55', 'stroke-width': 1, id: `txf_${tid}`,
        }));
        // Fill progress rect
        svg.appendChild(svgEl('rect', {
          x: g.x, y: ty, width: 0, height: TX_H,
          fill: 'rgba(0,238,255,0.14)', id: `txp_${tid}`,
        }));
        // Sub-tree label
        const lbl = svgEl('text', {
          x: g.x + TX_W / 2, y: ty + TX_H / 2 - 3,
          'text-anchor': 'middle', fill: '#2A6A9A',
          'font-size': 8, 'font-family': 'JetBrains Mono,monospace', 'font-weight': 'bold',
          id: `tl1_${tid}`,
        });
        lbl.textContent = label;
        svg.appendChild(lbl);
        // Status text
        const st = svgEl('text', {
          x: g.x + TX_W / 2, y: ty + TX_H / 2 + 7,
          'text-anchor': 'middle', fill: '#1A3D55',
          'font-size': 7, 'font-family': 'JetBrains Mono,monospace',
          id: `tl2_${tid}`,
        });
        st.textContent = 'PENDING';
        svg.appendChild(st);
        // Node dot at convergence point
        svg.appendChild(svgEl('circle', {
          cx: mcx, cy: ty + TX_H / 2, r: 3, fill: '#1A3D55', id: `dot_${tid}`,
        }));
      });

      // VESSEL main block background
      svg.appendChild(svgEl('rect', {
        x: g.mainX, y: MID_Y - MAIN_H / 2, width: MAIN_W, height: MAIN_H,
        fill: '#06121C', stroke: '#1A3D55', 'stroke-width': 1, id: `mb_${gi}`,
      }));
      // VESSEL fill progress
      svg.appendChild(svgEl('rect', {
        x: g.mainX, y: MID_Y - MAIN_H / 2, width: 0, height: MAIN_H,
        fill: 'rgba(0,238,255,0.11)', id: `mbp_${gi}`,
      }));

      const addVText = (id, y, fill, size, fw, text) => {
        const el = svgEl('text', {
          x: g.mainX + MAIN_W / 2, y,
          'text-anchor': 'middle', fill,
          'font-size': size, 'font-family': 'JetBrains Mono,monospace',
          ...(fw ? { 'font-weight': fw } : {}),
          id,
        });
        el.textContent = text;
        svg.appendChild(el);
      };

      addVText(`mbs_${gi}`,  MID_Y - 22, '#1A3D55', 8, 'bold', 'VESSEL');
      addVText(`mbh_${gi}`,  MID_Y - 11, '#1A3D55', 7, null,   g.hash);
      addVText(`mbsh_${gi}`, MID_Y + 2,  '#1A3D55', 7, null,   g.ship.ship_name || '—');
      addVText(`mbst_${gi}`, MID_Y + 13, '#1A3D55', 7, null,   'PENDING');
      addVText(`mbnt_${gi}`, MID_Y + 24, '#1A3D55', 7, null,   '');

      // Chain connector line + node dot to next group
      if (gi < groups.length - 1) {
        const nextMainX = groups[gi + 1].mainX;
        svg.insertBefore(
          svgEl('line', {
            x1: g.mainX + MAIN_W, y1: MID_Y,
            x2: nextMainX, y2: MID_Y,
            stroke: '#1A3D55', 'stroke-width': 1, id: `chl_${gi}`,
          }),
          svg.firstChild,
        );
        svg.appendChild(svgEl('circle', {
          cx: g.mainX + MAIN_W + 10, cy: MID_Y, r: 3,
          fill: '#1A3D55', id: `chd_${gi}`,
        }));
      }
    });
  }

  function q(id) { return document.getElementById(id); }

  function activateGroup(gi) {
    if (groupVerified.current[gi] || cancelledRef.current) return;
    groupVerified.current[gi] = true;

    const g = groupDataRef.current[gi];
    if (!g) return;
    const totalGroups = groupDataRef.current.length;

    // Animate each sub-tree
    g.subtrees.forEach((_, ti) => {
      const tid = `${gi}_${ti}`;
      const id  = setTimeout(() => {
        if (cancelledRef.current) return;
        q(`txf_${tid}`)?.setAttribute('stroke', '#00EEFF');
        q(`tl1_${tid}`)?.setAttribute('fill', '#66AADD');
        const tl2 = q(`tl2_${tid}`);
        if (tl2) { tl2.textContent = 'SYNCING'; tl2.setAttribute('fill', '#00EEFF'); }

        const prog = q(`txp_${tid}`);
        let w = 0;
        const iid = setInterval(() => {
          if (cancelledRef.current) { clearInterval(iid); return; }
          w += 1.8;
          prog?.setAttribute('width', String(Math.min(w, 100) * TX_W / 100));
          if (w >= 100) {
            clearInterval(iid);
            q(`txf_${tid}`)?.setAttribute('stroke', '#33DDAA');
            prog?.setAttribute('fill', 'rgba(51,221,170,0.1)');
            q(`tl1_${tid}`)?.setAttribute('fill', '#33DDAA');
            const tl2b = q(`tl2_${tid}`);
            if (tl2b) { tl2b.textContent = '✓ OK'; tl2b.setAttribute('fill', '#33DDAA'); }
            q(`conn_${tid}`)?.setAttribute('stroke', '#33DDAA');
            q(`dot_${tid}`)?.setAttribute('fill', '#33DDAA');
          }
        }, 40);
        iids.current.push(iid);
      }, ti * 600);
      tids.current.push(id);
    });

    // Animate VESSEL main block (starts after all sub-trees)
    const mainDelay = g.subtrees.length * 600 + 800;
    const mainId = setTimeout(() => {
      if (cancelledRef.current) return;
      const mb  = q(`mb_${gi}`);
      const mbp = q(`mbp_${gi}`);
      if (!mb) return;

      mb.setAttribute('stroke', '#00EEFF');
      q(`mbs_${gi}`)?.setAttribute('fill', '#99CCFF');
      q(`mbh_${gi}`)?.setAttribute('fill', '#4488BB');
      q(`mbsh_${gi}`)?.setAttribute('fill', '#CCE8FF');
      const mbst = q(`mbst_${gi}`);
      if (mbst) { mbst.textContent = 'VERIFYING'; mbst.setAttribute('fill', '#00EEFF'); }

      let w = 0;
      const iid = setInterval(() => {
        if (cancelledRef.current) { clearInterval(iid); return; }
        w += 0.7;
        mbp?.setAttribute('width', String(Math.min(w, 100) * MAIN_W / 100));
        if (w >= 100) {
          clearInterval(iid);
          mb.setAttribute('stroke', '#33DDAA');
          mb.setAttribute('fill', '#040D15');
          mbp?.setAttribute('fill', 'rgba(51,221,170,0.13)');
          q(`mbs_${gi}`)?.setAttribute('fill', '#CCE8FF');
          q(`mbh_${gi}`)?.setAttribute('fill', '#33DDAA');
          q(`mbsh_${gi}`)?.setAttribute('fill', '#CCE8FF');
          const mbst2 = q(`mbst_${gi}`);
          if (mbst2) { mbst2.textContent = '✓ VERIFIED'; mbst2.setAttribute('fill', '#33DDAA'); }
          const mbnt = q(`mbnt_${gi}`);
          if (mbnt) { mbnt.textContent = (g.ntt || '') + ' NTT'; mbnt.setAttribute('fill', '#33DDAA'); }

          // Color chain connector to next group
          if (gi < totalGroups - 1) {
            q(`chl_${gi}`)?.setAttribute('stroke', '#33DDAA');
            q(`chd_${gi}`)?.setAttribute('fill', '#33DDAA');
          }

          verifiedCount.current++;
          if (!cancelledRef.current) {
            setCounter(`VESSEL MANIFESTS VERIFIED: ${verifiedCount.current} / ${totalGroups}`);
          }

          if (verifiedCount.current === totalGroups) {
            const doneId = setTimeout(() => {
              if (cancelledRef.current) return;
              addLine(`> VESSEL MANIFESTS SYNCHRONIZED — ${totalGroups} RECORDS LOADED`, '#33DDAA');
              setFinalText('[ REGISTRY READY ]');
              setFinalVisible(true);
              const completeId = setTimeout(() => {
                allDone.current = true;
                onCompleteRef.current?.(shipsRef.current);
              }, 2000);
              tids.current.push(completeId);
            }, 800);
            tids.current.push(doneId);
          }
        }
      }, 45);
      iids.current.push(iid);
    }, mainDelay);
    tids.current.push(mainId);
  }

  function startScroll(groupCount) {
    if (groupCount === 0) {
      // No ships — skip blockchain, fire completion immediately
      setCounter('VESSEL MANIFESTS VERIFIED: 0 / 0');
      addLine('> VESSEL MANIFESTS SYNCHRONIZED — 0 RECORDS LOADED', '#33DDAA');
      setFinalText('[ REGISTRY READY ]');
      setFinalVisible(true);
      const id = setTimeout(() => {
        allDone.current = true;
        onCompleteRef.current?.([]);
      }, 2000);
      tids.current.push(id);
      return;
    }

    const tick = () => {
      if (allDone.current || cancelledRef.current) return;
      scrollX.current += SCROLL_SPEED;

      const svg = svgRef.current;
      if (svg) svg.style.transform = `translateX(-${scrollX.current}px)`;

      groupDataRef.current.forEach((g, gi) => {
        const screenX = g.mainX - scrollX.current;
        if (screenX < 460 && screenX > -300) activateGroup(gi);
      });

      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
  }

  const barHeights = [4, 8, 12, 16, 18];

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000', overflow: 'hidden',
    }}>
      <div style={{
        width: 700,
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      }}>
        {/* Header */}
        <div style={{
          fontSize: 13, color: '#99CCFF', fontWeight: 'bold',
          letterSpacing: '0.16em', textAlign: 'center', marginBottom: 4,
        }}>
          NEXUS INTERSTELLAR TRAFFIC SYSTEM
        </div>
        <div style={{
          fontSize: 10, color: '#4488BB',
          letterSpacing: '0.12em', textAlign: 'center', marginBottom: 20,
        }}>
          CENTRAL SHIP REGISTRY — OPERATOR ACCESS
        </div>

        {/* DOS log */}
        <div style={{ minHeight: 130, marginBottom: 16 }}>
          {dosLines.map(line => (
            <div key={line.id} style={{
              fontSize: 11, color: line.color,
              letterSpacing: '0.06em', lineHeight: 1.9,
            }}>
              {line.text}
            </div>
          ))}
        </div>

        {/* Signal row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, marginBottom: 16,
          opacity: signalVisible ? 1 : 0, transition: 'opacity 0.5s',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 18 }}>
            {barHeights.map((h, i) => (
              <div key={i} style={{
                width: 4, height: h,
                background: activeBars > i ? '#00EEFF' : '#1A3D55',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#00EEFF', letterSpacing: '0.1em' }}>
            {signalLocked ? 'SIGNAL LOCKED · UEE NODE 7' : 'ACQUIRING SIGNAL...'}
          </div>
        </div>

        {/* Blockchain viewport */}
        <div
          ref={vpRef}
          style={{
            width: 700, height: 200,
            overflow: 'hidden', position: 'relative',
            borderTop: '1px solid #0D2030', borderBottom: '1px solid #0D2030',
            opacity: vpVisible ? 1 : 0, transition: 'opacity 0.5s',
          }}
        >
          <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            height={200}
            style={{ position: 'absolute', top: 0, left: 0, willChange: 'transform' }}
          />
        </div>

        {/* Verified counter */}
        <div style={{
          fontSize: 10, color: '#4488BB', textAlign: 'center',
          marginTop: 8, letterSpacing: '0.08em', minHeight: 14,
        }}>
          {counter}
        </div>

        {/* Final line */}
        <div style={{
          fontSize: 12, color: '#33DDAA', fontWeight: 'bold',
          letterSpacing: '0.1em', marginTop: 8, textAlign: 'center',
          opacity: finalVisible ? 1 : 0, transition: 'opacity 0.8s', minHeight: 18,
        }}>
          {finalText}
        </div>
      </div>
    </div>
  );
}
