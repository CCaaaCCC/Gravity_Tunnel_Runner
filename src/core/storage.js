// ============ 通用工具：localStorage 安全访问 ============

export function safeGetItem(key, fallback) {
  try { return localStorage.getItem(key); }
  catch (e) { return fallback; }
}

export function safeParseJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}

export function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); }
  catch (e) { /* 隐私模式或配额满，静默降级 */ }
}
