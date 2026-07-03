import { createContext, useContext } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useAuthContext } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token } = useAuthContext();
  const socketState = useSocket(token);
  return <SocketContext.Provider value={socketState}>{children}</SocketContext.Provider>;
}

export function useSocketContext() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocketContext must be used within SocketProvider');
  return ctx;
}
