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

// Only wipe the stored token when the identity endpoint itself returns
// 401 — that's the authoritative signal that the token is no longer
// valid. A 401 from some other endpoint (bad id in the URL, a
// permission-scoped route) should NOT drop the user back to Discord
// login. Previously any 401 would nuke the session, which caused
// seemingly random re-login prompts when a sub-request hit a 401 for
// non-auth reasons.
const AUTH_CHECK_PATHS = ['/users/me', '/auth/me'];
function isAuthCheckRequest(cfg) {
  const url = cfg?.url || '';
  return AUTH_CHECK_PATHS.some(p => url.endsWith(p));
}
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && isAuthCheckRequest(err.config)) {
      localStorage.removeItem('nexus_token');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export default api;
