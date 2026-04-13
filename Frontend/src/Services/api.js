import axios from 'axios';

const getFallbackBaseUrl = () => {
  if (typeof window === 'undefined') return '';

  const fromWindow = window.__ATTENDANCE_FALLBACK_BASE_URL;
  if (typeof fromWindow === 'string' && fromWindow.trim()) return fromWindow.trim();

  const fromStorage = window.localStorage?.getItem('attendanceFallbackBaseUrl');
  if (typeof fromStorage === 'string' && fromStorage.trim()) return fromStorage.trim();

  const meta = window.document?.querySelector?.('meta[name="attendance-fallback-base-url"]');
  const fromMeta = meta?.getAttribute?.('content');
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();

  return '';
};

const api = axios.create({
  baseURL: '/',
  timeout: 15000,
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }

    const config = error?.config;
    const fallbackBaseUrl = getFallbackBaseUrl();
    const shouldRetryWithFallback =
      !!config &&
      !config.__retriedWithFallback &&
      error.response?.status !== 401 &&
      !!fallbackBaseUrl &&
      (config.baseURL || api.defaults.baseURL) !== fallbackBaseUrl;

    if (shouldRetryWithFallback) {
      config.__retriedWithFallback = true;
      config.baseURL = fallbackBaseUrl;
      return api.request(config);
    }

    console.error('API Request Failed:', {
      url: error.config?.url,
      status: error.response?.status,
      statusText: error.response?.statusText,
      message: error.message,
      data: error.response?.data
    });

    return Promise.reject(error);
  }
);

export default api;
