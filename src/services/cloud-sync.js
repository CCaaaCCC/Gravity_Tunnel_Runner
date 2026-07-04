import { CONFIG } from '../core/config.js';
import { safeParseJSON, safeGetItem, safeSetItem } from '../core/storage.js';
import { APIClient } from './api-client.js';
import { AuthManager } from './auth.js';
import { NetworkIndicator } from './network-indicator.js';

// ============ 云端集成：进度同步 ============

export const CloudSync = {
  _syncTimer: null,
  _isSyncing: false,

  // 防抖同步：500ms 内多次调用合并为一次
  scheduleSync() {
    if (!AuthManager.isLoggedIn()) return;
    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this.saveProgress().catch(() => {}), 500);
  },

  async saveProgress() {
    if (!AuthManager.isLoggedIn()) return false;
    if (this._isSyncing) return false;

    const payload = {
      achievements: safeParseJSON(CONFIG.STORAGE_KEYS.ACHIEVEMENTS, {}),
      unlocked_skins: safeParseJSON(CONFIG.STORAGE_KEYS.UNLOCKED_SKINS, []),
      cumulative_powerups: parseInt(safeGetItem(CONFIG.STORAGE_KEYS.CUMULATIVE_POWERUPS, '0')) || 0,
      credits: parseInt(safeGetItem(CONFIG.STORAGE_KEYS.CREDITS, '0')) || 0,
      current_skin: safeGetItem(CONFIG.STORAGE_KEYS.CURRENT_SKIN, 'classic') || 'classic'
    };

    this._isSyncing = true;
    NetworkIndicator.setSyncing();
    try {
      const resp = await APIClient.put('/progress/save', payload);
      if (resp.ok) {
        NetworkIndicator.setOnline();
        this._clearPending();
        return true;
      }
      this._enqueuePending(payload);
      return false;
    } catch (e) {
      this._enqueuePending(payload);
      NetworkIndicator.setOffline();
      return false;
    } finally {
      this._isSyncing = false;
    }
  },

  async loadProgress() {
    if (!AuthManager.isLoggedIn()) return null;
    try {
      const resp = await APIClient.get('/progress/get');
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  },

  // 合并云端进度到本地（last-write-wins + 并集合并）
  mergeAndApply(cloudData) {
    if (!cloudData) return false;
    let changed = false;

    // 成就：并集（云端的解锁状态合并到本地）
    // 注意：本地 localStorage 和后端 progress._merge_achievements 都存储为 boolean（true/false），
    // 不是 {unlocked: bool} 对象。此处兼容两种格式以防未来变更。
    const localAch = safeParseJSON(CONFIG.STORAGE_KEYS.ACHIEVEMENTS, {});
    const cloudAch = cloudData.achievements || {};
    let achChanged = false;
    const isUnlocked = (v) => {
      if (typeof v === 'boolean') return v;
      if (v && typeof v === 'object') return !!v.unlocked;
      return false;
    };
    for (const key in cloudAch) {
      if (isUnlocked(cloudAch[key]) && !isUnlocked(localAch[key])) {
        localAch[key] = true;
        achChanged = true;
      }
    }
    if (achChanged) {
      safeSetItem(CONFIG.STORAGE_KEYS.ACHIEVEMENTS, JSON.stringify(localAch));
      changed = true;
    }

    // 皮肤：并集
    const localSkins = safeParseJSON(CONFIG.STORAGE_KEYS.UNLOCKED_SKINS, []);
    const cloudSkins = Array.isArray(cloudData.unlocked_skins) ? cloudData.unlocked_skins : [];
    const mergedSkins = [...new Set([...localSkins, ...cloudSkins])];
    if (mergedSkins.length !== localSkins.length) {
      safeSetItem(CONFIG.STORAGE_KEYS.UNLOCKED_SKINS, JSON.stringify(mergedSkins));
      changed = true;
    }

    // 积分 / 累计道具：取最大值（last-write-wins 的兜底）
    const cloudCredits = cloudData.credits || 0;
    const localCredits = parseInt(safeGetItem(CONFIG.STORAGE_KEYS.CREDITS, '0')) || 0;
    if (cloudCredits > localCredits) {
      safeSetItem(CONFIG.STORAGE_KEYS.CREDITS, String(cloudCredits));
      changed = true;
    }
    const cloudCumulative = cloudData.cumulative_powerups || 0;
    const localCumulative = parseInt(safeGetItem(CONFIG.STORAGE_KEYS.CUMULATIVE_POWERUPS, '0')) || 0;
    if (cloudCumulative > localCumulative) {
      safeSetItem(CONFIG.STORAGE_KEYS.CUMULATIVE_POWERUPS, String(cloudCumulative));
      changed = true;
    }

    // 当前皮肤：仅在云端有值时采用
    if (cloudData.current_skin !== undefined && cloudData.current_skin !== null) {
      const localCurrent = safeGetItem(CONFIG.STORAGE_KEYS.CURRENT_SKIN, 'classic') || 'classic';
      if (cloudData.current_skin !== localCurrent) {
        safeSetItem(CONFIG.STORAGE_KEYS.CURRENT_SKIN, String(cloudData.current_skin));
        changed = true;
      }
    }
    return changed;
  },

  async submitScore(score, maxCombo, difficulty, isChallenge, distance, durationSec) {
    if (!AuthManager.isLoggedIn()) return false;
    // 后端 duration_sec 要求 int 且 >=1；浮点或 0 会 422。
    // 取整后 <1 时不传该字段（让后端用 None 默认值）
    const dur = Math.floor(durationSec || 0);
    const body = {
      score, combo: maxCombo, difficulty, is_challenge: !!isChallenge,
      distance: distance || 0, zone_reached: 0
    };
    if (dur >= 1) body.duration_sec = dur;
    try {
      const resp = await APIClient.post('/leaderboard/submit', body);
      return resp.ok;
    } catch (e) { return false; }
  },

  async getGlobalLeaderboard(difficulty, isChallenge) {
    try {
      const params = new URLSearchParams();
      if (difficulty) params.set('difficulty', difficulty);
      if (isChallenge !== undefined) params.set('is_challenge', isChallenge);
      const resp = await APIClient.get(`/leaderboard/top?${params.toString()}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data) ? data : (data.scores || []);
    } catch (e) { return []; }
  },

  _enqueuePending(payload) {
    const pending = safeParseJSON(CONFIG.STORAGE_KEYS.PENDING_SYNC, []);
    pending.push({ payload, ts: Date.now() });
    safeSetItem(CONFIG.STORAGE_KEYS.PENDING_SYNC, JSON.stringify(pending));
  },

  _clearPending() {
    try { localStorage.removeItem(CONFIG.STORAGE_KEYS.PENDING_SYNC); } catch (e) {}
  },

  async flushPending() {
    if (!AuthManager.isLoggedIn()) return;
    const pending = safeParseJSON(CONFIG.STORAGE_KEYS.PENDING_SYNC, []);
    if (pending.length === 0) return;
    // 只重放最后一条（避免旧数据覆盖新数据）
    const last = pending[pending.length - 1];
    try {
      const resp = await APIClient.put('/progress/save', last.payload);
      if (resp.ok) this._clearPending();
    } catch (e) { /* 保留待重试 */ }
  }
};
