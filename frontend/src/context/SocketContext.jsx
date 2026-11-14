import { createContext, useContext } from 'react';
import { useSocket } from '../hooks/useSocket';
import useAppQuitHook from '../hooks/useAppQuitHook';
import { useAuthContext } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token } = useAuthContext();
  const socketState = useSocket(token);
  // Arms the Electron shell's cleanup funnel once per renderer. Fans
  // out a window 'nexus:before-quit' event so useSocket (and any
  // other owner) can drop its connection cleanly before the shell
  // destroys the window.
  useAppQuitHook();
  return <SocketContext.Provider value={socketState}>{children}</SocketContext.Provider>;
}

export function useSocketContext() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocketContext must be used within SocketProvider');
  return ctx;
}
