import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { useAuthContext } from './context/AuthContext.jsx';
import './styles/global.css';

import Gate         from './pages/Gate.jsx';
import Splash       from './pages/Splash.jsx';
import Dashboard    from './pages/Dashboard.jsx';
import MissionBoard from './pages/MissionBoard.jsx';
import ShipViewer   from './pages/ShipViewer.jsx';
import CrewPanel    from './pages/CrewPanel.jsx';
import Onboarding   from './pages/Onboarding.jsx';
import Disconnect   from './pages/Disconnect.jsx';
import Admin        from './pages/Admin.jsx';
import RadioWidget  from './pages/RadioWidget.jsx';
import Companion    from './pages/Companion.jsx';
import GlobalChatPopout from './pages/GlobalChatPopout.jsx';
import RootErrorBoundary from './components/RootErrorBoundary.jsx';

// Apply persisted theme + density before React mounts so there's no FOUC.
try {
  const t = localStorage.getItem('nexus_theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
  const d = localStorage.getItem('nexus_density');
  document.documentElement.setAttribute('data-dens', d || 'comfort');
} catch {}
// Handles /auth/discord/callback?code=xxx — exchanges code for JWT via backend
function AuthCallback() {
  const [params] = useSearchParams();
  const { login } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    const code = params.get('code');
    if (!code) { navigate('/', { replace: true }); return; }
    fetch('/api/auth/discord/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.token) { login(data.token); navigate('/dashboard', { replace: true }); }
        else navigate('/', { replace: true });
      })
      .catch(() => navigate('/', { replace: true }));
  }, []);

  return null;
}

// Global route guard: enforces onboarding flow
function RouteGuard({ children }) {
  const { isAuthenticated, user } = useAuthContext();
  const location = useLocation();

  // Radio widget + companion mode always render — they handle their own
  // loading / unauthenticated state internally. Previously the RouteGuard
  // redirected to /dashboard when auth wasn't ready, which caused the
  // dashboard to render cramped at 320×44 showing only the giant
  // "Nexus Interstellar" title.
  if (location.pathname === '/radio' || location.pathname === '/companion' || location.pathname === '/chat-popout') return children;
  // Unauthenticated users access everything else freely (Splash, etc.)
  if (!isAuthenticated) return children;

  // Authenticated but not yet onboarded — force /onboarding; always allow Gate, Splash, and callback
  if (!user?.onboarding_complete && location.pathname !== '/' && location.pathname !== '/splash' && location.pathname !== '/onboarding' && location.pathname !== '/auth/discord/callback') {
    return <Navigate to="/onboarding" replace />;
  }

  // Onboarded user visiting /onboarding → bounce to dashboard
  if (user?.onboarding_complete && location.pathname === '/onboarding') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

createRoot(document.getElementById('root')).render(
  <RootErrorBoundary>
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/*" element={
            <RouteGuard>
              <Routes>
                <Route path="/"               element={<Gate />} />
                <Route path="/splash"         element={<Splash />} />
                <Route path="/auth/discord/callback" element={<AuthCallback />} />
                <Route path="/dashboard"      element={<Dashboard />} />
                <Route path="/missions"       element={<MissionBoard />} />
                <Route path="/ships"          element={<ShipViewer />} />
                <Route path="/crew"           element={<CrewPanel />} />
                <Route path="/onboarding"     element={<Onboarding />} />
                <Route path="/disconnect"     element={<Disconnect />} />
                <Route path="/admin"          element={<Admin />} />
                <Route path="/radio"          element={<RadioWidget />} />
                <Route path="/companion"      element={<Companion />} />
                <Route path="/chat-popout"    element={<GlobalChatPopout />} />
              </Routes>
            </RouteGuard>
          } />
        </Routes>
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  </RootErrorBoundary>
);
