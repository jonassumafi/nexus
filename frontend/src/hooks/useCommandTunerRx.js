// Command tuner — dual-radio implementation (Stages 3a + 3b, polished).
//
// Runs alongside the primary useRadioConnection hook. Shares the Socket.IO
// socket, uses tunerId='left' on every radio event so the server scopes
// rooms independently. Has its own AudioContext, mic stream, tx chain,
// peer mesh. Nothing shared with the primary radio.
//
// Sound parity with the primary radio:
//   • Peer joins frequency      → freq_connect.mp3
//   • Peer leaves frequency     → freq_disconnect.mp3
//   • I release my PTT          → radio_disconnect.mp3 (if that was my own untune)
//   • Key-up / key-down clicks  → via radioChrome, 'command' cue set
//   • My own TX on Command      → SELCAL chord → key-up click (self-cue)
//   • My own untune             → freq_disconnect.mp3
//
// SELCAL fires LOCAL only (my own transmit cue) — peers do NOT get a
// SELCAL on receive. This matches the user's spec: "the transmit sound
// for command" is the SELCAL. Receive clicks come through naturally
// from the sender's filter chain playClick in their outbound stream.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocketContext } from '../context/SocketContext';
import api from '../services/api';
import CUE_SETS from '../data/cueSets.json';
import { buildSpacesuitChain } from '../utils/spacesuitFilter';
import { buildSrsChain, ensureCvsdWorkletLoaded } from '../utils/srsChain';
import { getRadioChrome } from '../utils/radioChrome';

const TUNER_ID = 'left';
const COMMAND_CUE = CUE_SETS?.sets?.command || null;

// Command uses a double-ding pre-chirp so the channel is audibly more
// prominent than Crew (which uses a single click). The repeat is
// scheduled inside playPreChord using the cue set's repeat + gapMs
// fields — don't call playKeyUp twice from here or the two sequences
// overlap.
function playCommandKeyUp(rc) {
  try { rc?.playKeyUp(COMMAND_CUE); } catch {}
}
function playCommandKeyDown(rc) {
  try { rc?.playKeyDown(COMMAND_CUE); } catch {}
}

export function useCommandTunerRx(opts = {}) {
  const {
    voiceProfile,
    srsSpec,
    pttKey: externalPttKey,
    micDeviceId,
    outputDeviceId,
    locked = false,
    otherPttKey = null,  // the primary (Crew) radio's binding — for duplicate rejection
  } = opts;

  const { socket } = useSocketContext();

  const [tunedFrequency, setTunedFrequency]       = useState(null);
  const [peers, setPeers]                         = useState([]);
  const [transmittingPeerIds, setTransmittingIds] = useState([]);
  const [isPTTActive, setIsPTTActive]             = useState(false);
  const [bindError, setBindError]                 = useState(null);
  const [pttKey, setPttKey]                       = useState(() => {
    // Default to CapsLock — the original Command binding. Previous null
    // default left the Transmit button disabled on fresh installs.
    try { return localStorage.getItem('nexus_command_ptt_key') || 'CapsLock'; } catch { return 'CapsLock'; }
  });
  const [volume, setVolume] = useState(() => {
    try {
      const v = Number(localStorage.getItem('nexus_command_volume'));
      return Number.isFinite(v) && v >= 0 ? v : 1.0;
    } catch { return 1.0; }
  });
  const [pan, setPan] = useState(() => {
    try {
      const v = Number(localStorage.getItem('nexus_command_pan'));
      return Number.isFinite(v) ? Math.max(-0.6, Math.min(0.6, v)) : 0;
    } catch { return 0; }
  });
  const [micSensitivity, setMicSensitivity] = useState(() => {
    try {
      const v = Number(localStorage.getItem('nexus_command_mic_sensitivity'));
      return Number.isFinite(v) && v > 0 ? v : 100;
    } catch { return 100; }
  });

  const peerConnsRef    = useRef({});
  const peerAudiosRef   = useRef({});
  const peerPannersRef  = useRef({});
  const pendingIceRef   = useRef({});
  const currentFreqRef  = useRef(null);
  const turnCredsRef    = useRef(null);
  const pttDownRef      = useRef(false);
  const peersRef        = useRef([]);
  const lockedRef       = useRef(locked);
  const volumeRef         = useRef(volume);
  const panRef            = useRef(pan);
  const rxCtxRef          = useRef(null);
  const micSensitivityRef = useRef(micSensitivity);
  const micGainRef        = useRef(null);
  const analyserRef       = useRef(null);
  const analyserSourceRef = useRef(null);
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => {
    volumeRef.current = volume;
    try { localStorage.setItem('nexus_command_volume', String(volume)); } catch {}
    // Quadratic curve — see the ontrack handler below for the same math
    // + rationale. Slider 30 % ≈ old 10 %; 100 % = unity.
    const scaled = Math.max(0, Math.min(1, volume ** 2));
    for (const a of Object.values(peerAudiosRef.current)) {
      try { a.volume = scaled; } catch {}
    }
    // DSP-path peers get volume via their GainNode (their <audio> is muted).
    const ctx = audioCtxRef.current;
    for (const entry of Object.values(peerPannersRef.current)) {
      if (entry?.gain) {
        try {
          if (ctx) entry.gain.gain.setTargetAtTime(scaled, ctx.currentTime, 0.01);
          else entry.gain.gain.value = scaled;
        } catch {}
      }
    }
  }, [volume]);
  useEffect(() => {
    panRef.current = pan;
    try { localStorage.setItem('nexus_command_pan', String(pan)); } catch {}
    // Pan is deprecated — the new DSP-path peers don't carry a panner node.
    // Legacy raw StereoPanner entries (if any still exist) are updated here.
    for (const p of Object.values(peerPannersRef.current)) {
      try { if (p?.pan && !p.kind) p.pan.value = pan; } catch {}
    }
  }, [pan]);
  useEffect(() => {
    micSensitivityRef.current = micSensitivity;
    try { localStorage.setItem('nexus_command_mic_sensitivity', String(micSensitivity)); } catch {}
    // Live-update the active micGain so slider changes take effect
    // without needing to retune or restart the chain.
    try { if (micGainRef.current) micGainRef.current.gain.value = micSensitivity / 100; } catch {}
  }, [micSensitivity]);

  // Live-read mic input level for the MIC TRACK meter.
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

  // tx chain
  const audioCtxRef        = useRef(null);
  const micStreamRef       = useRef(null);
  const filterChainRef     = useRef(null);
  const srsChainRef        = useRef(null);
  const filteredStreamRef  = useRef(null);
  const profileRef         = useRef(voiceProfile);
  const specRef            = useRef(srsSpec);
  const effectivePttKey    = externalPttKey ?? pttKey;
  useEffect(() => { profileRef.current = voiceProfile; }, [voiceProfile]);
  useEffect(() => { specRef.current = srsSpec; }, [srsSpec]);

  // ── TURN creds ──────────────────────────────────────────────────────────
  const fetchTurnCreds = useCallback(async () => {
    if (turnCredsRef.current) return turnCredsRef.current;
    try {
      const { data } = await api.get('/radio/turn-credentials');
      turnCredsRef.current = data;
      return data;
    } catch { return null; }
  }, []);

  // ── Mic + tx chain ──────────────────────────────────────────────────────
  const ensureMicAndChain = useCallback(async () => {
    if (filteredStreamRef.current) return filteredStreamRef.current;
    let stream = micStreamRef.current;
    if (!stream) {
      try {
        const constraints = {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        };
        if (micDeviceId) constraints.deviceId = { exact: micDeviceId };
        stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
        micStreamRef.current = stream;
      } catch (err) {
        console.error('[CommandTuner] mic permission denied:', err);
        return null;
      }
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    // Pin to 48 kHz so cross-context MediaStream handoffs with the UDP
    // TX worklet don't hit Chromium's post-context-close silencing bug.
    // See the matching comment in useRadioConnectionUDP.ensureMicAndChain.
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx({ sampleRate: 48000 });
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
    try { await ensureCvsdWorkletLoaded(ctx); } catch {}

    const source = ctx.createMediaStreamSource(stream);
    const micGain = ctx.createGain();
    micGain.gain.value = (micSensitivityRef.current ?? 100) / 100;
    micGainRef.current = micGain;
    source.connect(micGain);
    // Pre-filter analyser so the MIC TRACK meter reflects true mic
    // activity regardless of filter settings. Its own source so chain
    // rebuilds don't disconnect it.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const analyserSource = ctx.createMediaStreamSource(stream);
    analyserSource.connect(analyser);
    analyserRef.current = analyser;
    analyserSourceRef.current = analyserSource;
    const chain = await buildSpacesuitChain(ctx, micGain, profileRef.current || {});
    filterChainRef.current = chain;

    const dest = ctx.createMediaStreamDestination();
    let srsOutput = chain.output;
    if (specRef.current?.txEffect) {
      try {
        const srs = buildSrsChain(ctx, specRef.current.txEffect);
        if (srs) {
          srsChainRef.current = srs;
          chain.output.connect(srs.input);
          srsOutput = srs.output;
        }
      } catch (err) {
        console.error('[CommandTuner] SRS chain build failed:', err);
      }
    }
    srsOutput.connect(dest);

    const outbound = dest.stream;
    for (const t of outbound.getAudioTracks()) t.enabled = false;
    filteredStreamRef.current = outbound;
    return outbound;
  }, [micDeviceId]);

  const teardownAudioChain = useCallback(() => {
    try { filteredStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { filterChainRef.current?.dispose(); } catch {}
    try { srsChainRef.current?.dispose?.(); } catch {}
    try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    // NOT closing audioCtxRef — see useRadioConnectionUDP's unmount
    // comment. Any close() poisons subsequent MediaStreamSource reads
    // in the page via a Chromium quirk, which was the voice-silent-
    // after-view-switch bug. Chromium reclaims the ctx when the page
    // unloads (view switch = renderer navigation = page unload).
    filteredStreamRef.current = null;
    filterChainRef.current = null;
    srsChainRef.current = null;
    micStreamRef.current = null;
    audioCtxRef.current = null;
  }, []);

  // ── Peer connection ─────────────────────────────────────────────────────
  const createPeerConnection = useCallback(async (peerSocketId) => {
    if (peerConnsRef.current[peerSocketId]) return peerConnsRef.current[peerSocketId];

    const turn = await fetchTurnCreds();
    const iceServers = turn?.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
    const pc = new RTCPeerConnection({ iceServers });
    peerConnsRef.current[peerSocketId] = pc;
    if (!pendingIceRef.current[peerSocketId]) pendingIceRef.current[peerSocketId] = [];

    // Our outbound track BEFORE wiring icecandidate so SDP includes it.
    const outbound = await ensureMicAndChain();
    if (outbound) {
      for (const t of outbound.getTracks()) {
        try { pc.addTrack(t, outbound); } catch (err) {
          console.error('[CommandTuner] addTrack failed', err);
        }
      }
    }

    pc.onicecandidate = (e) => {
      if (!e.candidate || !socket) return;
      socket.emit('radio:ice-candidate', {
        targetSocketId: peerSocketId, candidate: e.candidate, tunerId: TUNER_ID,
      });
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      const audio = new Audio();
      audio.autoplay = true;
      // Match useRadioConnectionUDP's quadratic curve: linear amplitude
      // × perceived-loudness mismatch made the slider feel way too hot
      // at the low end. Squaring gives slider 30 % ≈ old 10 %, 100 % = unity.
      // (Also removed the old 1.8× multiplier that silently maxed playback
      // above ~56 % of the slider range.)
      const vQ = (volumeRef.current ?? 1.0) ** 2;
      try { audio.volume = Math.max(0, Math.min(1, vQ)); } catch {}
      try { audio.srcObject = stream; } catch {}
      if (outputDeviceId && typeof audio.setSinkId === 'function') {
        audio.setSinkId(outputDeviceId).catch(() => {});
      }
      peerAudiosRef.current[peerSocketId] = audio;

      // Route through listener's own rxEffect when available — matches the
      // Crew hook's AudioContext.destination path (avoids the
      // MediaStreamSource→DSP→MediaStreamDestination silencing bug).
      // Graph: source → [rxChain] → Gain → ctx.destination
      const spec = specRef.current;
      const ctx = audioCtxRef.current;
      if (ctx && spec?.rxEffect) {
        try {
          const source = ctx.createMediaStreamSource(stream);
          const chain = buildSrsChain(ctx, spec.rxEffect);
          const gain = ctx.createGain();
          gain.gain.value = Math.max(0, Math.min(3, 1.8 * (volumeRef.current ?? 1.0)));
          if (chain) {
            source.connect(chain.input);
            chain.output.connect(gain);
          } else {
            source.connect(gain);
          }
          gain.connect(ctx.destination);
          peerPannersRef.current[peerSocketId] = { source, chain, gain, kind: 'dsp' };
          try { audio.muted = true; } catch {}
        } catch (err) {
          console.warn('[CommandTuner] rx DSP build failed, falling back to raw audio', err);
          try { audio.muted = false; } catch {}
        }
      }

      audio.play().catch(() => {});
    };

    return pc;
  }, [fetchTurnCreds, socket, ensureMicAndChain, outputDeviceId]);

  const drainPendingIce = useCallback(async (peerSocketId) => {
    const pc = peerConnsRef.current[peerSocketId];
    if (!pc) return;
    const q = pendingIceRef.current[peerSocketId] || [];
    for (const c of q) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
    pendingIceRef.current[peerSocketId] = [];
  }, []);

  const cleanupPeer = useCallback((peerSocketId) => {
    try { peerConnsRef.current[peerSocketId]?.close(); } catch {}
    delete peerConnsRef.current[peerSocketId];
    delete pendingIceRef.current[peerSocketId];
    try {
      const a = peerAudiosRef.current[peerSocketId];
      if (a) { a.pause(); a.srcObject = null; }
    } catch {}
    delete peerAudiosRef.current[peerSocketId];
    const g = peerPannersRef.current[peerSocketId];
    if (g) {
      try { g.source?.disconnect?.(); } catch {}
      try { g.chain?.input?.disconnect?.(); } catch {}
      try { g.chain?.output?.disconnect?.(); } catch {}
      try { g.chain?.dispose?.(); } catch {}
      try { g.gain?.disconnect?.(); } catch {}
      // Legacy: older entries were raw StereoPanner nodes.
      try { g.disconnect?.(); } catch {}
    }
    delete peerPannersRef.current[peerSocketId];
  }, []);

  const cleanupAllPeers = useCallback(() => {
    for (const sid of Object.keys(peerConnsRef.current)) cleanupPeer(sid);
    setPeers([]);
    setTransmittingIds([]);
  }, [cleanupPeer]);

  // ── Join / leave ────────────────────────────────────────────────────────
  const joinFrequency = useCallback(async (freq) => {
    if (!socket || !freq) return;
    if (lockedRef.current) return;
    const f = String(freq).trim();
    if (!f) return;
    if (currentFreqRef.current) {
      socket.emit('radio:leave', { frequency: currentFreqRef.current, tunerId: TUNER_ID });
      cleanupAllPeers();
    }
    await ensureMicAndChain();
    currentFreqRef.current = f;
    setTunedFrequency(f);
    socket.emit('radio:join', { frequency: f, tunerId: TUNER_ID });
    // Audible self-tune confirmation.
    try { new Audio('/sounds/freq_connect.mp3').play().catch(() => {}); } catch {}
    try { localStorage.setItem('nexus_command_tune', f); } catch {}
  }, [socket, cleanupAllPeers, ensureMicAndChain]);

  // Auto-restore the last tuned command frequency on mount. Save path
  // at the end of joinFrequency has been writing nexus_command_tune
  // all along; nothing was reading it, so mode switches dropped the
  // tune. Re-join once the socket is ready.
  const autoTunedRef = useRef(false);
  useEffect(() => {
    if (autoTunedRef.current) return;
    if (!socket) return;
    if (currentFreqRef.current) return;
    let f = null;
    try { f = localStorage.getItem('nexus_command_tune'); } catch {}
    if (!f) return;
    autoTunedRef.current = true;
    const id = setTimeout(() => { try { joinFrequency(f); } catch {} }, 150);
    return () => clearTimeout(id);
  }, [socket, joinFrequency]);

  const leaveFrequency = useCallback(() => {
    if (lockedRef.current) return;
    if (!socket || !currentFreqRef.current) return;
    socket.emit('radio:leave', { frequency: currentFreqRef.current, tunerId: TUNER_ID });
    try { new Audio('/sounds/radio_disconnect.mp3').play().catch(() => {}); } catch {}
    cleanupAllPeers();
    teardownAudioChain();
    currentFreqRef.current = null;
    setTunedFrequency(null);
    setIsPTTActive(false);
    try { localStorage.removeItem('nexus_command_tune'); } catch {}
  }, [socket, cleanupAllPeers, teardownAudioChain]);

  // ── PTT ─────────────────────────────────────────────────────────────────
  const startPTT = useCallback(() => {
    if (!currentFreqRef.current) return;
    if (!filteredStreamRef.current) return;
    try {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {}
    setIsPTTActive(true);
    for (const t of filteredStreamRef.current.getAudioTracks()) t.enabled = true;
    // Self-cue: SELCAL chord → key-up click + a LIGHT squelch bed. The
    // full Crew bed stacking caused doubled hiss in testing; this one
    // runs at 35% intensity so Command feels radio-ish on transmit
    // without competing with Crew's atmospheric bed when both are hot.
    try {
      const rc = getRadioChrome(audioCtxRef.current);
      playCommandKeyUp(rc);
      rc?.setBedActive(true, 0.35, 'command-tx');
    } catch {}
    if (filterChainRef.current) {
      try { filterChainRef.current.playClick?.('open'); } catch {}
    }
    socket?.emit('radio:ptt-start', { frequency: currentFreqRef.current, tunerId: TUNER_ID });
  }, [socket]);

  const stopPTT = useCallback(() => {
    if (!isPTTActive) return;
    if (filterChainRef.current) {
      try { filterChainRef.current.playClick?.('close'); } catch {}
    }
    try {
      const rc = getRadioChrome(audioCtxRef.current);
      playCommandKeyDown(rc);
      rc?.setBedActive(false, 0, 'command-tx');
    } catch {}
    setTimeout(() => {
      if (filteredStreamRef.current) {
        for (const t of filteredStreamRef.current.getAudioTracks()) t.enabled = false;
      }
    }, 60);
    setIsPTTActive(false);
    socket?.emit('radio:ptt-stop', { frequency: currentFreqRef.current, tunerId: TUNER_ID });
  }, [socket, isPTTActive, transmittingPeerIds]);

  // ── PTT binding setter with duplicate rejection ─────────────────────────
  const setPttKeyAndPersist = useCallback((newKey) => {
    setBindError(null);
    if (newKey && otherPttKey && String(newKey).toLowerCase() === String(otherPttKey).toLowerCase()) {
      setBindError('Already bound to the Crew radio');
      setTimeout(() => setBindError(null), 4000);
      return;
    }
    setPttKey(newKey);
    try {
      if (newKey) localStorage.setItem('nexus_command_ptt_key', newKey);
      else localStorage.removeItem('nexus_command_ptt_key');
    } catch {}
    try { window?.electronAPI?.setPttKeys?.({ left: newKey || null }); } catch {}
    api.put('/users/voice-profile', { command_ptt_key: newKey || null }).catch(() => {});
  }, [otherPttKey]);

  // Keep Electron hook in sync with the current binding on mount/change.
  useEffect(() => {
    try { window?.electronAPI?.setPttKeys?.({ left: effectivePttKey || null }); } catch {}
  }, [effectivePttKey]);

  // ── Socket wiring (tunerId filter) ──────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const matches = (p) => p?.tunerId === TUNER_ID;

    const onRoomPeers = async ({ frequency, tunerId, peers: list }) => {
      if (tunerId !== TUNER_ID) return;
      if (frequency !== currentFreqRef.current) return;
      setPeers(Array.isArray(list) ? list : []);
      for (const peer of (list || [])) {
        try {
          const pc = await createPeerConnection(peer.socketId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('radio:offer', {
            targetSocketId: peer.socketId, offer,
            frequency: currentFreqRef.current, tunerId: TUNER_ID,
          });
        } catch (err) {
          console.error('[CommandTuner] offer failed', err);
        }
      }
    };

    const onPeerJoined = (payload) => {
      if (!matches(payload)) return;
      setPeers(prev => prev.find(p => p.socketId === payload.socketId) ? prev : [...prev, {
        userId: payload.userId, citizenName: payload.citizenName, socketId: payload.socketId,
      }]);
      try { new Audio('/sounds/freq_connect.mp3').play().catch(() => {}); } catch {}
    };

    const onPeerLeft = (payload) => {
      if (!matches(payload)) return;
      cleanupPeer(payload.socketId);
      setPeers(prev => prev.filter(p => p.socketId !== payload.socketId));
      setTransmittingIds(prev => prev.filter(id => id !== payload.socketId));
      try { new Audio('/sounds/freq_disconnect.mp3').play().catch(() => {}); } catch {}
    };

    const onOffer = async (payload) => {
      if (!matches(payload)) return;
      try {
        const pc = await createPeerConnection(payload.fromSocketId);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
        await drainPendingIce(payload.fromSocketId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('radio:answer', {
          targetSocketId: payload.fromSocketId, answer, tunerId: TUNER_ID,
        });
        setPeers(prev => prev.find(p => p.socketId === payload.fromSocketId) ? prev : [...prev, {
          socketId: payload.fromSocketId,
          userId: payload.fromUserId,
          citizenName: payload.fromCitizenName,
        }]);
      } catch (err) {
        console.error('[CommandTuner] answer failed', err);
      }
    };

    const onAnswer = async (payload) => {
      if (!matches(payload)) return;
      const pc = peerConnsRef.current[payload.fromSocketId];
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
        await drainPendingIce(payload.fromSocketId);
      } catch (err) {
        console.error('[CommandTuner] setRemoteDescription answer failed', err);
      }
    };

    const onIce = async (payload) => {
      if (!matches(payload)) return;
      const pc = peerConnsRef.current[payload.fromSocketId];
      if (!pc) {
        // queue until the pc exists
        if (!pendingIceRef.current[payload.fromSocketId]) {
          pendingIceRef.current[payload.fromSocketId] = [];
        }
        pendingIceRef.current[payload.fromSocketId].push(payload.candidate);
        return;
      }
      if (!pc.remoteDescription) {
        pendingIceRef.current[payload.fromSocketId].push(payload.candidate);
        return;
      }
      try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch {}
    };

    const onPttStart = (payload) => {
      if (!matches(payload)) return;
      setTransmittingIds(prev => {
        if (prev.includes(payload.socketId)) return prev;
        // RX-side chime so listeners hear the same keyup click the
        // transmitter heard. Only fires on the FIRST peer going live
        // (0 → 1) so overlapping speakers don't stack clicks. Matches
        // the Crew UDP side's behavior at useRadioConnectionUDP.js's
        // receive handler.
        if (prev.length === 0 && !isPTTActive) {
          try {
            const ctx = audioCtxRef.current;
            // Chromium auto-suspends inactive contexts. Without this
            // resume the ding-ding goes to a frozen context and no
            // peer hears the incoming cue, even though the transmit
            // self-cue fired fine on the sender's side.
            if (ctx && ctx.state === 'suspended') {
              try { ctx.resume().catch(() => {}); } catch {}
            }
            const rc = getRadioChrome(ctx);
            playCommandKeyUp(rc);
          } catch {}
        }
        return [...prev, payload.socketId];
      });
      // No local bed on Command tuner — see startPTT for the reasoning.
    };

    const onPttStop = (payload) => {
      if (!matches(payload)) return;
      setTransmittingIds(prev => {
        const next = prev.filter(id => id !== payload.socketId);
        if (next.length === 0 && prev.length > 0 && !isPTTActive) {
          try {
            const rc = getRadioChrome(audioCtxRef.current);
            playCommandKeyDown(rc);
          } catch {}
        }
        return next;
      });
    };

    socket.on('radio:room-peers',    onRoomPeers);
    socket.on('radio:peer-joined',   onPeerJoined);
    socket.on('radio:peer-left',     onPeerLeft);
    socket.on('radio:offer',         onOffer);
    socket.on('radio:answer',        onAnswer);
    socket.on('radio:ice-candidate', onIce);
    socket.on('radio:ptt-start',     onPttStart);
    socket.on('radio:ptt-stop',      onPttStop);
    return () => {
      socket.off('radio:room-peers',    onRoomPeers);
      socket.off('radio:peer-joined',   onPeerJoined);
      socket.off('radio:peer-left',     onPeerLeft);
      socket.off('radio:offer',         onOffer);
      socket.off('radio:answer',        onAnswer);
      socket.off('radio:ice-candidate', onIce);
      socket.off('radio:ptt-start',     onPttStart);
      socket.off('radio:ptt-stop',      onPttStop);
    };
  }, [socket, createPeerConnection, cleanupPeer, drainPendingIce, transmittingPeerIds]);

  // ── Native hook + browser fallback for PTT ──────────────────────────────
  useEffect(() => {
    const key = effectivePttKey;
    if (!key) return;
    const electron = typeof window !== 'undefined' ? window.electronAPI : null;

    const keyLower = String(key).toLowerCase();
    const onDown = (e) => {
      if (e.repeat) return;
      if (e.key?.toLowerCase() !== keyLower) return;
      if (document.activeElement?.tagName === 'INPUT'
          || document.activeElement?.isContentEditable) return;
      if (!currentFreqRef.current) return;
      if (pttDownRef.current) return;
      pttDownRef.current = true;
      startPTT();
    };
    const onUp = (e) => {
      if (e.key?.toLowerCase() !== keyLower) return;
      if (!pttDownRef.current) return;
      pttDownRef.current = false;
      stopPTT();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);

    let unsubscribeIPC = null;
    try {
      if (electron?.onPTT) {
        unsubscribeIPC = electron.onPTT(({ down, tunerId }) => {
          if (tunerId !== TUNER_ID) return;
          if (!currentFreqRef.current) return;
          if (down && !pttDownRef.current) { pttDownRef.current = true; startPTT(); }
          else if (!down && pttDownRef.current) { pttDownRef.current = false; stopPTT(); }
        });
      }
    } catch {}

    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup',   onUp);
      try { unsubscribeIPC?.(); } catch {}
    };
  }, [effectivePttKey, startPTT, stopPTT]);

  // ── Safety stop on window blur/minimize ─────────────────────────────────
  // If the user alt-tabs away mid-PTT (e.g. a modal takes focus, or the
  // window loses focus for any OS reason), release the mic. Prevents a
  // stuck-open transmit that would broadcast background noise.
  useEffect(() => {
    const safeStop = () => {
      if (pttDownRef.current) {
        pttDownRef.current = false;
        stopPTT();
      }
    };
    window.addEventListener('blur', safeStop);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) safeStop();
    });
    return () => {
      window.removeEventListener('blur', safeStop);
    };
  }, [stopPTT]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => () => {
    try {
      if (socket && currentFreqRef.current) {
        socket.emit('radio:leave', { frequency: currentFreqRef.current, tunerId: TUNER_ID });
      }
    } catch {}
    cleanupAllPeers();
    teardownAudioChain();
  }, [socket, cleanupAllPeers, teardownAudioChain]);

  // ── Hydrate from backend on mount ───────────────────────────────────────
  // Backend persistence of Command tuner settings so bindings survive a
  // localStorage wipe or device swap. Loads once at mount; localStorage
  // remains the source of truth for live edits (backend sync is on PUT).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    api.get('/users/voice-profile').then(({ data }) => {
      if (!data) return;
      if (data.command_ptt_key && !pttKey) {
        setPttKey(data.command_ptt_key);
        try { localStorage.setItem('nexus_command_ptt_key', data.command_ptt_key); } catch {}
      }
      if (typeof data.command_volume === 'number') {
        setVolume(data.command_volume);
      }
      if (typeof data.command_pan === 'number') {
        setPan(data.command_pan);
      }
      // label / frequency / locked are driven by the UI's localStorage so
      // we don't clobber a stale backend value on first boot; the UI will
      // write them back on next change.
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push non-ptt_key changes to the backend. The PUT is already issued
  // from setPttKeyAndPersist above for ptt_key; here we debounce volume
  // and pan so the slider doesn't hammer the server.
  const volumeSaveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(volumeSaveTimer.current);
    volumeSaveTimer.current = setTimeout(() => {
      api.put('/users/voice-profile', { command_volume: volume }).catch(() => {});
    }, 400);
    return () => clearTimeout(volumeSaveTimer.current);
  }, [volume]);
  const panSaveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(panSaveTimer.current);
    panSaveTimer.current = setTimeout(() => {
      api.put('/users/voice-profile', { command_pan: pan }).catch(() => {});
    }, 400);
    return () => clearTimeout(panSaveTimer.current);
  }, [pan]);

  // Auto-rejoin on mount removed per operator request. Tuning requires an
  // explicit TUNE press on every view switch.

  return {
    tunedFrequency, peers, transmittingPeerIds, isPTTActive,
    joinFrequency, leaveFrequency, startPTT, stopPTT,
    pttKey: effectivePttKey, setPttKey: setPttKeyAndPersist,
    bindError,
    volume, setVolume,
    pan, setPan,
    micSensitivity, setMicSensitivity,
    getInputLevel,
  };
}
