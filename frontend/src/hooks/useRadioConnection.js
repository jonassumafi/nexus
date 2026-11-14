import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocketContext } from '../context/SocketContext';
import api from '../services/api';
import { buildSpacesuitChain } from '../utils/spacesuitFilter';
import { getRadioChrome, getOutboundDelay, channelColor } from '../utils/radioChrome';
import { buildSrsChain, ensureCvsdWorkletLoaded } from '../utils/srsChain';

// Apply a per-frequency color on top of the operator's base profile.
// Idempotent — safe to call every time the freq changes or chain rebuilds.
function applyChannelColor(chain, baseProfile, freqString) {
  if (!chain || !baseProfile) return;
  const c = channelColor(freqString);
  chain.setParam('highpass',       (baseProfile.highpass       ?? 300)  + c.highpass_delta);
  chain.setParam('lowpass',        (baseProfile.lowpass        ?? 3200) + c.lowpass_delta);
  chain.setParam('resonance_freq', (baseProfile.resonance_freq ?? 1500) + c.resonance_freq_delta);
  chain.setParam('resonance_q',    (baseProfile.resonance_q    ?? 3)    + c.resonance_q_delta);
  chain.setParam('bit_crush',      (baseProfile.bit_crush      ?? 16)   + c.bit_crush_delta);
}

// Single hook that wires Socket.IO radio signaling, WebRTC mesh, and a
// spacesuit-filtered local mic stream. Returns the state RadioPanel needs
// plus join/leave/PTT methods.

export function useRadioConnection({
  voiceProfile,
  voiceProfileVersion = 0,
  pttKey = 'v',
  micDeviceId = null,
  outputDeviceId = null,
}) {
  const { socket } = useSocketContext();

  const [tunedFrequency, setTunedFrequency] = useState(null);
  const [peers, setPeers] = useState([]);
  const [transmittingPeerIds, setTransmittingPeerIds] = useState([]);
  // Mirror of the state above, read synchronously from stopPTT/peer handlers
  // to decide whether to drop the squelch bed.
  const transmittingPeerIdsRef = useRef([]);
  const [isPTTActive, setIsPTTActive] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  // Coarse-grained browser-level mic permission state so the panel can nudge
  // the operator when the prompt was missed or denied. 'unknown' means the
  // Permissions API isn't available (Safari) — treat it as neutral.
  const [micPermission, setMicPermission] = useState('unknown');

  const micDeviceIdRef    = useRef(micDeviceId);
  const outputDeviceIdRef = useRef(outputDeviceId);
  useEffect(() => { micDeviceIdRef.current = micDeviceId; }, [micDeviceId]);
  useEffect(() => { outputDeviceIdRef.current = outputDeviceId; }, [outputDeviceId]);

  const peerConnsRef    = useRef({});  // socketId -> RTCPeerConnection
  const peerConnPromisesRef = useRef({});  // socketId -> in-flight createPeerConnection promise
  const pendingCandidatesRef = useRef({}); // socketId -> [RTCIceCandidateInit, ...] queued until remoteDescription is set
  const peerAudiosRef   = useRef({});  // socketId -> HTMLAudioElement
  const peerStreamsRef  = useRef({});  // socketId -> raw incoming MediaStream
  const peerRxNodesRef  = useRef({});  // socketId -> { source, chain, dest } (DSP graph)
  const peersRef        = useRef([]);  // mirror of peers state for cleanup
  const audioCtxRef     = useRef(null);
  const micStreamRef    = useRef(null);
  const filterChainRef  = useRef(null);
  const srsChainRef     = useRef(null);    // GPL: SRS DSP preset applied after voice profile
  const srsSpecRef      = useRef(null);    // the current radio spec being used
  const srsBandRef      = useRef('VHF');   // bed band (UHF/VHF/HF/FM) for radioChrome
  const filteredStreamRef = useRef(null);  // MediaStream sent to peers
  const turnCredsRef    = useRef(null);
  const currentFreqRef  = useRef(null);
  const currentMissionRef = useRef(null);
  const profileRef      = useRef(voiceProfile);
  // Pre-filter analyser so the input level meter reflects true mic activity
  // regardless of filter settings. Its own source node so chain rebuilds
  // (on profile change) don't disconnect it.
  const analyserRef       = useRef(null);
  const analyserSourceRef = useRef(null);
  const micGainRef        = useRef(null);
  const sensitivityRef    = useRef(100);
  const isMutedRef        = useRef(false);
  // Receive-volume multiplier on top of the baked 1.8× playback boost.
  // 1.0 = unchanged (1.8× effective). Driven by the shared RX slider in
  // the Mic Strip; applied to every peer <audio> element.
  const rxVolumeRef       = useRef(1.0);

  useEffect(() => { profileRef.current = voiceProfile; }, [voiceProfile]);
  useEffect(() => { peersRef.current = peers; }, [peers]);

  const fetchTurnCreds = useCallback(async () => {
    if (turnCredsRef.current) return turnCredsRef.current;
    try {
      const { data } = await api.get('/radio/turn-credentials');
      turnCredsRef.current = data;
      return data;
    } catch {
      return null;
    }
  }, []);

  const ensureMicAndChain = useCallback(async () => {
    if (filteredStreamRef.current) return filteredStreamRef.current;

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
        console.error('[Radio] mic permission denied:', err);
        setMicPermission('denied');
        return null;
      }
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    // Pin to 48 kHz for parity with the UDP TX worklet's 48 kHz
    // context. Avoids Chromium's cross-context silencing bug after
    // view switches close prior AudioContexts in this page.
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new Ctx({ sampleRate: 48000 }); }
      catch { audioCtxRef.current = new Ctx(); }
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
    }
    // Apply any band that was stashed by setSrsRadioBand before ctx existed.
    try { getRadioChrome(ctx)?.setBand?.(srsBandRef.current); } catch {}
    // Preload the CVSD vocoder worklet so cvsd-equipped SRS presets
    // (ARC-201D "DX-201 Secure", KR-1A "Jadro") get the real adaptive
    // delta-modulation vocoder instead of the bitcrush fallback. Awaited
    // here so the first chain build (just below) can synchronously
    // instantiate AudioWorkletNodes.
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

    // Insert the SRS radio-model DSP chain between the personal voice
    // profile and the outbound delay. The spec was pre-fetched by the
    // consumer and stashed in srsSpecRef — if it's absent (user hasn't
    // been assigned yet, or fetch failed), we skip SRS cleanly.
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
        console.error('[Radio] SRS chain build failed:', err);
      }
    }

    // FM pre-emphasis — if MY rig is on the FM band, boost highs on
    // outbound. Pairs with the matching de-emphasis the listener's FM
    // receiver applies on rx (see attachPeerRxGraph). Non-FM rigs skip.
    if (srsBandRef.current === 'FM') {
      const preEmphasis = ctx.createBiquadFilter();
      preEmphasis.type = 'highshelf';
      preEmphasis.frequency.value = 2122;  // 75 µs time constant
      preEmphasis.gain.value = 6;
      srsOutput.connect(preEmphasis);
      srsOutput = preEmphasis;
    }

    // 80 ms outbound delay (DCS pre-click feel) between the voice chain
    // and the peer destination.
    const outDelay = getOutboundDelay(ctx);
    if (outDelay) {
      srsOutput.connect(outDelay);
      outDelay.connect(dest);
    } else {
      srsOutput.connect(dest);
    }
    filteredStreamRef.current = dest.stream;

    // Mute until PTT pressed
    for (const t of dest.stream.getAudioTracks()) t.enabled = false;

    return dest.stream;
  }, []);

  // Apply saved profile changes in place — no chain rebuild, no destination
  // swap, no RTCRtpSender track replacement. The existing filter nodes have
  // their parameters tuned via setTargetAtTime (and the distortion curve
  // regenerated if it actually changed). PTT press/release stays instant.
  useEffect(() => {
    if (!filterChainRef.current) return;
    filterChainRef.current.setProfile(profileRef.current);
  }, [voiceProfileVersion]);

  // ── Input device switch ─────────────────────────────────────────────────
  // When the operator picks a different mic in Settings, tear down the mic
  // + filter chain (keeping the AudioContext alive), rebuild with the new
  // deviceId, then replaceTrack() on every peer connection so the far side
  // keeps receiving without a full ICE renegotiation. Skips work if no chain
  // has been built yet (initial mount / not yet tuned).
  useEffect(() => {
    if (!filteredStreamRef.current) return;
    let cancelled = false;
    (async () => {
      try { filteredStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
      try { filterChainRef.current?.dispose(); } catch {}
      try { micGainRef.current?.disconnect(); } catch {}
      try { analyserSourceRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}

      filteredStreamRef.current = null;
      filterChainRef.current    = null;
      micGainRef.current        = null;
      analyserRef.current       = null;
      analyserSourceRef.current = null;
      micStreamRef.current      = null;

      const newStream = await ensureMicAndChain();
      if (cancelled || !newStream) return;

      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      for (const pc of Object.values(peerConnsRef.current)) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) {
          try { await sender.replaceTrack(newTrack); }
          catch (err) { console.error('[Radio] replaceTrack failed:', err); }
        }
      }
    })();
    return () => { cancelled = true; };
    // ensureMicAndChain is intentionally omitted — its identity changes on
    // every render and we only want to fire on deviceId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micDeviceId]);

  // ── Output device switch ────────────────────────────────────────────────
  // Chromium supports setSinkId directly on the <audio> element. Firefox
  // requires media.setsinkid.enabled; Safari doesn't support it at all.
  // Failures are silently swallowed — the fallback is the OS default output.
  useEffect(() => {
    for (const audio of Object.values(peerAudiosRef.current)) {
      if (typeof audio.setSinkId === 'function') {
        audio.setSinkId(outputDeviceId || '').catch(() => {});
      }
    }
  }, [outputDeviceId]);

  // ── Mic permission tracking ─────────────────────────────────────────────
  // Uses the Permissions API where available so the panel can render an
  // affordance ("GRANT MIC ACCESS") when the browser prompt was missed.
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
      // Release immediately — the real chain builds its own stream with the
      // preferred deviceId + constraints via ensureMicAndChain when tuning.
      stream.getTracks().forEach(t => t.stop());
      setMicPermission('granted');
      return true;
    } catch (err) {
      console.error('[Radio] mic permission request denied:', err);
      setMicPermission('denied');
      return false;
    }
  }, []);

  const createPeerConnection = useCallback(async (peerSocketId) => {
    if (peerConnsRef.current[peerSocketId]) return peerConnsRef.current[peerSocketId];
    if (peerConnPromisesRef.current[peerSocketId]) return peerConnPromisesRef.current[peerSocketId];

    const promise = (async () => {
      const creds = await fetchTurnCreds();
      const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
      if (creds) {
        iceServers.push({
          urls: creds.urls,
          username: creds.username,
          credential: creds.credential,
        });
      }

      const pc = new RTCPeerConnection({ iceServers });
      peerConnsRef.current[peerSocketId] = pc;
      if (!pendingCandidatesRef.current[peerSocketId]) {
        pendingCandidatesRef.current[peerSocketId] = [];
      }

      const filtered = await ensureMicAndChain();
      if (filtered) {
        for (const track of filtered.getTracks()) {
          try { pc.addTrack(track, filtered); } catch {}
        }
      }

      pc.onicecandidate = (e) => {
        if (!e.candidate || !socket) return;
        socket.emit('radio:ice-candidate', {
          targetSocketId: peerSocketId,
          candidate: e.candidate,
          tunerId: 'right',
        });
      };

      pc.ontrack = (e) => {
        const stream = e.streams[0];
        peerStreamsRef.current[peerSocketId] = stream;

        const audio = new Audio();
        audio.autoplay = true;
        // Listener-side playback boost — raises perceived voice loudness
        // without touching the signal path or SRS character shaping.
        try { audio.volume = Math.max(0, Math.min(3, 1.8 * (rxVolumeRef.current ?? 1.0))); } catch {}
        peerAudiosRef.current[peerSocketId] = audio;

        // Wire the stream through the listener's own SRS rxEffect if we
        // have one AND an AudioContext is already live. Falls back to
        // direct playback if either prerequisite isn't met — restoring
        // the pre-rx behavior with zero functional regression.
        attachPeerRxGraph(peerSocketId, stream, audio);

        if (outputDeviceIdRef.current && typeof audio.setSinkId === 'function') {
          audio.setSinkId(outputDeviceIdRef.current).catch((err) => {
            console.error('[Radio] setSinkId failed:', err);
          });
        }
        audio.play().catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'failed' || st === 'closed') {
          cleanupPeer(peerSocketId);
        }
      };

      return pc;
    })();

    peerConnPromisesRef.current[peerSocketId] = promise;
    try {
      return await promise;
    } finally {
      delete peerConnPromisesRef.current[peerSocketId];
    }
  }, [fetchTurnCreds, ensureMicAndChain, socket]);

  const drainPendingCandidates = useCallback(async (peerSocketId) => {
    const pc = peerConnsRef.current[peerSocketId];
    if (!pc) return;
    const queue = pendingCandidatesRef.current[peerSocketId] || [];
    pendingCandidatesRef.current[peerSocketId] = [];
    for (const c of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.error('[Radio] addIceCandidate (drained) failed:', err);
      }
    }
  }, []);

  // Per-peer RX DSP via AudioContext.destination (the direct-output route
  // that avoids the MediaStreamSource → DSP → MediaStreamDestination →
  // <audio>.srcObject silencing bug). The <audio> element path is still
  // used as fallback when no rxEffect spec is available.
  //
  // Graph: MediaStreamSource → [rxChain] → Gain → audioCtx.destination
  const attachPeerRxGraph = useCallback((peerSocketId, stream, audio) => {
    detachPeerRxGraph(peerSocketId);
    const ctx = audioCtxRef.current;
    const spec = srsSpecRef.current;
    if (!ctx || !spec?.rxEffect) {
      // Fallback — direct <audio> playback.
      try { audio.srcObject = stream; } catch {}
      return;
    }
    try {
      const source = ctx.createMediaStreamSource(stream);
      const chain = buildSrsChain(ctx, spec.rxEffect);
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(3, 1.8 * (rxVolumeRef.current ?? 1.0)));
      if (chain) {
        source.connect(chain.input);
        chain.output.connect(gain);
      } else {
        source.connect(gain);
      }
      gain.connect(ctx.destination);
      // Mute the <audio> element so we only hear the DSP'd copy. Keeping
      // the element around also lets setSinkId still route to a chosen
      // output on hosts that support it; the AudioContext's own output
      // follows the OS default device.
      try { audio.muted = true; audio.srcObject = stream; } catch {}
      peerRxNodesRef.current[peerSocketId] = { source, chain, gain };
    } catch (err) {
      console.error('[Radio] rx DSP build failed, falling back to raw:', err);
      try { audio.muted = false; audio.srcObject = stream; } catch {}
    }
  }, []);

  const detachPeerRxGraph = useCallback((peerSocketId) => {
    const graph = peerRxNodesRef.current[peerSocketId];
    if (!graph) return;
    try { graph.source?.disconnect(); } catch {}
    try { graph.chain?.input?.disconnect?.(); } catch {}
    try { graph.chain?.output?.disconnect?.(); } catch {}
    try { graph.chain?.dispose?.(); } catch {}
    try { graph.gain?.disconnect(); } catch {}
    delete peerRxNodesRef.current[peerSocketId];
  }, []);

  // Rebuild every active peer's rx graph. Called when the listener's
  // SRS spec changes (admin reassign, player re-roll, initial load that
  // happened after peers were already connected).
  const rebuildAllPeerRxGraphs = useCallback(() => {
    for (const [peerSocketId, stream] of Object.entries(peerStreamsRef.current)) {
      const audio = peerAudiosRef.current[peerSocketId];
      if (!audio) continue;
      attachPeerRxGraph(peerSocketId, stream, audio);
    }
  }, [attachPeerRxGraph]);

  const cleanupPeer = useCallback((peerSocketId) => {
    const pc = peerConnsRef.current[peerSocketId];
    if (pc) { try { pc.close(); } catch {} }
    delete peerConnsRef.current[peerSocketId];
    delete peerConnPromisesRef.current[peerSocketId];
    delete pendingCandidatesRef.current[peerSocketId];

    detachPeerRxGraph(peerSocketId);
    delete peerStreamsRef.current[peerSocketId];

    const a = peerAudiosRef.current[peerSocketId];
    if (a) {
      try { a.pause(); } catch {}
      try { a.srcObject = null; } catch {}
    }
    delete peerAudiosRef.current[peerSocketId];

    setTransmittingPeerIds(prev => prev.filter(id => id !== peerSocketId));
  }, [detachPeerRxGraph]);

  const cleanupAllPeers = useCallback(() => {
    for (const sid of Object.keys(peerConnsRef.current)) cleanupPeer(sid);
    peerConnPromisesRef.current = {};
    pendingCandidatesRef.current = {};
    setPeers([]);
    setTransmittingPeerIds([]);
  }, [cleanupPeer]);

  // Keys for persisting the tuned frequency across mode switches. Electron
  // reloads the frontend URL when switching full/companion/radio, which
  // blows away in-memory state. Reading this on mount lets the hook
  // auto-rejoin without the operator retuning.
  const TUNE_LS_KEY = 'nexus_persisted_tune';

  const joinFrequency = useCallback(async (freq, missionId) => {
    if (!socket || !freq) return;
    const f = String(freq).trim();
    if (!f) return;
    // Tear down any prior session.
    if (currentFreqRef.current) {
      socket.emit('radio:leave', { frequency: currentFreqRef.current, tunerId: 'right' });
      cleanupAllPeers();
    }
    await ensureMicAndChain();
    currentFreqRef.current = f;
    currentMissionRef.current = missionId || null;
    setTunedFrequency(f);
    // Per-channel radio coloration — apply a deterministic offset to the
    // outbound filter chain so each frequency sounds like a slightly
    // different radio. Peers on freq 128.4 all hear me with that color;
    // peers on 212.0 hear me with a different one. Base profile is still
    // the operator's own voice profile — this just stacks a small, stable
    // channel delta on top.
    applyChannelColor(filterChainRef.current, profileRef.current, f);
    // Per-channel squelch bed profile (brick-wall cutoff + optional AM fade).
    try { getRadioChrome(audioCtxRef.current)?.setChannel?.(f); } catch {}
    socket.emit('radio:join', { frequency: f, missionId, tunerId: 'right' });
    // Audible self-tune confirmation so the operator KNOWS they're on
    // the frequency. Separate from freq_connect.mp3 which only fires
    // when PEERS join the room; this fires when WE successfully tune.
    try { new Audio('/sounds/freq_connect.mp3').play().catch(() => {}); } catch {}
    try {
      localStorage.setItem(TUNE_LS_KEY, JSON.stringify({
        freq: f, missionId: missionId || null, ts: Date.now(),
      }));
    } catch {}
  }, [socket, ensureMicAndChain, cleanupAllPeers]);

  // Auto-restore saved frequency on mount (mode switches used to drop it).
  const autoTunedRef = useRef(false);
  useEffect(() => {
    if (autoTunedRef.current) return;
    if (!socket) return;
    if (currentFreqRef.current) return;
    let saved = null;
    try {
      const raw = localStorage.getItem(TUNE_LS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    if (!saved || !saved.freq) return;
    autoTunedRef.current = true;
    const id = setTimeout(() => {
      try { joinFrequency(saved.freq, saved.missionId || null); } catch {}
    }, 150);
    return () => clearTimeout(id);
  }, [socket, joinFrequency]);

  const teardownAudioChain = useCallback(() => {
    // Stop the outgoing (filtered) stream tracks so any RTCRtpSender
    // already holding them sees ended tracks.
    try {
      filteredStreamRef.current?.getTracks().forEach(t => t.stop());
    } catch {}
    try { filterChainRef.current?.dispose(); } catch {}
    try { micGainRef.current?.disconnect(); } catch {}
    try { analyserSourceRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
    // Stop the raw mic tracks — this is what releases the browser's
    // mic-in-use indicator.
    try {
      micStreamRef.current?.getTracks().forEach(t => t.stop());
    } catch {}
    // NOT closing audioCtxRef — Chromium silences subsequent
    // MediaStreamSource reads in a page that previously had an
    // AudioContext closed. Nulling the ref is enough to force
    // ensureMicAndChain to build a fresh ctx on next call; the
    // old ctx lingers until page unload without poisoning anything.

    filteredStreamRef.current  = null;
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
    // Explicit leave = user intent to stop; clear the persisted tune so
    // subsequent mode switches don't auto-rejoin.
    try { localStorage.removeItem(TUNE_LS_KEY); } catch {}
    cleanupAllPeers();
    teardownAudioChain();
    currentFreqRef.current = null;
    currentMissionRef.current = null;
    setTunedFrequency(null);
    setIsPTTActive(false);
  }, [socket, cleanupAllPeers, teardownAudioChain]);

  const startPTT = useCallback(() => {
    if (!currentFreqRef.current) return;
    if (!filteredStreamRef.current) return;
    if (isMutedRef.current) return;
    // Defensive AudioContext resume. If the Electron window has been
    // backgrounded (user alt-tabbed to Star Citizen), Chromium can
    // suspend the AudioContext. Even with `backgroundThrottling: false`
    // set on the webContents, some codepaths still land in suspended
    // state. Calling resume() here is cheap when already running and
    // crucial when it's not — without it, the mic track gets enabled
    // but no audio flows through the filter chain to the peer.
    try {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {}
    setIsPTTActive(true);
    for (const t of filteredStreamRef.current.getAudioTracks()) t.enabled = true;
    if (filterChainRef.current) {
      try { filterChainRef.current.playClick('open'); } catch {}
    }
    // Local radio-chrome cue — synthesized "key up" click + squelch bed
    // fade in. Replaces the old transmitting.mp3 which the user noted
    // was the wrong source. Peers still hear my mic open via the filter
    // chain's playClick (mixed into the outbound stream above).
    try {
      const rc = getRadioChrome(audioCtxRef.current);
      rc.playKeyUp();
      // Match Command's light-bed intensity so both tuners hiss at the
      // same subtle level and neither drowns the other out.
      rc.setBedActive(true, 0.35);
      // KY-58 TX preamble when YOUR rig is crypto-tagged.
      if (srsSpecRef.current?.encryptionEffect?.$type === 'cvsd') {
        try { new Audio('/sounds/radio/KY_58_TX.wav').play().catch(() => {}); } catch {}
      }
    } catch {}
    socket?.emit('radio:ptt-start', { frequency: currentFreqRef.current, tunerId: 'right' });
  }, [socket]);

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
    const scaled = Math.max(0, Math.min(3, 1.8 * clamped));
    for (const a of Object.values(peerAudiosRef.current)) {
      try { a.volume = scaled; } catch {}
    }
    // Drive the DSP-path gain nodes too — peers routed through the
    // AudioContext.destination path get volume via their GainNode, not the
    // muted <audio> element.
    const ctx = audioCtxRef.current;
    for (const graph of Object.values(peerRxNodesRef.current)) {
      if (graph?.gain) {
        try {
          if (ctx) graph.gain.gain.setTargetAtTime(scaled, ctx.currentTime, 0.01);
          else graph.gain.gain.value = scaled;
        } catch {}
      }
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

  const stopPTT = useCallback(() => {
    // Strict guard — only run the close-click + bed-off path if PTT was
    // genuinely active. The old loose guard fired on every onMouseLeave
    // over the Transmit button, producing phantom click sounds on hover.
    if (!isPTTActive) return;
    if (filterChainRef.current) {
      try { filterChainRef.current.playClick('close'); } catch {}
    }
    // Local key-down cue — synthesized tail click + hiss. Bed stays on
    // if any peer is still transmitting; otherwise it fades out.
    try {
      const rc = getRadioChrome(audioCtxRef.current);
      rc?.playKeyDown();
      if ((transmittingPeerIdsRef.current?.length ?? 0) === 0) {
        rc?.setBedActive(false);
      }
    } catch {}
    // Tiny delay before muting so the close click is included in the stream.
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

  // ── Socket listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    // This hook is the Crew (right) tuner. The Command tuner (useCommandTunerRx)
    // shares the same socket, so every radio event is delivered to both hooks.
    // Drop anything scoped to the Command (left) tuner; server defaults missing
    // tunerId to 'right' for legacy single-radio callers, which we also accept.
    const forThisTuner = (p) => (p?.tunerId ?? 'right') === 'right';

    const onRoomPeers = async ({ frequency, tunerId, peers: list }) => {
      if ((tunerId ?? 'right') !== 'right') return;
      if (frequency !== currentFreqRef.current) return;
      setPeers(Array.isArray(list) ? list : []);
      // Initiate offers to all existing peers (full-mesh).
      for (const peer of (list || [])) {
        try {
          const pc = await createPeerConnection(peer.socketId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('radio:offer', {
            targetSocketId: peer.socketId,
            offer,
            frequency: currentFreqRef.current,
            tunerId: 'right',
          });
        } catch (err) {
          console.error('[Radio] offer failed:', err);
        }
      }
    };

    const onPeerJoined = (peer) => {
      if (!forThisTuner(peer)) return;
      setPeers(prev => {
        if (prev.some(p => p.socketId === peer.socketId)) return prev;
        return [...prev, peer];
      });
      new Audio('/sounds/freq_connect.mp3').play().catch(() => {});
      // The new peer initiates the offer to us — no action needed here.
    };

    const onPeerLeft = (payload) => {
      if (!forThisTuner(payload)) return;
      const { socketId, userId } = payload;
      if (socketId) {
        cleanupPeer(socketId);
        setPeers(prev => prev.filter(p => p.socketId !== socketId));
      } else {
        const matching = peersRef.current.filter(p => String(p.userId) === String(userId));
        for (const p of matching) cleanupPeer(p.socketId);
        setPeers(prev => prev.filter(p => String(p.userId) !== String(userId)));
      }
      new Audio('/sounds/freq_disconnect.mp3').play().catch(() => {});
    };

    const onOffer = async (payload) => {
      if (!forThisTuner(payload)) return;
      const { offer, fromSocketId, fromUserId, fromCitizenName, frequency } = payload;
      if (frequency !== currentFreqRef.current) return;
      try {
        const pc = await createPeerConnection(fromSocketId);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainPendingCandidates(fromSocketId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('radio:answer', {
          targetSocketId: fromSocketId,
          answer,
          tunerId: 'right',
        });
        // Make sure the peer shows up in the list even before peer-joined arrives.
        setPeers(prev => {
          if (prev.some(p => p.socketId === fromSocketId)) return prev;
          return [...prev, { socketId: fromSocketId, userId: fromUserId, citizenName: fromCitizenName }];
        });
      } catch (err) {
        console.error('[Radio] answer failed:', err);
      }
    };

    const onAnswer = async (payload) => {
      if (!forThisTuner(payload)) return;
      const { answer, fromSocketId } = payload;
      const pc = peerConnsRef.current[fromSocketId];
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await drainPendingCandidates(fromSocketId);
      } catch (err) {
        console.error('[Radio] setRemoteDescription(answer) failed:', err);
      }
    };

    const onIce = async (payload) => {
      if (!forThisTuner(payload)) return;
      const { candidate, fromSocketId } = payload;
      if (!candidate) return;
      const pc = peerConnsRef.current[fromSocketId];
      // Queue candidate if peer connection doesn't exist yet, or if remote
      // description hasn't been set. Drained by drainPendingCandidates().
      if (!pc || !pc.remoteDescription) {
        if (!pendingCandidatesRef.current[fromSocketId]) {
          pendingCandidatesRef.current[fromSocketId] = [];
        }
        pendingCandidatesRef.current[fromSocketId].push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[Radio] addIceCandidate failed:', err);
      }
    };

    const onError = ({ message }) => {
      console.error('[Radio] server error:', message);
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
          rc?.setBedActive(true, 0.35);
          // KY-58 crypto preamble — plays locally when a peer transmits
          // with a crypto-tagged rig. Modulation-agnostic in Nexus:
          // triggered by preset.spec.encryptionEffect existence, not FM.
          if (crypto) {
            try { new Audio('/sounds/radio/KY_58_RX.wav').play().catch(() => {}); } catch {}
          }
        } catch {}
        return next;
      });
    };

    // Collision — fires when the server detects two or more concurrent
    // PTT holders on this frequency. All operators on the room hear a
    // random frq-collision sample so overlapping transmissions have a
    // distinct "clash" sound rather than muddy mixing.
    const COLLISION_SAMPLES = [
      '/sounds/radio/frq-collision.wav',
      '/sounds/radio/frq-collision2.wav',
      '/sounds/radio/frq-collision3.wav',
    ];
    let lastCollisionAt = 0;
    const onCollision = () => {
      const now = Date.now();
      if (now - lastCollisionAt < 400) return; // rate-limit — one clash per ~400 ms
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
          // Only drop the bed if nobody — not even me — is transmitting.
          if (next.length === 0 && !isPTTActive) rc?.setBedActive(false);
        } catch {}
        return next;
      });
    };

    // When the underlying socket reconnects (network hiccup, server restart),
    // its server-side room membership is lost and the server has assigned us a
    // new socket.id. Tear down stale peer connections (the other side has
    // already cleaned us up via the disconnect peer-left) and rejoin the room
    // so the server reissues room-peers and we re-establish the mesh.
    const onConnect = () => {
      if (!currentFreqRef.current) return;
      cleanupAllPeers();
      socket.emit('radio:join', {
        frequency: currentFreqRef.current,
        missionId: currentMissionRef.current,
        tunerId: 'right',
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
    socket.on('radio:collision',     onCollision);
    socket.on('radio:error',         onError);
    socket.on('connect',             onConnect);

    return () => {
      socket.off('radio:room-peers',    onRoomPeers);
      socket.off('radio:peer-joined',   onPeerJoined);
      socket.off('radio:peer-left',     onPeerLeft);
      socket.off('radio:offer',         onOffer);
      socket.off('radio:answer',        onAnswer);
      socket.off('radio:ice-candidate', onIce);
      socket.off('radio:ptt-start',     onPttStart);
      socket.off('radio:ptt-stop',      onPttStop);
      socket.off('radio:collision',     onCollision);
      socket.off('radio:error',         onError);
      socket.off('connect',             onConnect);
    };
  }, [socket, createPeerConnection, cleanupPeer, cleanupAllPeers, drainPendingCandidates]);

  // ── PTT keybinding (configurable key, default V) ─────────────────────────
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

    // Electron companion bridge — when running inside the Nexus Companion
    // app, the native OS-level key hook delivers PTT events via IPC.
    // This path fires even when Star Citizen (or any other app) has
    // keyboard focus; the in-browser keydown/keyup above only fires when
    // THIS window has focus. The two paths are complementary — the
    // reservation gates below (mute, no frequency) still apply.
    let unsubscribeIPC = null;
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.onPTT) {
        // Register under the 'right' tuner slot specifically. The legacy
        // setPttKey() call wrote to the SAME slot as Command's setPttKeys,
        // so CapsLock (Command) and V (Crew) collided, and every OS-level
        // PTT event — whichever key fired it — reached both hooks.
        window.electronAPI.setPttKeys?.({ right: pttKey || 'v' });
        unsubscribeIPC = window.electronAPI.onPTT((payload) => {
          const { down, tunerId } = payload || {};
          // Server labels each PTT event with the tuner it was bound to.
          // Pre-tunerId clients send undefined, which we treat as 'right'
          // so legacy behavior is preserved.
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
      console.error('[Radio] Electron PTT bridge failed:', err?.message);
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      try { unsubscribeIPC?.(); } catch {}
    };
  }, [startPTT, stopPTT, pttKey]);

  // Auto-rejoin from persisted tune removed per operator request. Tuning now
  // requires an explicit TUNE press on every mount / view switch.

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        if (socket && currentFreqRef.current) {
          socket.emit('radio:leave', { frequency: currentFreqRef.current, tunerId: 'right' });
        }
      } catch {}
      for (const sid of Object.keys(peerConnsRef.current)) {
        try { peerConnsRef.current[sid].close(); } catch {}
      }
      for (const a of Object.values(peerAudiosRef.current)) {
        try { a.pause(); a.srcObject = null; } catch {}
      }
      try { filterChainRef.current?.dispose(); } catch {}
      try { micGainRef.current?.disconnect(); } catch {}
      try { analyserSourceRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
      // See teardownAudioChain — intentionally NOT closing
      // audioCtxRef. Chromium reclaims on page unload.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose a setter for the SRS radio-model spec. Called by the Dashboard /
  // Companion / RadioWidget whenever the user's assigned radio is loaded
  // or the admin reassigns one. The spec is held in a ref and consumed by
  // the next ensureMicAndChain() call, so changing radios takes effect on
  // the next tune (or an explicit untune → retune cycle).
  const setSrsRadioSpec = useCallback((spec) => {
    // Short-circuit if the spec reference hasn't changed. useMyRadio now
    // broadcasts cross-instance refetches, which causes this setter to
    // fire more often — but most calls carry the same spec and shouldn't
    // tear anything down.
    if (srsSpecRef.current === spec) return;
    const wasTuned = !!currentFreqRef.current;
    srsSpecRef.current = spec || null;

    // If the operator is actively tuned, keep the current tx chain and
    // live mic stream intact. Changing radios mid-session was tearing
    // down the mic chain and silently breaking PTT. The new spec takes
    // effect on the next untune → retune cycle, which matches the
    // original "takes effect on next tune" intent noted below.
    if (wasTuned) {
      // Still rebuild listener-side rx graphs so this radio's rxEffect
      // applies to incoming peer audio immediately.
      try { rebuildAllPeerRxGraphs(); } catch {}
      return;
    }

    // Not tuned — safe to fully tear down so the next tune builds fresh.
    try { srsChainRef.current?.dispose?.(); } catch {}
    srsChainRef.current = null;
    try { filteredStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    filteredStreamRef.current = null;
    try { rebuildAllPeerRxGraphs(); } catch {}
  }, [rebuildAllPeerRxGraphs]);

  // Swap the local squelch-bed sample to match the player's radio band.
  // Called by the consumer whenever the radio changes. Safe to call
  // before an AudioContext exists — radioChrome lazy-initializes on
  // first getRadioChrome(ctx) call so we defer until ctx is live.
  const setSrsRadioBand = useCallback((band) => {
    const ctx = audioCtxRef.current;
    if (!ctx) {
      // Stash and reapply when the ctx comes online inside ensureMicAndChain.
      srsBandRef.current = band || 'VHF';
      return;
    }
    try {
      const rc = getRadioChrome(ctx);
      rc?.setBand?.(band || 'VHF');
      srsBandRef.current = band || 'VHF';
    } catch {}
  }, []);

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
