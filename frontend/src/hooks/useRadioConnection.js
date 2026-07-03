import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocketContext } from '../context/SocketContext';
import api from '../services/api';
import { buildSpacesuitChain } from '../utils/spacesuitFilter';

// Single hook that wires Socket.IO radio signaling, WebRTC mesh, and a
// spacesuit-filtered local mic stream. Returns the state RadioPanel needs
// plus join/leave/PTT methods.

export function useRadioConnection({ voiceProfile, voiceProfileVersion = 0, pttKey = 'v' }) {
  const { socket } = useSocketContext();

  const [tunedFrequency, setTunedFrequency] = useState(null);
  const [peers, setPeers] = useState([]);
  const [transmittingPeerIds, setTransmittingPeerIds] = useState([]);
  const [isPTTActive, setIsPTTActive] = useState(false);
  const [micGranted, setMicGranted] = useState(false);

  const peerConnsRef    = useRef({});  // socketId -> RTCPeerConnection
  const peerConnPromisesRef = useRef({});  // socketId -> in-flight createPeerConnection promise
  const pendingCandidatesRef = useRef({}); // socketId -> [RTCIceCandidateInit, ...] queued until remoteDescription is set
  const peerAudiosRef   = useRef({});  // socketId -> HTMLAudioElement
  const peersRef        = useRef([]);  // mirror of peers state for cleanup
  const audioCtxRef     = useRef(null);
  const micStreamRef    = useRef(null);
  const filterChainRef  = useRef(null);
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
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        micStreamRef.current = stream;
        setMicGranted(true);
      } catch (err) {
        console.error('[Radio] mic permission denied:', err);
        return null;
      }
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
    }

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
    chain.output.connect(dest);
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
        const audio = new Audio();
        audio.srcObject = e.streams[0];
        audio.autoplay = true;
        audio.play().catch(() => {});
        peerAudiosRef.current[peerSocketId] = audio;
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

  const cleanupPeer = useCallback((peerSocketId) => {
    const pc = peerConnsRef.current[peerSocketId];
    if (pc) { try { pc.close(); } catch {} }
    delete peerConnsRef.current[peerSocketId];
    delete peerConnPromisesRef.current[peerSocketId];
    delete pendingCandidatesRef.current[peerSocketId];

    const a = peerAudiosRef.current[peerSocketId];
    if (a) {
      try { a.pause(); } catch {}
      try { a.srcObject = null; } catch {}
    }
    delete peerAudiosRef.current[peerSocketId];

    setTransmittingPeerIds(prev => prev.filter(id => id !== peerSocketId));
  }, []);

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
    setIsPTTActive(true);
    for (const t of filteredStreamRef.current.getAudioTracks()) t.enabled = true;
    if (filterChainRef.current) {
      try { filterChainRef.current.playClick('open'); } catch {}
    }
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
      setTransmittingPeerIds(prev => prev.includes(socketId) ? prev : [...prev, socketId]);
    };

    const onPttStop = ({ socketId }) => {
      setTransmittingPeerIds(prev => prev.filter(id => id !== socketId));
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
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
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

  return {
    tunedFrequency,
    peers,
    transmittingPeerIds,
    isPTTActive,
    micGranted,
    joinFrequency,
    leaveFrequency,
    startPTT,
    stopPTT,
    getInputLevel,
    setMicSensitivity,
    setMuted,
  };
}
