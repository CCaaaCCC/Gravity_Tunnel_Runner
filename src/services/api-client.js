import { CONFIG } from '../core/config.js';

// ============ 云端集成：HTTP 客户端 ============
// 通过 setTokenGetter / setRefreshHandler 注入 AuthManager 的能力，
// 避免 APIClient 与 AuthManager 之间的循环依赖。
// 由 main.js 在初始化时注入：
//   APIClient.setTokenGetter(() => AuthManager.getAccessToken());
//   APIClient.setRefreshHandler(() => AuthManager.refresh());

export const APIClient = {
  baseURL: CONFIG.API_BASE_URL,
  timeout: 10000,

  // 由 main.js 注入
  _tokenGetter: null,
  _refreshHandler: null,

  setTokenGetter(fn) { this._tokenGetter = fn; },
  setRefreshHandler(fn) { this._refreshHandler = fn; },

  async request(path, options = {}) {
    const url = this.baseURL + path;
    const token = this._tokenGetter ? this._tokenGetter() : null;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url, { ...options, headers, signal: controller.signal });
      clearTimeout(timeoutId);

      // 401 时尝试刷新 token（避免无限循环）
      if (resp.status === 401 && token && !options._retry) {
        const refreshed = this._refreshHandler ? await this._refreshHandler() : false;
        if (refreshed) {
          return this.request(path, { ...options, _retry: true });
        }
      }
      return resp;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  },

  async get(path) { return this.request(path, { method: 'GET' }); },
  async post(path, body) {
    return this.request(path, { method: 'POST', body: JSON.stringify(body || {}) });
  },
  async put(path, body) {
    return this.request(path, { method: 'PUT', body: JSON.stringify(body || {}) });
  }
};
