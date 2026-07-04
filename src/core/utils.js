// ============ Toast 通知（替代原生 alert） ============
// 需要 #toastContainer DOM 元素

export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast' + (type !== 'info' ? ' ' + type : '');
  toast.textContent = message;
  container.appendChild(toast);
  // 3 秒后淡出移除
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }, 3000);
}

// 将数字色值转换为 CSS hex 字符串（如 0x00E5C7 -> '#00e5c7'）
export function hexToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
