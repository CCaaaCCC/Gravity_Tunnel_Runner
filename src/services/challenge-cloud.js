import { APIClient } from './api-client.js';
import { AuthManager } from './auth.js';

// ============ 云端集成：挑战模式 ============

export const ChallengeCloud = {
  async createChallenge(seed, score, combo) {
    if (!AuthManager.isLoggedIn()) return null;
    try {
      const resp = await APIClient.post('/challenges/create', {
        seed, initial_score: score, initial_combo: combo
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  },

  async getChallenge(code) {
    try {
      const resp = await APIClient.get(`/challenges/${code}`);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) { return null; }
  },

  async submitChallengeScore(code, score, combo, distance, durationSec) {
    if (!AuthManager.isLoggedIn()) return false;
    const dur = Math.floor(durationSec || 0);
    const body = { score, combo, distance: distance || 0 };
    if (dur >= 1) body.duration_sec = dur;
    try {
      const resp = await APIClient.post(`/challenges/${code}/submit`, body);
      return resp.ok;
    } catch (e) { return false; }
  },

  async getChallengeLeaderboard(code) {
    try {
      const resp = await APIClient.get(`/challenges/${code}/leaderboard`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data) ? data : (data.scores || []);
    } catch (e) { return []; }
  }
};
