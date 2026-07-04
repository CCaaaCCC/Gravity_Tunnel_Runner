import { CONFIG } from '../core/config.js';
import { AuthManager } from './auth.js';

// ============ 云端集成：网络状态指示器 ============

export const NetworkIndicator = {
  el: null,
  textEl: null,

  init() {
    this.el = document.getElementById('networkStatus');
    this.textEl = this.el?.querySelector('.ns-text');
    window.addEventListener('online', () => this.setOnline());
    window.addEventListener('offline', () => this.setOffline());
    // 初始探测
    this.probe();
  },

  async probe() {
    if (!navigator.onLine) { this.setOffline(); return; }
    try {
      const resp = await fetch(`${CONFIG.API_BASE_URL}/health`, { method: 'GET' });
      if (resp.ok) this.setOnline();
      else this.setOffline();
    } catch (e) { this.setOffline(); }
  },

  setOnline() {
    if (!this.el) return;
    this.el.classList.remove('offline', 'syncing');
    this.el.classList.add('online');
    if (this.textEl) this.textEl.textContent = AuthManager.isLoggedIn() ? '已连接' : '在线';
  },

  setOffline() {
    if (!this.el) return;
    this.el.classList.remove('online', 'syncing');
    this.el.classList.add('offline');
    if (this.textEl) this.textEl.textContent = '离线';
  },

  setSyncing() {
    if (!this.el) return;
    this.el.classList.remove('online', 'offline');
    this.el.classList.add('syncing');
    if (this.textEl) this.textEl.textContent = '同步中';
  }
};
