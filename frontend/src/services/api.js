import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('nexus_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Session-nuke behavior on 401. Two cases flip the user back to
// Discord OAuth and never show a half-authenticated app:
//
//   1. A 401 from the identity endpoints (/users/me, /auth/me).
//   2. A 401 from ANY endpoint where the server's error body says
//      "User not found" — that's the backend telling us the user
//      record was deleted (DB wipe, admin removal, etc.) even though
//      the JWT itself still decodes. Without this, the client sits
//      on a valid-looking token and every sub-request silently 401s.
//
// Other 401s (permission scope, bad id in the URL) stay silent and
// let the caller handle them — same as before.
const AUTH_CHECK_PATHS = ['/users/me', '/auth/me'];
function isAuthCheckRequest(cfg) {
  const url = cfg?.url || '';
  return AUTH_CHECK_PATHS.some(p => url.endsWith(p));
}
function isUserNotFound(err) {
  const body = err?.response?.data;
  const msg = (body && (body.error || body.message)) || '';
  return typeof msg === 'string' && /user not found/i.test(msg);
}
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && (isAuthCheckRequest(err.config) || isUserNotFound(err))) {
      localStorage.removeItem('nexus_token');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export default api;
