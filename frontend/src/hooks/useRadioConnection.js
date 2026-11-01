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
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
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
        });
      };

      pc.ontrack = (e) => {
        const stream = e.streams[0];
        peerStreamsRef.current[peerSocketId] = stream;

        const audio = new Audio();
        audio.autoplay = true;
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

  // Build the per-peer Web Audio graph that applies the listener's own
  // SRS rxEffect to this peer's incoming stream, then feeds a brand new
  // MediaStream back to the <audio> element so setSinkId / autoplay
  // still work. If no AudioContext or no rxEffect is available we skip
  // DSP cleanly — audio.srcObject points at the raw stream and the
  // behavior matches the pre-rxEffect code path.
  const attachPeerRxGraph = useCallback((peerSocketId, stream, audio) => {
    detachPeerRxGraph(peerSocketId);
    const ctx = audioCtxRef.current;
    const rxEffect = srsSpecRef.current?.rxEffect;
    if (!ctx || !rxEffect) {
      try { audio.srcObject = stream; } catch {}
      return;
    }
    try {
      const source = ctx.createMediaStreamSource(stream);
      const chain = buildSrsChain(ctx, rxEffect);
      const dest = ctx.createMediaStreamDestination();
      source.connect(chain.input);
      chain.output.connect(dest);
      peerRxNodesRef.current[peerSocketId] = { source, chain, dest };
      audio.srcObject = dest.stream;
    } catch (err) {
      console.error('[Radio] rxEffect graph failed for', peerSocketId, err);
      try { audio.srcObject = stream; } catch {}
    }
  }, []);

  const detachPeerRxGraph = useCallback((peerSocketId) => {
    const graph = peerRxNodesRef.current[peerSocketId];
    if (!graph) return;
    try { graph.source.disconnect(); } catch {}
    try { graph.chain.dispose?.(); } catch {}
    try { graph.dest.disconnect?.(); } catch {}
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

  const joinFrequency = useCallback(async (freq, missionId) => {
    if (!socket || !freq) return;
    const f = String(freq).trim();
    if (!f) return;
    // Tear down any prior session.
    if (currentFreqRef.current) {
      socket.emit('radio:leave', { frequency: currentFreqRef.current });
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
    socket.emit('radio:join', { frequency: f, missionId });
  }, [socket, ensureMicAndChain, cleanupAllPeers]);

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
    try { audioCtxRef.current?.close(); } catch {}

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
      socket.emit('radio:leave', { frequency: currentFreqRef.current });
      new Audio('/sounds/radio_disconnect.mp3').play().catch(() => {});
    }
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
      rc.setBedActive(true);
    } catch {}
    socket?.emit('radio:ptt-start', { frequency: currentFreqRef.current });
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
    if (!isPTTActive && !filteredStreamRef.current) return;
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
      socket.emit('radio:ptt-stop', { frequency: currentFreqRef.current });
    }
  }, [socket, isPTTActive]);

  // ── Socket listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onRoomPeers = async ({ frequency, peers: list }) => {
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
          });
        } catch (err) {
          console.error('[Radio] offer failed:', err);
        }
      }
    };

    const onPeerJoined = (peer) => {
      setPeers(prev => {
        if (prev.some(p => p.socketId === peer.socketId)) return prev;
        return [...prev, peer];
      });
      new Audio('/sounds/freq_connect.mp3').play().catch(() => {});
      // The new peer initiates the offer to us — no action needed here.
    };

    const onPeerLeft = ({ socketId, userId }) => {
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

    const onOffer = async ({ offer, fromSocketId, fromUserId, fromCitizenName, frequency }) => {
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

    const onAnswer = async ({ answer, fromSocketId }) => {
      const pc = peerConnsRef.current[fromSocketId];
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await drainPendingCandidates(fromSocketId);
      } catch (err) {
        console.error('[Radio] setRemoteDescription(answer) failed:', err);
      }
    };

    const onIce = async ({ candidate, fromSocketId }) => {
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

    const onPttStart = ({ socketId }) => {
      setTransmittingPeerIds(prev => {
        if (prev.includes(socketId)) return prev;
        const next = [...prev, socketId];
        transmittingPeerIdsRef.current = next;
        // Peer keyed up — local squelch bed + key-up click so the user hears
        // the channel open before voice arrives, DCS-style.
        try {
          const rc = getRadioChrome(audioCtxRef.current);
          rc?.playKeyUp();
          rc?.setBedActive(true);
        } catch {}
        return next;
      });
    };

    const onPttStop = ({ socketId }) => {
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
        window.electronAPI.setPttKey?.(pttKey || 'v');
        unsubscribeIPC = window.electronAPI.onPTT(({ down }) => {
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

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        if (socket && currentFreqRef.current) {
          socket.emit('radio:leave', { frequency: currentFreqRef.current });
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
      try { audioCtxRef.current?.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose a setter for the SRS radio-model spec. Called by the Dashboard /
  // Companion / RadioWidget whenever the user's assigned radio is loaded
  // or the admin reassigns one. The spec is held in a ref and consumed by
  // the next ensureMicAndChain() call, so changing radios takes effect on
  // the next tune (or an explicit untune → retune cycle).
  const setSrsRadioSpec = useCallback((spec) => {
    srsSpecRef.current = spec || null;
    try {
      srsChainRef.current?.dispose?.();
    } catch {}
    srsChainRef.current = null;
    try {
      filteredStreamRef.current?.getTracks().forEach(t => t.stop());
    } catch {}
    filteredStreamRef.current = null;
    // Rebuild every peer's rx graph with the new listener-side rxEffect.
    // If spec is null, graphs are torn down and streams play raw.
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
    setSrsRadioSpec,
    setSrsRadioBand,
  };
}
