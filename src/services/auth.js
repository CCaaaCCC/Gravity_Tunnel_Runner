import { CONFIG } from '../core/config.js';
import { safeParseJSON, safeSetItem } from '../core/storage.js';
import { APIClient } from './api-client.js';

// ============ 云端集成：身份认证管理 ============

// 带 AbortController 超时的 fetch 封装，避免后端无响应时前端永久挂起
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export const AuthManager = {
  state: { user: null, accessToken: null, refreshToken: null, expiresAt: 0 },

  init() {
    const saved = safeParseJSON(CONFIG.STORAGE_KEYS.AUTH, null);
    if (saved && saved.accessToken) {
      this.state = { ...this.state, ...saved };
      // token 即将过期则尝试刷新
      if (this.state.expiresAt && Date.now() > this.state.expiresAt - 5 * 60 * 1000) {
        this.refresh().catch(() => this._clearLocal());
      }
    }
  },

  isLoggedIn() { return !!this.state.accessToken; },
  getUser() { return this.state.user; },
  getUsername() { return this.state.user?.username || ''; },
  getAccessToken() { return this.state.accessToken; },

  async sendOTP(email) {
    let resp;
    try {
      resp = await fetchWithTimeout(`${CONFIG.API_BASE_URL}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '请求超时，请检查网络后重试' : '网络错误，请稍后重试');
    }
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '验证码发送失败');
    }
    // 返回完整响应（含 is_new_user 字段，供前端切换注册/登录 UI）
    return resp.json();
  },

  async verifyOTP(email, code, username) {
    const body = { email, code };
    if (username) body.username = username;
    let resp;
    try {
      resp = await fetchWithTimeout(`${CONFIG.API_BASE_URL}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '请求超时，请检查网络后重试' : '网络错误，请稍后重试');
    }
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '验证失败');
    }
    const data = await resp.json();
    this.state = {
      user: data.user,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000
    };
    this._save();
    return data;
  },

  async refresh() {
    if (!this.state.refreshToken) return false;
    try {
      const resp = await fetchWithTimeout(`${CONFIG.API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.state.refreshToken })
      });
      if (!resp.ok) { this._clearLocal(); return false; }
      const data = await resp.json();
      this.state.accessToken = data.access_token;
      // refresh token 轮换：服务端返回新 refresh token，旧的立即失效
      if (data.refresh_token) {
        this.state.refreshToken = data.refresh_token;
      }
      this.state.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      this._save();
      // 刷新 token 成功后同步拉取最新用户信息，确保本地 user 不是登录时的快照
      // 直接 fetch 而非走 APIClient，避开其 401 自动刷新逻辑以免递归
      try {
        const meResp = await fetchWithTimeout(`${CONFIG.API_BASE_URL}/auth/me`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${this.state.accessToken}` }
        });
        if (meResp.ok) {
          this.state.user = await meResp.json();
          this._save();
        }
      } catch (e) { /* 用户信息拉取失败不阻塞 token 刷新 */ }
      return true;
    } catch (e) {
      this._clearLocal();
      return false;
    }
  },

  async fetchMe() {
    if (!this.isLoggedIn()) return null;
    try {
      const resp = await APIClient.get('/auth/me');
      if (resp.ok) {
        const user = await resp.json();
        this.state.user = user;
        this._save();
        return user;
      }
    } catch (e) { /* 静默降级 */ }
    return null;
  },

  // 服务端登出：撤销 refresh token jti，使所有 refresh token 立即失效
  async logout() {
    if (this.state.accessToken) {
      try {
        await APIClient.post('/auth/logout');
      } catch (e) { /* 即使请求失败也清本地状态 */ }
    }
    this._clearLocal();
  },

  // ===== 可选密码登录（与 OTP 共存）=====

  async loginWithPassword(email, password) {
    let resp;
    try {
      resp = await fetchWithTimeout(`${CONFIG.API_BASE_URL}/auth/login-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '请求超时，请检查网络后重试' : '网络错误，请稍后重试');
    }
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '登录失败');
    }
    const data = await resp.json();
    this.state = {
      user: data.user,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000
    };
    this._save();
    return data;
  },

  async setPassword(password) {
    const resp = await APIClient.post('/auth/set-password', { password });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '设置密码失败');
    }
    const user = await resp.json();
    this.state.user = user;
    this._save();
    return user;
  },

  async changePassword(oldPassword, newPassword) {
    const resp = await APIClient.put('/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '修改密码失败');
    }
    const user = await resp.json();
    this.state.user = user;
    this._save();
    return user;
  },

  async resetPassword(email, code, newPassword) {
    let resp;
    try {
      resp = await fetchWithTimeout(`${CONFIG.API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, new_password: newPassword })
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '请求超时，请检查网络后重试' : '网络错误，请稍后重试');
    }
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '重置密码失败');
    }
    return resp.json();
  },

  // multipart 上传头像：必须用 FormData，浏览器自动设置带 boundary 的 Content-Type
  // 因此绕过 APIClient（它会强制 application/json），手动附加 Authorization 头
  async uploadAvatar(file) {
    const formData = new FormData();
    formData.append('file', file);
    const token = this.getAccessToken();
    let resp;
    try {
      resp = await fetchWithTimeout(`${CONFIG.API_BASE_URL}/auth/avatar`, {
        method: 'POST',
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: formData
      }, 30000); // 头像上传给 30s 超时（图片可能较大）
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '上传超时，请检查网络后重试' : '网络错误，请稍后重试');
    }
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '头像上传失败');
    }
    const user = await resp.json();
    this.state.user = user;
    this._save();
    return user;
  },

  async changeEmailSendOtp(newEmail) {
    const resp = await APIClient.post('/auth/change-email/send-otp', { new_email: newEmail });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '发送验证码失败');
    }
    return resp.json();
  },

  async changeEmailVerify(newEmail, code) {
    const resp = await APIClient.post('/auth/change-email/verify', { new_email: newEmail, code });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || '邮箱变更失败');
    }
    const user = await resp.json();
    this.state.user = user;
    this._save();
    return user;
  },

  // 仅清本地状态（不调服务端），用于 refresh 失败等场景
  _clearLocal() {
    this.state = { user: null, accessToken: null, refreshToken: null, expiresAt: 0 };
    try { localStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH); } catch (e) {}
  },

  _save() { safeSetItem(CONFIG.STORAGE_KEYS.AUTH, JSON.stringify(this.state)); }
};
