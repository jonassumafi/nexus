import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocketContext } from '../context/SocketContext';
import api from '../services/api';
import { buildSpacesuitChain } from '../utils/spacesuitFilter';
import { getRadioChrome, getOutboundDelay, channelColor } from '../utils/radioChrome';
import { buildSrsChain, ensureCvsdWorkletLoaded } from '../utils/srsChain';
import { createUdpVoiceTx } from '../utils/udpVoiceTx';
import { createUdpVoiceRx } from '../utils/udpVoiceRx';

// Parallel Crew hook that uses the UDP relay instead of WebRTC. The DSP
// chain (spacesuit → SRS → chrome click/bed/SELCAL/channel color) is
// preserved identically; only the transport changes.
//
// Signaling still runs on Socket.IO using the same radio:* events, so
// peer presence + PTT indicators work the same. No RTCPeerConnection,
// no offer/answer/ice.

const UDP_PORT = 41234;

// Band mapping mirrors electron/src/udp-voice.js bandStringToByte — one
// place per side so sender/receiver stay in lockstep.
const BAND_TO_BYTE = { unknown: 0, UHF: 1, VHF: 2, HF: 3, FM: 4, KY58: 5 };
function bandStringToByte(band) {
  if (typeof band === 'number') return (band >= 0 && band <= 5) ? band : 0;
  return BAND_TO_BYTE[String(band || '').toUpperCase()] ?? 0;
}

function applyChannelColor(chain, baseProfile, freqString) {
  if (!chain || !baseProfile) return;
  const c = channelColor(freqString);
  chain.setParam('highpass',       (baseProfile.highpass       ?? 300)  + c.highpass_delta);
  chain.setParam('lowpass',        (baseProfile.lowpass        ?? 3200) + c.lowpass_delta);
  chain.setParam('resonance_freq', (baseProfile.resonance_freq ?? 1500) + c.resonance_freq_delta);
  chain.setParam('resonance_q',    (baseProfile.resonance_q    ?? 3)    + c.resonance_q_delta);
  chain.setParam('bit_crush',      (baseProfile.bit_crush      ?? 16)   + c.bit_crush_delta);
}

// UDP voice runs on a dedicated subdomain that bypasses Cloudflare's
// HTTP-only proxy (grey-cloud A record → the home box). The main
// nexus-missions.space hostname is proxied and can't carry UDP.
// Localhost dev falls back to 127.0.0.1 — operator must run the relay
// locally in that case.
function deriveUdpHost() {
  try {
    const h = window.location.hostname;
    if (!h || h === 'localhost' || h === '127.0.0.1') return '127.0.0.1';
    return 'udp.nexus-missions.space';
  } catch {
    return 'udp.nexus-missions.space';
  }
}

export function useRadioConnectionUDP({
  voiceProfile,
  voiceProfileVersion = 0,
  pttKey = 'v',
  micDeviceId = null,
  outputDeviceId = null,
  me = null,                 // used for userId on the UDP header
}) {
  const { socket } = useSocketContext();
  const hasUdp = typeof window !== 'undefined' && !!window.electronAPI?.udp;

  const [tunedFrequency, setTunedFrequency] = useState(null);
  const [peers, setPeers] = useState([]);
  const [transmittingPeerIds, setTransmittingPeerIds] = useState([]);
  const transmittingPeerIdsRef = useRef([]);
  const [isPTTActive, setIsPTTActive] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [micPermission, setMicPermission] = useState(hasUdp ? 'unknown' : 'unknown');

  const micDeviceIdRef    = useRef(micDeviceId);
  const outputDeviceIdRef = useRef(outputDeviceId);
  useEffect(() => { micDeviceIdRef.current = micDeviceId; }, [micDeviceId]);
  useEffect(() => { outputDeviceIdRef.current = outputDeviceId; }, [outputDeviceId]);

  // UDP wiring refs
  const udpTxRef         = useRef(null);
  const udpRxRef         = useRef(null);
  // Session-ID token returned by udp.open(). Passed back to udp.close()
  // so a late unmount cleanup from the PREVIOUS view can't kill the
  // session the CURRENT view just opened. The main process ignores
  // close(id) when id doesn't match the live session.
  const udpSessionIdRef  = useRef(null);
  const keepaliveTimerRef = useRef(null);
  // userId -> HTMLAudioElement
  const peerAudiosRef    = useRef({});
  // userId -> setTimeout handle (debounces "went quiet" edge)
  const peerSilenceTimersRef = useRef({});
  const peersRef         = useRef([]);

  // DSP + mic refs — mirror of the WebRTC hook
  const audioCtxRef     = useRef(null);
  const micStreamRef    = useRef(null);
  const filterChainRef  = useRef(null);
  const srsChainRef     = useRef(null);
  // Final AudioNode of the TX graph (after spacesuit → SRS → FM pre-
  // emphasis → outbound delay). createUdpVoiceTx taps this node in the
  // same AudioContext as the mic chain, avoiding Chromium's cross-
  // context MediaStreamSource silencing bug that broke every
  // post-view-switch TX in v0.9.26.
  const txFinalNodeRef  = useRef(null);
  const srsSpecRef      = useRef(null);
  const srsBandRef      = useRef('VHF');
  const filteredStreamRef = useRef(null);
  const currentFreqRef  = useRef(null);
  const currentMissionRef = useRef(null);
  const profileRef      = useRef(voiceProfile);
  const analyserRef       = useRef(null);
  const analyserSourceRef = useRef(null);
  const micGainRef        = useRef(null);
  const sensitivityRef    = useRef(100);
  const isMutedRef        = useRef(false);
  const rxVolumeRef       = useRef(1.0);
  const meRef             = useRef(me);

  useEffect(() => { profileRef.current = voiceProfile; }, [voiceProfile]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => { meRef.current = me; }, [me]);

  const ensureMicAndChain = useCallback(async () => {
    if (filteredStreamRef.current) return filteredStreamRef.current;
    if (!hasUdp) return null;

    let stream = micStreamRef.current;
    if (!stream) {
      try {
        const audioConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        if (micDeviceIdRef.current) {
          audioConstraints.deviceId = { exact: micDeviceIdRef.current };
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false,
        });
        micStreamRef.current = stream;
        setMicGranted(true);
        setMicPermission('granted');
      } catch (err) {
        console.error('[RadioUDP] mic permission denied:', err);
        setMicPermission('denied');
        return null;
      }
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
    }
    try { getRadioChrome(ctx)?.setBand?.(srsBandRef.current); } catch {}
    try { await ensureCvsdWorkletLoaded(ctx); } catch {}

    if (!analyserRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const analyserSource = ctx.createMediaStreamSource(stream);
      analyserSource.connect(analyser);
      analyserRef.current = analyser;
      analyserSourceRef.current = analyserSource;
    }

    const source = ctx.createMediaStreamSource(stream);
    const micGain = ctx.createGain();
    micGain.gain.value = sensitivityRef.current / 100;
    source.connect(micGain);
    const chain = await buildSpacesuitChain(ctx, micGain, profileRef.current);
    filterChainRef.current = chain;
    micGainRef.current = micGain;

    const dest = ctx.createMediaStreamDestination();

    let srsOutput = chain.output;
    if (srsSpecRef.current?.txEffect && ctx) {
      try {
        const srs = buildSrsChain(ctx, srsSpecRef.current.txEffect);
        if (srs) {
          srsChainRef.current = srs;
          chain.output.connect(srs.input);
          srsOutput = srs.output;
        }
      } catch (err) {
        console.error('[RadioUDP] SRS chain build failed:', err);
      }
    }

    if (srsBandRef.current === 'FM') {
      const preEmphasis = ctx.createBiquadFilter();
      preEmphasis.type = 'highshelf';
      preEmphasis.frequency.value = 2122;
      preEmphasis.gain.value = 6;
      srsOutput.connect(preEmphasis);
      srsOutput = preEmphasis;
    }

    const outDelay = getOutboundDelay(ctx);
    let finalNode;
    if (outDelay) {
      srsOutput.connect(outDelay);
      outDelay.connect(dest);
      finalNode = outDelay;
    } else {
      srsOutput.connect(dest);
      finalNode = srsOutput;
    }
    filteredStreamRef.current = dest.stream;
    txFinalNodeRef.current    = finalNode;

    // Mute until PTT pressed (the UDP TX wrapper gates frames too, but
    // this keeps the destination silent for consistency with the WebRTC hook).
    for (const t of dest.stream.getAudioTracks()) t.enabled = false;

    return dest.stream;
  }, [hasUdp]);

  // Live-tune profile params on save.
  useEffect(() => {
    if (!filterChainRef.current) return;
    filterChainRef.current.setProfile(profileRef.current);
  }, [voiceProfileVersion]);

  // Mic device switch — tear down the chain + TX, rebuild from scratch.
  // Simpler than WebRTC's replaceTrack dance because the UDP TX is a plain
  // worklet consuming the new filtered stream.
  useEffect(() => {
    if (!filteredStreamRef.current) return;
    let cancelled = false;
    (async () => {
      try { await udpTxRef.current?.close?.(); } catch {}
      udpTxRef.current = null;

      try { filteredStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
      try { filterChainRef.current?.dispose(); } catch {}
      try { micGainRef.current?.disconnect(); } catch {}
      try { analyserSourceRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}

      filteredStreamRef.current = null;
      txFinalNodeRef.current    = null;
      filterChainRef.current    = null;
      micGainRef.current        = null;
      analyserRef.current       = null;
      analyserSourceRef.current = null;
      micStreamRef.current      = null;

      const newStream = await ensureMicAndChain();
      if (cancelled || !newStream) return;

      // Rebuild the TX wrapper, tapping the mic chain in its own ctx.
      try {
        udpTxRef.current = await createUdpVoiceTx({
          ctx: audioCtxRef.current,
          sourceNode: txFinalNodeRef.current,
        });
      } catch (err) {
        console.error('[RadioUDP] rebuild tx failed:', err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micDeviceId]);

  // Output device switch — forwarded to every peer <audio>.
  useEffect(() => {
    for (const audio of Object.values(peerAudiosRef.current)) {
      if (typeof audio.setSinkId === 'function') {
        audio.setSinkId(outputDeviceId || '').catch(() => {});
      }
    }
  }, [outputDeviceId]);

  // Permission state tracking.
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let permStatus = null;
    let cancelled = false;
    navigator.permissions.query({ name: 'microphone' }).then((p) => {
      if (cancelled) return;
      permStatus = p;
      setMicPermission(p.state);
      p.onchange = () => setMicPermission(p.state);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  const requestMicPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(t => t.stop());
      setMicPermission('granted');
      return true;
    } catch (err) {
      console.error('[RadioUDP] mic permission request denied:', err);
      setMicPermission('denied');
      return false;
    }
  }, []);

  // ── Peer RX wiring (UDP → <audio>) ───────────────────────────────────────
  // One <audio> element per sender userId. The RX wrapper hands us a fresh
  // MediaStream the first time a given userId transmits; we attach it and
  // debounce transmit indication off ~300 ms after frames stop.
  const onUdpPeer = useCallback(({ userId, stream }) => {
    if (peerAudiosRef.current[userId]) return;
    const audio = new Audio();
    audio.autoplay = true;
    // Quadratic response curve — audio.volume is linear amplitude, but
     // human loudness perception is roughly logarithmic, so a linear
     // slider felt WAY too hot at the low end (users reported having
     // to hold the slider around 10 % to not blow ears). Squaring the
     // slider value (0..1.5 input → 0..1 output after browser cap)
     // gives a gentle bottom end and keeps the top unchanged:
     //   slider 30 % → 0.09 volume (roughly matches old "10 %")
     //   slider 100 % → 1.0 volume (unity)
     //   slider 150 % → clips to 1.0 (same as 100 %)
    const rvQ = (rxVolumeRef.current ?? 1.0) ** 2;
    try { audio.volume = Math.max(0, Math.min(1, rvQ)); } catch {}
    try { audio.srcObject = stream; } catch {}
    if (outputDeviceIdRef.current && typeof audio.setSinkId === 'function') {
      audio.setSinkId(outputDeviceIdRef.current).catch(() => {});
    }
    audio.play().catch(() => {});
    peerAudiosRef.current[userId] = audio;
  }, []);

  // Poll the UDP RX stats so we can mark userIds as transmitting / idle.
  // Lightweight — the RX wrapper's stats() is a Map walk.
  useEffect(() => {
    if (!hasUdp) return;
    const id = setInterval(() => {
      const rx = udpRxRef.current;
      if (!rx) return;
      const stats = rx.stats();
      for (const [userId, s] of Object.entries(stats)) {
        if (s.idleMs < 150) {
          // Active transmit — mark + reset the silence timer.
          setTransmittingPeerIds(prev => {
            if (prev.includes(userId)) return prev;
            const next = [...prev, userId];
            transmittingPeerIdsRef.current = next;
            try {
              const rc = getRadioChrome(audioCtxRef.current);
              rc?.playKeyUp();
              rc?.setBedActive(true);
            } catch {}
            return next;
          });
          clearTimeout(peerSilenceTimersRef.current[userId]);
          peerSilenceTimersRef.current[userId] = setTimeout(() => {
            setTransmittingPeerIds(prev => {
              const next = prev.filter(x => x !== userId);
              transmittingPeerIdsRef.current = next;
              try {
                const rc = getRadioChrome(audioCtxRef.current);
                rc?.playKeyDown();
                if (next.length === 0 && !isPTTActive) rc?.setBedActive(false);
              } catch {}
              return next;
            });
          }, 300);
        }
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUdp]);

  const cleanupAllPeers = useCallback(() => {
    for (const [uid, a] of Object.entries(peerAudiosRef.current)) {
      try { a.pause(); } catch {}
      try { a.srcObject = null; } catch {}
      clearTimeout(peerSilenceTimersRef.current[uid]);
    }
    peerAudiosRef.current = {};
    peerSilenceTimersRef.current = {};
    setPeers([]);
    setTransmittingPeerIds([]);
    transmittingPeerIdsRef.current = [];
  }, []);

  // Per-peer RX DSP factory. FM de-emphasis is applied separately in
  // udpVoiceRx.js's buildPeerDsp when the sender's band === FM (carried
  // in the UDP header as senderBand).
  const buildRxEffectForListener = useCallback((ctx) => {
    const spec = srsSpecRef.current;
    if (spec?.rxEffect) {
      try {
        const chain = buildSrsChain(ctx, spec.rxEffect);
        if (chain) return chain;
      } catch (err) {
        console.error('[RadioUDP] buildSrsChain(rxEffect) failed:', err);
      }
    }
    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    g1.connect(g2);
    return {
      input: g1,
      output: g2,
      dispose() { try { g1.disconnect(); } catch {} try { g2.disconnect(); } catch {} },
    };
  }, []);

  const TUNE_LS_KEY = 'nexus_persisted_tune';

  const joinFrequency = useCallback(async (freq, missionId) => {
    if (!socket || !freq) return;
    if (!hasUdp) return;
    const f = String(freq).trim();
    if (!f) return;
    if (currentFreqRef.current) {
      socket.emit('radio:leave', { frequency: currentFreqRef.current, tunerId: 'right' });
      cleanupAllPeers();
    }
    const filtered = await ensureMicAndChain();
    currentFreqRef.current = f;
    currentMissionRef.current = missionId || null;
    setTunedFrequency(f);

    applyChannelColor(filterChainRef.current, profileRef.current, f);
    try { getRadioChrome(audioCtxRef.current)?.setChannel?.(f); } catch {}

    // Open the UDP session with the current page hostname as relay host.
    // Dashboard hydrates `me` via /auth/me and gets _id; Radio-only and
    // Companion read `me` from the JWT payload which only has `id`. Accept
    // either so the UDP session joins with a real userId and peers aren't
    // tracked as "anonymous" on view switches — that was the mode-switch
    // voice-silence bug (two peers with same body, different userIds →
    // new <audio> element → autoplay failed, old stream stayed muted).
    const meId = meRef.current?._id || meRef.current?.id || null;
    const userId = meId ? String(meId) : 'anonymous';
    try {
      const result = await window.electronAPI.udp.open({
        userId,
        freq: f,
        tunerId: 'right',
        host: deriveUdpHost(),
        port: UDP_PORT,
        senderBand: bandStringToByte(srsBandRef.current),
      });
      // 0.9.23+ main returns { ok, sessionId, ... }; older builds return
      // undefined. Falsy sessionId → close() falls back to today's
      // no-arg behavior, which stays compatible with pre-0.9.23 shells.
      udpSessionIdRef.current = result && result.sessionId ? result.sessionId : null;
    } catch (err) {
      console.error('[RadioUDP] udp.open failed:', err);
    }

    // Build (or rebuild) the TX wrapper. Shares the mic chain's ctx
    // and taps its final node directly — no cross-context MediaStream
    // hop, which is what silenced TX after view-switches on 0.9.26.
    if (filtered && audioCtxRef.current && txFinalNodeRef.current) {
      try {
        if (udpTxRef.current) { try { await udpTxRef.current.close(); } catch {} }
        udpTxRef.current = await createUdpVoiceTx({
          ctx: audioCtxRef.current,
          sourceNode: txFinalNodeRef.current,
        });
      } catch (err) {
        console.error('[RadioUDP] createUdpVoiceTx failed:', err);
      }
    }

    // Build the RX wrapper if we haven't already. The rxEffectBuilder
    // installs per-peer SRS DSP on the receive side — safe here because
    // UDP's PCM path doesn't go through MediaStreamSource (the Web Audio
    // bug that silenced the WebRTC listener graph).
    if (!udpRxRef.current && audioCtxRef.current) {
      try {
        udpRxRef.current = createUdpVoiceRx(audioCtxRef.current, onUdpPeer, {
          rxEffectBuilder: buildRxEffectForListener,
        });
      } catch (err) {
        console.error('[RadioUDP] createUdpVoiceRx failed:', err);
      }
    }

    // Start keepalive ping every 5 s so the relay keeps us in the room.
    clearInterval(keepaliveTimerRef.current);
    keepaliveTimerRef.current = setInterval(() => {
      try { window.electronAPI.udp.keepalive(); } catch {}
    }, 5000);

    socket.emit('radio:join', { frequency: f, missionId, tunerId: 'right' });
    try { new Audio('/sounds/freq_connect.mp3').play().catch(() => {}); } catch {}
    try {
      localStorage.setItem(TUNE_LS_KEY, JSON.stringify({
        freq: f, missionId: missionId || null, ts: Date.now(),
      }));
    } catch {}
  }, [socket, hasUdp, ensureMicAndChain, cleanupAllPeers, onUdpPeer]);

  // Auto-restore the last tuned frequency on mount. The save side at the
  // end of joinFrequency has been writing to localStorage all along, but
  // nothing was reading it back — so switching full ↔ companion ↔ radio
  // modes lost the frequency every time. Re-join when socket + spec + udp
  // are all ready, once. autoTunedRef guards against repeat rejoins while
  // the hook stays mounted but deps shuffle.
  const autoTunedRef = useRef(false);
  useEffect(() => {
    if (autoTunedRef.current) return;
    if (!socket || !hasUdp) return;
    if (currentFreqRef.current) return; // already tuned this session
    let saved = null;
    try {
      const raw = localStorage.getItem(TUNE_LS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    if (!saved || !saved.freq) return;
    autoTunedRef.current = true;
    // Schedule after a tick so the srsSpec effect at mount has a chance
    // to set the current rig's band byte before the first UDP open.
    const id = setTimeout(() => {
      try { joinFrequency(saved.freq, saved.missionId || null); } catch {}
    }, 150);
    return () => clearTimeout(id);
  }, [socket, hasUdp, joinFrequency]);

  const teardownAudioChain = useCallback(() => {
    try { filteredStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { filterChainRef.current?.dispose(); } catch {}
    try { micGainRef.current?.disconnect(); } catch {}
    try { analyserSourceRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
    try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { audioCtxRef.current?.close(); } catch {}

    filteredStreamRef.current  = null;
    txFinalNodeRef.current     = null;
    filterChainRef.current     = null;
    micGainRef.current         = null;
    analyserRef.current        = null;
    analyserSourceRef.current  = null;
    micStreamRef.current       = null;
    audioCtxRef.current        = null;
    setMicGranted(false);
  }, []);

  const leaveFrequency = useCallback(() => {
    if (currentFreqRef.current && socket) {
      socket.emit('radio:leave', { frequency: currentFreqRef.current, tunerId: 'right' });
      new Audio('/sounds/radio_disconnect.mp3').play().catch(() => {});
    }
    try { localStorage.removeItem(TUNE_LS_KEY); } catch {}

    clearInterval(keepaliveTimerRef.current);
    keepaliveTimerRef.current = null;
    // Capture the session id BEFORE the awaits + clear the ref. If a
    // joinFrequency re-enters this hook before the async cleanup
    // finishes, it will update udpSessionIdRef to the NEW session's id;
    // a late `close(udpSessionIdRef.current)` would then kill the new
    // session using its own id (defeating the stale-id check). Reading
    // the ref synchronously here freezes the id we're actually closing.
    const sid = udpSessionIdRef.current;
    udpSessionIdRef.current = null;
    (async () => {
      try { await udpTxRef.current?.close?.(); } catch {}
      udpTxRef.current = null;
      try { udpRxRef.current?.close?.(); } catch {}
      udpRxRef.current = null;
      try { if (hasUdp) await window.electronAPI.udp.close(sid); } catch {}
    })();

    cleanupAllPeers();
    teardownAudioChain();
    currentFreqRef.current = null;
    currentMissionRef.current = null;
    setTunedFrequency(null);
    setIsPTTActive(false);
  }, [socket, hasUdp, cleanupAllPeers, teardownAudioChain]);

  const startPTT = useCallback(() => {
    if (!currentFreqRef.current) return;
    if (!filteredStreamRef.current) return;
    if (isMutedRef.current) return;
    try {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {}
    setIsPTTActive(true);
    for (const t of filteredStreamRef.current.getAudioTracks()) t.enabled = true;
    try { udpTxRef.current?.start?.(); } catch {}
    if (filterChainRef.current) {
      try { filterChainRef.current.playClick('open'); } catch {}
    }
    try {
      const rc = getRadioChrome(audioCtxRef.current);
      rc.playKeyUp();
      rc.setBedActive(true);
      if (srsSpecRef.current?.encryptionEffect?.$type === 'cvsd') {
        try { new Audio('/sounds/radio/KY_58_TX.wav').play().catch(() => {}); } catch {}
      }
    } catch {}
    socket?.emit('radio:ptt-start', { frequency: currentFreqRef.current, tunerId: 'right' });
  }, [socket]);

  const stopPTT = useCallback(() => {
    if (!isPTTActive) return;
    try { udpTxRef.current?.stop?.(); } catch {}
    if (filterChainRef.current) {
      try { filterChainRef.current.playClick('close'); } catch {}
    }
    try {
      const rc = getRadioChrome(audioCtxRef.current);
      rc?.playKeyDown();
      if ((transmittingPeerIdsRef.current?.length ?? 0) === 0) {
        rc?.setBedActive(false);
      }
    } catch {}
    setTimeout(() => {
      if (filteredStreamRef.current) {
        for (const t of filteredStreamRef.current.getAudioTracks()) t.enabled = false;
      }
    }, 60);
    setIsPTTActive(false);
    if (socket && currentFreqRef.current) {
      socket.emit('radio:ptt-stop', { frequency: currentFreqRef.current, tunerId: 'right' });
    }
  }, [socket, isPTTActive]);

  const getInputLevel = useCallback(() => {
    const a = analyserRef.current;
    if (!a) return 0;
    const data = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;
    return Math.min(100, (avg / 255) * 150);
  }, []);

  const setMicSensitivity = useCallback((value) => {
    sensitivityRef.current = value;
    const gain = micGainRef.current;
    const ctx = audioCtxRef.current;
    if (!gain || !ctx || isMutedRef.current) return;
    gain.gain.setTargetAtTime(value / 100, ctx.currentTime, 0.01);
  }, []);

  const setRxVolume = useCallback((v) => {
    const clamped = Math.max(0, Math.min(1.5, Number(v) || 0));
    rxVolumeRef.current = clamped;
    for (const a of Object.values(peerAudiosRef.current)) {
      try { a.volume = Math.max(0, Math.min(1, clamped ** 2)); } catch {}
    }
  }, []);

  const setMuted = useCallback((muted) => {
    isMutedRef.current = muted;
    const gain = micGainRef.current;
    const ctx = audioCtxRef.current;
    if (!gain || !ctx) return;
    if (muted) {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    } else {
      gain.gain.setTargetAtTime(sensitivityRef.current / 100, ctx.currentTime, 0.01);
    }
  }, []);

  // ── Socket listeners — presence + PTT only ───────────────────────────────
  // Same room/event shape as the WebRTC hook; we just ignore offer/answer/ice.
  useEffect(() => {
    if (!socket) return;
    const forThisTuner = (p) => (p?.tunerId ?? 'right') === 'right';

    const onRoomPeers = ({ frequency, tunerId, peers: list }) => {
      if ((tunerId ?? 'right') !== 'right') return;
      if (frequency !== currentFreqRef.current) return;
      setPeers(Array.isArray(list) ? list : []);
    };

    const onPeerJoined = (peer) => {
      if (!forThisTuner(peer)) return;
      setPeers(prev => {
        // Dedupe by socketId first (idempotency).
        if (prev.some(p => p.socketId === peer.socketId)) return prev;
        // Dedupe by userId within this tuner: if the same user already
        // has an entry (stale socket from a crashed client or a
        // view-switch whose peer-left didn't arrive yet), replace it
        // with the fresh one. Crew and Command are separate hook
        // instances with separate peer lists, so a user legitimately
        // on both channels still appears in each.
        const otherSameUser = prev.findIndex(
          p => peer.userId && String(p.userId) === String(peer.userId)
        );
        if (otherSameUser >= 0) {
          const next = prev.slice();
          next[otherSameUser] = peer;
          return next;
        }
        return [...prev, peer];
      });
      new Audio('/sounds/freq_connect.mp3').play().catch(() => {});
    };

    const onPeerLeft = (payload) => {
      if (!forThisTuner(payload)) return;
      const { socketId, userId } = payload;
      if (socketId) {
        setPeers(prev => prev.filter(p => p.socketId !== socketId));
      } else {
        setPeers(prev => prev.filter(p => String(p.userId) !== String(userId)));
      }
      // Tear down the local <audio> for this userId if we have one.
      if (userId && peerAudiosRef.current[userId]) {
        try { peerAudiosRef.current[userId].pause(); } catch {}
        try { peerAudiosRef.current[userId].srcObject = null; } catch {}
        delete peerAudiosRef.current[userId];
        clearTimeout(peerSilenceTimersRef.current[userId]);
        delete peerSilenceTimersRef.current[userId];
      }
      new Audio('/sounds/freq_disconnect.mp3').play().catch(() => {});
    };

    const onPttStart = (payload) => {
      if (!forThisTuner(payload)) return;
      const { socketId, crypto } = payload;
      setTransmittingPeerIds(prev => {
        if (prev.includes(socketId)) return prev;
        const next = [...prev, socketId];
        transmittingPeerIdsRef.current = next;
        try {
          const rc = getRadioChrome(audioCtxRef.current);
          rc?.playKeyUp();
          rc?.setBedActive(true);
          if (crypto) {
            try { new Audio('/sounds/radio/KY_58_RX.wav').play().catch(() => {}); } catch {}
          }
        } catch {}
        return next;
      });
    };

    const COLLISION_SAMPLES = [
      '/sounds/radio/frq-collision.wav',
      '/sounds/radio/frq-collision2.wav',
      '/sounds/radio/frq-collision3.wav',
    ];
    let lastCollisionAt = 0;
    const onCollision = () => {
      const now = Date.now();
      if (now - lastCollisionAt < 400) return;
      lastCollisionAt = now;
      const url = COLLISION_SAMPLES[Math.floor(Math.random() * COLLISION_SAMPLES.length)];
      try { new Audio(url).play().catch(() => {}); } catch {}
    };

    const onPttStop = (payload) => {
      if (!forThisTuner(payload)) return;
      const { socketId } = payload;
      setTransmittingPeerIds(prev => {
        const next = prev.filter(id => id !== socketId);
        transmittingPeerIdsRef.current = next;
        try {
          const rc = getRadioChrome(audioCtxRef.current);
          rc?.playKeyDown();
          if (next.length === 0 && !isPTTActive) rc?.setBedActive(false);
        } catch {}
        return next;
      });
    };

    const onError = ({ message }) => {
      console.error('[RadioUDP] server error:', message);
    };

    // On socket reconnect, re-emit radio:join so the server reissues the
    // peer list. The UDP session is independent and remains open.
    const onConnect = () => {
      if (!currentFreqRef.current) return;
      socket.emit('radio:join', {
        frequency: currentFreqRef.current,
        missionId: currentMissionRef.current,
        tunerId: 'right',
      });
    };

    socket.on('radio:room-peers',    onRoomPeers);
    socket.on('radio:peer-joined',   onPeerJoined);
    socket.on('radio:peer-left',     onPeerLeft);
    socket.on('radio:ptt-start',     onPttStart);
    socket.on('radio:ptt-stop',      onPttStop);
    socket.on('radio:collision',     onCollision);
    socket.on('radio:error',         onError);
    socket.on('connect',             onConnect);

    return () => {
      socket.off('radio:room-peers',    onRoomPeers);
      socket.off('radio:peer-joined',   onPeerJoined);
      socket.off('radio:peer-left',     onPeerLeft);
      socket.off('radio:ptt-start',     onPttStart);
      socket.off('radio:ptt-stop',      onPttStop);
      socket.off('radio:collision',     onCollision);
      socket.off('radio:error',         onError);
      socket.off('connect',             onConnect);
    };
  }, [socket, isPTTActive]);

  // ── PTT keybinding ──────────────────────────────────────────────────────
  const pttDownRef = useRef(false);
  useEffect(() => {
    const isTypingTarget = (t) => t && (
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable ||
      (t.tagName === 'INPUT' && t.type !== 'range')
    );
    const keyLower = (pttKey || 'v').toLowerCase();

    const onKeyDown = (e) => {
      if (e.key.toLowerCase() !== keyLower) return;
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (!currentFreqRef.current) return;
      if (isMutedRef.current) return;
      pttDownRef.current = true;
      startPTT();
    };
    const onKeyUp = (e) => {
      if (e.key.toLowerCase() !== keyLower) return;
      if (!pttDownRef.current) return;
      pttDownRef.current = false;
      stopPTT();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    let unsubscribeIPC = null;
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.onPTT) {
        // Register under the 'right' tuner slot and filter incoming PTT
        // events by tunerId. Without this, Command's CapsLock fires Crew
        // too — both hooks share the same IPC channel.
        window.electronAPI.setPttKeys?.({ right: pttKey || 'v' });
        unsubscribeIPC = window.electronAPI.onPTT((payload) => {
          const { down, tunerId } = payload || {};
          if ((tunerId ?? 'right') !== 'right') return;
          if (!currentFreqRef.current) return;
          if (isMutedRef.current) return;
          if (down && !pttDownRef.current) {
            pttDownRef.current = true;
            startPTT();
          } else if (!down && pttDownRef.current) {
            pttDownRef.current = false;
            stopPTT();
          }
        });
      }
    } catch (err) {
      console.error('[RadioUDP] Electron PTT bridge failed:', err?.message);
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      try { unsubscribeIPC?.(); } catch {}
    };
  }, [startPTT, stopPTT, pttKey]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        if (socket && currentFreqRef.current) {
          socket.emit('radio:leave', { frequency: currentFreqRef.current, tunerId: 'right' });
        }
      } catch {}
      clearInterval(keepaliveTimerRef.current);
      // Same capture-before-await discipline as leaveFrequency. A
      // re-entrant joinFrequency during unmount would otherwise swap
      // the ref to the new session's id before this async close runs.
      const sid = udpSessionIdRef.current;
      udpSessionIdRef.current = null;
      (async () => {
        try { await udpTxRef.current?.close?.(); } catch {}
        try { udpRxRef.current?.close?.(); } catch {}
        try { if (hasUdp) await window.electronAPI.udp.close(sid); } catch {}
      })();
      for (const a of Object.values(peerAudiosRef.current)) {
        try { a.pause(); a.srcObject = null; } catch {}
      }
      try { filterChainRef.current?.dispose(); } catch {}
      try { micGainRef.current?.disconnect(); } catch {}
      try { analyserSourceRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
      try { audioCtxRef.current?.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spec setter — same semantics as the WebRTC hook. UDP tx carries the
  // freq/tuner/userId header, so when the radio changes we also push a
  // retune so the relay sees fresh header state.
  const setSrsRadioSpec = useCallback((spec) => {
    if (srsSpecRef.current === spec) return;
    const wasTuned = !!currentFreqRef.current;

    // If ensureMicAndChain already ran (user joined a freq) BEFORE the
    // spec resolved, the TX chain was built with no SRS stage — the
    // sender ships voice without any radio-tx character. Detect that
    // case so we can rebuild the chain below once the spec actually
    // arrives. (Brand-new users triggered this: useMyRadio fetch races
    // against joinFrequency and loses.)
    const txChainWasRaw = !!filteredStreamRef.current && !srsChainRef.current;

    srsSpecRef.current = spec || null;

    if (wasTuned) {
      try {
        if (hasUdp) {
          window.electronAPI.udp.retune({
            freq: currentFreqRef.current,
            senderBand: bandStringToByte(srsBandRef.current),
          });
        }
      } catch {}
      // Rebuild every peer's RX DSP so the new spec's rxEffect takes
      // effect immediately on the next incoming frame.
      try { udpRxRef.current?.rebuildAllPeerRxGraphs?.(); } catch {}

      // Rebuild the TX chain if it was built without an SRS stage.
      // Skip if PTT is held — don't glitch an in-flight transmission.
      if (txChainWasRaw && spec?.txEffect && !isPTTActive) {
        (async () => {
          try { await udpTxRef.current?.close?.(); } catch {}
          udpTxRef.current = null;
          try { filteredStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
          try { filterChainRef.current?.dispose?.(); } catch {}
          try { micGainRef.current?.disconnect?.(); } catch {}
          try { analyserSourceRef.current?.disconnect?.(); } catch {}
          try { analyserRef.current?.disconnect?.(); } catch {}
          try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
          filteredStreamRef.current = null;
      txFinalNodeRef.current    = null;
          filterChainRef.current    = null;
          micGainRef.current        = null;
          analyserRef.current       = null;
          analyserSourceRef.current = null;
          micStreamRef.current      = null;
          const next = await ensureMicAndChain();
          if (next && audioCtxRef.current && txFinalNodeRef.current) {
            try {
              udpTxRef.current = await createUdpVoiceTx({
                ctx: audioCtxRef.current,
                sourceNode: txFinalNodeRef.current,
              });
            }
            catch (err) { console.error('[RadioUDP] tx rebuild on spec arrival failed:', err); }
          }
        })();
      }
      return;
    }

    try { srsChainRef.current?.dispose?.(); } catch {}
    srsChainRef.current = null;
    try { filteredStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    filteredStreamRef.current = null;
      txFinalNodeRef.current    = null;
  }, [hasUdp, isPTTActive, ensureMicAndChain]);

  const setSrsRadioBand = useCallback((band) => {
    const ctx = audioCtxRef.current;
    srsBandRef.current = band || 'VHF';
    if (ctx) {
      try {
        const rc = getRadioChrome(ctx);
        rc?.setBand?.(band || 'VHF');
      } catch {}
    }
    if (hasUdp && currentFreqRef.current) {
      try { window.electronAPI.udp.retune({ senderBand: bandStringToByte(srsBandRef.current) }); } catch {}
    }
  }, [hasUdp]);

  return {
    tunedFrequency,
    peers,
    transmittingPeerIds,
    isPTTActive,
    micGranted,
    micPermission,
    requestMicPermission,
    joinFrequency,
    leaveFrequency,
    startPTT,
    stopPTT,
    getInputLevel,
    setMicSensitivity,
    setMuted,
    setRxVolume,
    setSrsRadioSpec,
    setSrsRadioBand,
  };
}
