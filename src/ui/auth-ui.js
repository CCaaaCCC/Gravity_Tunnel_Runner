import { CONFIG } from '../core/config.js';
import { safeGetItem } from '../core/storage.js';
import { showToast } from '../core/utils.js';
import { AuthManager } from '../services/auth.js';
import { APIClient } from '../services/api-client.js';
import { CloudSync } from '../services/cloud-sync.js';
import { NetworkIndicator } from '../services/network-indicator.js';

// ============ 登录 Modal UI 控制 ============
// 注意：loadSkins / applySkin / renderSkinsUI / renderAchievementsUI 是游戏函数，
// 通过 setGameCallbacks 由 main.js 注入，避免与游戏主模块产生硬耦合。

export const AuthUI = {
  modal: null,
  step1: null, step2: null, step3: null, stepForgot: null,
  emailInput: null, codeInput: null, usernameInput: null, usernameGroup: null, usernameLabel: null,
  error1El: null, error2El: null, errorPwdEl: null, errorResetEl: null,
  sendBtn: null, verifyBtn: null, backBtn: null, syncBtn: null, logoutBtn: null, closeBtn: null, menuBtn: null,
  deleteAccountBtn: null, userMetaEl: null,
  // 密码登录面板
  pwdEmailInput: null, pwdInput: null, loginPwdBtn: null, forgotPwdBtn: null,
  // 忘记密码面板
  resetEmailInput: null, resetCodeInput: null, resetPwdInput: null,
  resetSendOtpBtn: null, resetConfirmBtn: null, resetBackBtn: null,
  resetResendTimer: null,
  // 个人资料页元素
  profileAvatar: null, profileAvatarFallback: null, uploadAvatarBtn: null, avatarFileInput: null,
  profileUsernameInput: null, saveUsernameBtn: null,
  profileDisplayInput: null, saveDisplayBtn: null,
  profileEmailText: null, changeEmailBtn: null, changeEmailForm: null,
  newEmailInput: null, emailCodeInput: null, sendEmailChangeOtpBtn: null,
  confirmChangeEmailBtn: null, cancelChangeEmailBtn: null,
  emailChangeResendTimer: null,
  togglePasswordBtn: null, passwordForm: null,
  stepDots: null,
  resendTimer: null,
  // 当前邮箱是否为新用户（由 send-otp 响应填充）
  _isNewUser: false,
  // 当前正在处理的邮箱
  _currentEmail: '',
  // 当前激活的登录 Tab：'otp' | 'password'
  _activeTab: 'otp',
  // 头像上传预览状态
  _pendingAvatarFile: null,
  _pendingAvatarUrl: null,

  // 游戏回调：由 main.js 注入
  // { loadSkins, applySkin, renderSkinsUI, renderAchievementsUI }
  _gameCallbacks: null,

  setGameCallbacks(callbacks) {
    this._gameCallbacks = callbacks;
  },

  init() {
    this.modal = document.getElementById('authModal');
    if (!this.modal) return;
    this.step1 = document.getElementById('authStep1');
    this.step2 = document.getElementById('authStep2');
    this.step3 = document.getElementById('authStep3');
    this.stepForgot = document.getElementById('authStepForgot');
    this.emailInput = document.getElementById('emailInput');
    this.codeInput = document.getElementById('codeInput');
    this.usernameInput = document.getElementById('usernameInput');
    this.usernameGroup = document.getElementById('usernameGroup');
    this.usernameLabel = document.getElementById('usernameLabel');
    this.error1El = document.getElementById('authError1');
    this.error2El = document.getElementById('authError2');
    this.errorPwdEl = document.getElementById('authErrorPwd');
    this.errorResetEl = document.getElementById('authErrorReset');
    this.sendBtn = document.getElementById('sendCodeBtn');
    this.verifyBtn = document.getElementById('verifyBtn');
    this.backBtn = document.getElementById('authBackBtn');
    this.syncBtn = document.getElementById('syncNowBtn');
    this.logoutBtn = document.getElementById('logoutBtn');
    this.closeBtn = document.getElementById('authCloseBtn');
    this.menuBtn = document.getElementById('userMenuBtn');
    this.deleteAccountBtn = document.getElementById('deleteAccountBtn');
    this.userMetaEl = document.getElementById('userMeta');
    // 密码登录面板
    this.pwdEmailInput = document.getElementById('pwdEmailInput');
    this.pwdInput = document.getElementById('pwdInput');
    this.loginPwdBtn = document.getElementById('loginPwdBtn');
    this.forgotPwdBtn = document.getElementById('forgotPwdBtn');
    // 忘记密码面板
    this.resetEmailInput = document.getElementById('resetEmailInput');
    this.resetCodeInput = document.getElementById('resetCodeInput');
    this.resetPwdInput = document.getElementById('resetPwdInput');
    this.resetSendOtpBtn = document.getElementById('resetSendOtpBtn');
    this.resetConfirmBtn = document.getElementById('resetConfirmBtn');
    this.resetBackBtn = document.getElementById('resetBackBtn');
    // 个人资料页
    this.profileAvatar = document.getElementById('profileAvatar');
    this.profileAvatarFallback = document.getElementById('profileAvatarFallback');
    this.uploadAvatarBtn = document.getElementById('uploadAvatarBtn');
    this.avatarFileInput = document.getElementById('avatarFileInput');
    this.profileUsernameInput = document.getElementById('profileUsernameInput');
    this.saveUsernameBtn = document.getElementById('saveUsernameBtn');
    this.profileDisplayInput = document.getElementById('profileDisplayInput');
    this.saveDisplayBtn = document.getElementById('saveDisplayBtn');
    this.profileEmailText = document.getElementById('profileEmailText');
    this.changeEmailBtn = document.getElementById('changeEmailBtn');
    this.changeEmailForm = document.getElementById('changeEmailForm');
    this.newEmailInput = document.getElementById('newEmailInput');
    this.emailCodeInput = document.getElementById('emailCodeInput');
    this.sendEmailChangeOtpBtn = document.getElementById('sendEmailChangeOtpBtn');
    this.confirmChangeEmailBtn = document.getElementById('confirmChangeEmailBtn');
    this.cancelChangeEmailBtn = document.getElementById('cancelChangeEmailBtn');
    this.togglePasswordBtn = document.getElementById('togglePasswordBtn');
    this.passwordForm = document.getElementById('passwordForm');
    // 头像预览按钮组
    this.avatarPreviewActions = document.getElementById('avatarPreviewActions');
    this.confirmAvatarBtn = document.getElementById('confirmAvatarBtn');
    this.cancelAvatarBtn = document.getElementById('cancelAvatarBtn');
    // 忘记密码流程的强度条（登录场景不显示强度）
    this.pwdStrengthReset = document.getElementById('pwdStrengthReset');
    this.stepDots = this.modal.querySelectorAll('.step-dot');

    this.bindEvents();
    this.refreshMenuButton();
  },

  bindEvents() {
    this.menuBtn?.addEventListener('click', () => this.open());
    this.closeBtn?.addEventListener('click', () => this.close());
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    this.sendBtn?.addEventListener('click', () => this.handleSendCode());
    this.verifyBtn?.addEventListener('click', () => this.handleVerify());
    this.backBtn?.addEventListener('click', () => this.goToStep(1));
    this.syncBtn?.addEventListener('click', () => this.handleSync());
    this.logoutBtn?.addEventListener('click', () => this.handleLogout());
    this.deleteAccountBtn?.addEventListener('click', () => this.handleDeleteAccount());

    // Tab 切换
    this.modal?.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.authTab));
    });

    // 密码登录
    this.loginPwdBtn?.addEventListener('click', () => this.handleLoginPassword());
    this.forgotPwdBtn?.addEventListener('click', () => this.goToStep('forgot'));

    // 忘记密码流程
    this.resetSendOtpBtn?.addEventListener('click', () => this.handleResetSendOtp());
    this.resetConfirmBtn?.addEventListener('click', () => this.handleResetPassword());
    this.resetBackBtn?.addEventListener('click', () => this.goToStep(1));

    // 个人资料页
    this.uploadAvatarBtn?.addEventListener('click', () => this.avatarFileInput?.click());
    this.avatarFileInput?.addEventListener('change', (e) => this.handleUploadAvatar(e));
    this.confirmAvatarBtn?.addEventListener('click', () => this.confirmUploadAvatar());
    this.cancelAvatarBtn?.addEventListener('click', () => this.cancelAvatarPreview());
    this.saveUsernameBtn?.addEventListener('click', () => this.handleSaveUsername());
    this.saveDisplayBtn?.addEventListener('click', () => this.handleSaveDisplay());
    this.changeEmailBtn?.addEventListener('click', () => this.toggleChangeEmailForm(true));
    this.cancelChangeEmailBtn?.addEventListener('click', () => this.toggleChangeEmailForm(false));
    this.sendEmailChangeOtpBtn?.addEventListener('click', () => this.handleChangeEmailSendOtp());
    this.confirmChangeEmailBtn?.addEventListener('click', () => this.handleChangeEmailVerify());
    this.togglePasswordBtn?.addEventListener('click', () => this.togglePasswordForm());

    // 静态密码 input：明文切换 + 强度条（仅忘记密码的新密码字段显示强度）
    this.modal?.querySelectorAll('.auth-tab-panel [data-pwd-toggle], #authStepForgot [data-pwd-toggle]').forEach(btn => {
      btn.addEventListener('click', () => this._togglePasswordVisibility(btn));
    });
    this.resetPwdInput?.addEventListener('input', () => this._updatePasswordStrength(this.resetPwdInput, this.pwdStrengthReset));

    // Enter 键提交
    this.emailInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.handleSendCode(); }
    });
    this.codeInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.handleVerify(); }
    });
    this.usernameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.handleVerify(); }
    });
    this.pwdInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.handleLoginPassword(); }
    });
    this.pwdEmailInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.pwdInput?.focus(); }
    });
    this.resetPwdInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.handleResetPassword(); }
    });
  },

  // 切换登录 Tab（OTP / 密码）
  switchTab(tabName) {
    this._activeTab = tabName;
    this.modal?.querySelectorAll('.auth-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.authTab === tabName);
    });
    this.modal?.querySelectorAll('.auth-tab-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.authPanel === tabName);
    });
    if (this.error1El) this.error1El.textContent = '';
    if (this.errorPwdEl) this.errorPwdEl.textContent = '';
  },

  open() {
    if (!this.modal) return;
    this.modal.classList.remove('hidden');
    if (AuthManager.isLoggedIn()) {
      this.goToStep(3);
      this.renderProfile();
    } else {
      this.goToStep(1);
      setTimeout(() => this.emailInput?.focus(), 100);
    }
  },

  close() { this.modal?.classList.add('hidden'); },

  goToStep(step) {
    [this.step1, this.step2, this.step3, this.stepForgot].forEach(el => el?.classList.remove('active'));
    let target;
    if (step === 1) target = this.step1;
    else if (step === 2) target = this.step2;
    else if (step === 3) target = this.step3;
    else if (step === 'forgot') target = this.stepForgot;
    target?.classList.add('active');
    // 三步进度点：step1→第1个点亮，step2→前2个点亮，step3→全部点亮，forgot→全部不点亮
    const dotCount = (step === 'forgot') ? 0 : step;
    this.stepDots.forEach((dot, i) => {
      dot.classList.toggle('active', i < dotCount);
    });
    // 离开 step2 时清理重发倒计时，避免回到 step1 时按钮仍被禁用
    if (step !== 2) this.clearResendCountdown();
    // 离开忘记密码步骤时清理其倒计时
    if (step !== 'forgot') this.clearResetResendCountdown();
    if (this.error1El) this.error1El.textContent = '';
    if (this.error2El) this.error2El.textContent = '';
    if (this.errorResetEl) this.errorResetEl.textContent = '';
    // 进入 step3 时拉取最新用户数据并渲染资料页
    if (step === 3) this.renderProfile();
  },

  // 渲染已登录用户的元信息（注册时间等）
  renderUserMeta() {
    if (!this.userMetaEl) return;
    const user = AuthManager.getUser();
    if (!user) { this.userMetaEl.textContent = '注册时间：—'; return; }
    const created = user.created_at;
    if (created) {
      // 兼容 ISO 字符串和 Date 对象
      const d = new Date(created);
      if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        this.userMetaEl.textContent = `注册时间：${yyyy}-${mm}-${dd}`;
      } else {
        this.userMetaEl.textContent = '注册时间：—';
      }
    } else {
      this.userMetaEl.textContent = '注册时间：—';
    }
  },

  startResendCountdown(seconds) {
    // 启动新倒计时前清理上一轮，避免多个 timer 叠加导致按钮状态错乱
    if (this.resendTimer) { clearTimeout(this.resendTimer); this.resendTimer = null; }
    let remain = seconds;
    this.sendBtn.disabled = true;
    // 从"发送中"过渡到"倒计时"：移除 loading 旋转指示器
    this.sendBtn.classList.remove('loading');
    const tick = () => {
      if (remain <= 0) {
        this.sendBtn.disabled = false;
        this.sendBtn.textContent = '重新发送';
        this.resendTimer = null;
        return;
      }
      this.sendBtn.textContent = `${remain}s 后重发`;
      remain--;
      this.resendTimer = setTimeout(tick, 1000);
    };
    tick();
  },

  // 取消正在进行的重发倒计时，恢复发送按钮
  clearResendCountdown() {
    if (this.resendTimer) { clearTimeout(this.resendTimer); this.resendTimer = null; }
    if (this.sendBtn) {
      this.sendBtn.disabled = false;
      this.sendBtn.classList.remove('loading');
      this.sendBtn.textContent = '发送验证码';
    }
  },

  async handleSendCode() {
    const email = (this.emailInput?.value || '').trim();
    if (!email) { this.error1El.textContent = '请输入邮箱'; return; }
    // 简单邮箱格式校验，最终以后端 Pydantic EmailStr 为准
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error1El.textContent = '邮箱格式不正确（如 player@example.com）';
      return;
    }
    this.sendBtn.disabled = true;
    this.sendBtn.classList.add('loading');
    this.sendBtn.textContent = '发送中...';
    try {
      const resp = await AuthManager.sendOTP(email);
      this._isNewUser = !!resp.is_new_user;
      this._currentEmail = email;
      this.error1El.textContent = '';
      this.goToStep(2);
      // 根据 新/老用户 切换 step2 UI
      this.applyStep2UI();
      showToast(this._isNewUser ? '欢迎新玩家！验证码已发送' : '欢迎回来！验证码已发送', 'info');
      setTimeout(() => this.codeInput?.focus(), 100);
      this.startResendCountdown(60);
    } catch (e) {
      this.error1El.textContent = e.message || '发送失败';
      this.sendBtn.disabled = false;
      this.sendBtn.classList.remove('loading');
      this.sendBtn.textContent = '发送验证码';
    }
  },

  // 根据新/老用户切换 step2 的用户名输入框显隐与文案
  applyStep2UI() {
    if (!this.usernameGroup) return;
    if (this._isNewUser) {
      this.usernameGroup.classList.remove('hidden');
      if (this.usernameLabel) this.usernameLabel.textContent = '设置用户名';
      if (this.usernameInput) this.usernameInput.placeholder = '3-20 字符，支持中英文/数字/下划线';
    } else {
      this.usernameGroup.classList.add('hidden');
      if (this.usernameInput) this.usernameInput.value = '';
    }
  },

  async handleVerify() {
    const email = (this.emailInput?.value || '').trim();
    const code = (this.codeInput?.value || '').trim();
    const username = (this.usernameInput?.value || '').trim();
    if (!code) { this.error2El.textContent = '请输入验证码'; return; }
    // 校验规则与后端对齐：^\d{6}$
    if (!/^\d{6}$/.test(code)) { this.error2El.textContent = '验证码应为 6 位数字'; return; }
    // 新用户必填用户名
    if (this._isNewUser && !username) {
      this.error2El.textContent = '请设置用户名';
      return;
    }

    this.verifyBtn.disabled = true;
    this.verifyBtn.classList.add('loading');
    this.verifyBtn.textContent = '验证中...';
    try {
      const data = await AuthManager.verifyOTP(email, code, username || undefined);
      this.verifyBtn.disabled = false;
      this.verifyBtn.classList.remove('loading');
      this.verifyBtn.textContent = '验证并登录';
      // toast 显示后端实际用户名（可能因冲突被加后缀）
      const actualName = data.user?.username || username || '玩家';
      showToast(`欢迎，${actualName}！登录成功`, 'info');
      this.refreshMenuButton();
      // goToStep(3) 会自动调用 renderProfile() 拉取最新用户数据
      this.goToStep(3);
      // 登录后串行执行：先保存本地进度到云端，再拉取云端进度合并到本地
      // 并发执行会导致 save 与 load 互相竞争，可能出现合并丢失
      (async () => {
        try {
          await CloudSync.saveProgress();
          await CloudSync.flushPending();
          const cloudData = await CloudSync.loadProgress();
          if (cloudData) {
            const changed = CloudSync.mergeAndApply(cloudData);
            if (changed) {
              this._applyCloudChanges();
              showToast('云端进度已同步到本地', 'info');
            }
          }
        } catch (e) { /* 同步失败不阻塞登录流程 */ }
        NetworkIndicator.probe();
      })();
    } catch (e) {
      this.error2El.textContent = e.message || '验证失败';
      this.verifyBtn.disabled = false;
      this.verifyBtn.classList.remove('loading');
      this.verifyBtn.textContent = '验证并登录';
    }
  },

  // ===== 密码登录 =====
  async handleLoginPassword() {
    const email = (this.pwdEmailInput?.value || '').trim();
    const password = this.pwdInput?.value || '';
    if (!email) { this.errorPwdEl.textContent = '请输入邮箱'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorPwdEl.textContent = '邮箱格式不正确';
      return;
    }
    if (!password) { this.errorPwdEl.textContent = '请输入密码'; return; }
    if (password.length < 8 || password.length > 64) {
      this.errorPwdEl.textContent = '密码长度需 8-64 位';
      return;
    }

    this.loginPwdBtn.disabled = true;
    this.loginPwdBtn.classList.add('loading');
    this.loginPwdBtn.textContent = '登录中...';
    try {
      const data = await AuthManager.loginWithPassword(email, password);
      this.loginPwdBtn.disabled = false;
      this.loginPwdBtn.classList.remove('loading');
      this.loginPwdBtn.textContent = '登录';
      const actualName = data.user?.username || '玩家';
      showToast(`欢迎，${actualName}！登录成功`, 'info');
      this.refreshMenuButton();
      this.goToStep(3);
      // 同步云端进度（同 OTP 登录流程）
      (async () => {
        try {
          await CloudSync.saveProgress();
          await CloudSync.flushPending();
          const cloudData = await CloudSync.loadProgress();
          if (cloudData) {
            const changed = CloudSync.mergeAndApply(cloudData);
            if (changed) {
              this._applyCloudChanges();
              showToast('云端进度已同步到本地', 'info');
            }
          }
        } catch (e) { /* 同步失败不阻塞登录流程 */ }
        NetworkIndicator.probe();
      })();
    } catch (e) {
      this.errorPwdEl.textContent = e.message || '登录失败';
      this.loginPwdBtn.disabled = false;
      this.loginPwdBtn.classList.remove('loading');
      this.loginPwdBtn.textContent = '登录';
    }
  },

  // ===== 忘记密码流程 =====
  async handleResetSendOtp() {
    const email = (this.resetEmailInput?.value || '').trim();
    if (!email) { this.errorResetEl.textContent = '请输入邮箱'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorResetEl.textContent = '邮箱格式不正确';
      return;
    }
    this.resetSendOtpBtn.disabled = true;
    this.resetSendOtpBtn.classList.add('loading');
    this.resetSendOtpBtn.textContent = '发送中...';
    try {
      await AuthManager.sendOTP(email);
      this.errorResetEl.textContent = '';
      showToast('验证码已发送', 'info');
      this.startResetResendCountdown(60);
      setTimeout(() => this.resetCodeInput?.focus(), 100);
    } catch (e) {
      this.errorResetEl.textContent = e.message || '发送失败';
      this.resetSendOtpBtn.disabled = false;
      this.resetSendOtpBtn.classList.remove('loading');
      this.resetSendOtpBtn.textContent = '发送验证码';
    }
  },

  startResetResendCountdown(seconds) {
    if (this.resetResendTimer) { clearTimeout(this.resetResendTimer); this.resetResendTimer = null; }
    let remain = seconds;
    if (this.resetSendOtpBtn) {
      this.resetSendOtpBtn.disabled = true;
      this.resetSendOtpBtn.classList.remove('loading');
    }
    const tick = () => {
      if (remain <= 0) {
        if (this.resetSendOtpBtn) {
          this.resetSendOtpBtn.disabled = false;
          this.resetSendOtpBtn.textContent = '重新发送';
        }
        this.resetResendTimer = null;
        return;
      }
      if (this.resetSendOtpBtn) this.resetSendOtpBtn.textContent = `${remain}s 后重发`;
      remain--;
      this.resetResendTimer = setTimeout(tick, 1000);
    };
    tick();
  },

  clearResetResendCountdown() {
    if (this.resetResendTimer) { clearTimeout(this.resetResendTimer); this.resetResendTimer = null; }
    if (this.resetSendOtpBtn) {
      this.resetSendOtpBtn.disabled = false;
      this.resetSendOtpBtn.classList.remove('loading');
      this.resetSendOtpBtn.textContent = '发送验证码';
    }
  },

  async handleResetPassword() {
    const email = (this.resetEmailInput?.value || '').trim();
    const code = (this.resetCodeInput?.value || '').trim();
    const newPassword = this.resetPwdInput?.value || '';
    if (!email) { this.errorResetEl.textContent = '请输入邮箱'; return; }
    if (!/^\d{6}$/.test(code)) { this.errorResetEl.textContent = '验证码应为 6 位数字'; return; }
    if (newPassword.length < 8 || newPassword.length > 64) {
      this.errorResetEl.textContent = '密码长度需 8-64 位';
      return;
    }

    this.resetConfirmBtn.disabled = true;
    this.resetConfirmBtn.classList.add('loading');
    this.resetConfirmBtn.textContent = '重置中...';
    try {
      await AuthManager.resetPassword(email, code, newPassword);
      showToast('密码已重置，请使用新密码登录', 'info');
      // 清空忘记密码表单
      if (this.resetEmailInput) this.resetEmailInput.value = '';
      if (this.resetCodeInput) this.resetCodeInput.value = '';
      if (this.resetPwdInput) this.resetPwdInput.value = '';
      // 预填密码登录 Tab 的邮箱，引导用户用密码登录
      if (this.pwdEmailInput) this.pwdEmailInput.value = email;
      this.switchTab('password');
      this.goToStep(1);
      setTimeout(() => this.pwdInput?.focus(), 100);
    } catch (e) {
      this.errorResetEl.textContent = e.message || '重置失败';
      this.resetConfirmBtn.disabled = false;
      this.resetConfirmBtn.classList.remove('loading');
      this.resetConfirmBtn.textContent = '重置密码';
    }
  },

  async handleSync() {
    if (!AuthManager.isLoggedIn()) return;
    this.syncBtn.disabled = true;
    this.syncBtn.classList.add('loading');
    this.syncBtn.textContent = '同步中...';
    try {
      await CloudSync.saveProgress();
      const cloudData = await CloudSync.loadProgress();
      let applied = false;
      if (cloudData) {
        const changed = CloudSync.mergeAndApply(cloudData);
        if (changed) {
          this._applyCloudChanges();
          applied = true;
        }
      }
      showToast(applied ? '同步完成，云端进度已应用' : '同步完成', 'info');
    } catch (e) {
      showToast(e.message || '同步失败，请稍后重试', 'warning');
    } finally {
      this.syncBtn.disabled = false;
      this.syncBtn.classList.remove('loading');
      this.syncBtn.textContent = '立即同步进度';
    }
  },

  async handleLogout() {
    this.logoutBtn.disabled = true;
    this.logoutBtn.classList.add('loading');
    this.logoutBtn.textContent = '退出中...';
    try {
      await AuthManager.logout();
    } catch (e) { /* logout 内部已处理 */ }
    this.logoutBtn.disabled = false;
    this.logoutBtn.classList.remove('loading');
    this.logoutBtn.textContent = '退出登录';
    this.refreshMenuButton();
    this.goToStep(1);
    showToast('已退出登录', 'info');
  },

  async handleUpdateProfile() {
    // 已废弃：被 handleSaveUsername / handleSaveDisplay 取代
    // 保留空函数避免外部调用报错
  },

  // ===== 个人资料页 =====
  // 拉取最新用户数据并渲染整个资料页（头像/用户名/邮箱/密码状态）
  async renderProfile() {
    if (!AuthManager.isLoggedIn()) return;
    // 拉取最新用户信息（确保 has_password / avatar_url 等字段最新）
    await AuthManager.fetchMe();
    const user = AuthManager.getUser();
    if (!user) return;

    this.renderUserMeta();
    this.updateAvatarDisplay();

    // 用户名 / 显示名输入框预填当前值
    if (this.profileUsernameInput) this.profileUsernameInput.value = user.username || '';
    if (this.profileDisplayInput) this.profileDisplayInput.value = user.display_name || user.username || '';

    // 邮箱
    if (this.profileEmailText) this.profileEmailText.textContent = user.email || '—';

    // 密码按钮文案 + 重置密码表单
    const hasPassword = !!user.has_password;
    if (this.togglePasswordBtn) {
      this.togglePasswordBtn.textContent = hasPassword ? '修改密码' : '设置密码';
    }
    if (this.passwordForm) {
      this.passwordForm.classList.add('hidden');
      this.passwordForm.innerHTML = '';
    }

    // 登录用户名显示
    const userEl = document.getElementById('loggedInUser');
    if (userEl) userEl.textContent = user.username || '玩家';
  },

  // 更新头像显示（图片或首字母 fallback）
  updateAvatarDisplay() {
    const user = AuthManager.getUser();
    const avatarUrl = user?.avatar_url;
    if (avatarUrl && this.profileAvatar) {
      // 加 ?v= 时间戳击穿浏览器缓存（同一文件名 {user_id}.png 内容已更新）
      const sep = avatarUrl.includes('?') ? '&' : '?';
      this.profileAvatar.src = `${avatarUrl}${sep}v=${Date.now()}`;
      this.profileAvatar.classList.remove('hidden');
      if (this.profileAvatarFallback) this.profileAvatarFallback.classList.add('hidden');
    } else {
      if (this.profileAvatar) this.profileAvatar.classList.add('hidden');
      if (this.profileAvatarFallback) {
        this.profileAvatarFallback.classList.remove('hidden');
        const name = AuthManager.getUsername() || '玩';
        this.profileAvatarFallback.textContent = name.charAt(0).toUpperCase();
      }
    }
  },

  async handleUploadAvatar(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    // 重置 input value 允许重复选择同一文件
    e.target.value = '';
    // 客户端预校验
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showToast('仅支持 JPEG / PNG / WebP 格式', 'warning');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片大小不能超过 5MB', 'warning');
      return;
    }
    // 进入预览模式：显示本地缩略图 + 确认/取消按钮
    this._pendingAvatarFile = file;
    this._pendingAvatarUrl = URL.createObjectURL(file);
    this._showAvatarPreview(this._pendingAvatarUrl);
  },

  _showAvatarPreview(url) {
    if (this.profileAvatar && this._pendingAvatarUrl) {
      this.profileAvatar.src = url;
      this.profileAvatar.classList.remove('hidden');
      if (this.profileAvatarFallback) this.profileAvatarFallback.classList.add('hidden');
    }
    if (this.avatarPreviewActions) this.avatarPreviewActions.classList.remove('hidden');
    this.uploadAvatarBtn?.classList.add('hidden');
  },

  _hideAvatarPreview() {
    if (this.avatarPreviewActions) this.avatarPreviewActions.classList.add('hidden');
    this.uploadAvatarBtn?.classList.remove('hidden');
  },

  _cleanupPendingAvatar() {
    if (this._pendingAvatarUrl) {
      URL.revokeObjectURL(this._pendingAvatarUrl);
      this._pendingAvatarUrl = null;
    }
    this._pendingAvatarFile = null;
  },

  async confirmUploadAvatar() {
    if (!this._pendingAvatarFile) return;
    this.uploadAvatarBtn?.classList.add('loading');
    this._hideAvatarPreview();
    try {
      await AuthManager.uploadAvatar(this._pendingAvatarFile);
      this.updateAvatarDisplay();
      this.refreshMenuButton();
      showToast('头像已更新', 'info');
    } catch (err) {
      showToast(err.message || '头像上传失败', 'warning');
      this.updateAvatarDisplay(); // 恢复原头像
    } finally {
      this.uploadAvatarBtn?.classList.remove('loading');
      this._cleanupPendingAvatar();
    }
  },

  cancelAvatarPreview() {
    this._hideAvatarPreview();
    this.updateAvatarDisplay(); // 恢复原头像
    this._cleanupPendingAvatar();
  },

  async handleSaveUsername() {
    if (!AuthManager.isLoggedIn()) return;
    const newName = (this.profileUsernameInput?.value || '').trim();
    if (!newName) { showToast('用户名不能为空', 'warning'); return; }
    if (newName.length < 3 || newName.length > 20) {
      showToast('用户名长度需 3-20 字符', 'warning');
      return;
    }
    if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(newName)) {
      showToast('用户名仅支持中英文/数字/下划线', 'warning');
      return;
    }
    if (newName === AuthManager.getUsername()) { showToast('用户名未变化', 'info'); return; }

    this.saveUsernameBtn.disabled = true;
    this.saveUsernameBtn.classList.add('loading');
    this.saveUsernameBtn.textContent = '...';
    try {
      const resp = await APIClient.put('/auth/profile', { username: newName });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const msg = resp.status === 409 ? '用户名已被占用' : (data.detail || '修改失败');
        showToast(msg, 'warning');
        return;
      }
      const user = await resp.json();
      AuthManager.state.user = user;
      AuthManager._save();
      this.refreshMenuButton();
      const userEl = document.getElementById('loggedInUser');
      if (userEl) userEl.textContent = user.username || '玩家';
      showToast(`用户名已修改为 ${user.username}`, 'info');
    } catch (e) {
      showToast(e.message || '修改失败', 'warning');
    } finally {
      this.saveUsernameBtn.disabled = false;
      this.saveUsernameBtn.classList.remove('loading');
      this.saveUsernameBtn.textContent = '保存';
    }
  },

  async handleSaveDisplay() {
    if (!AuthManager.isLoggedIn()) return;
    const newDisplay = (this.profileDisplayInput?.value || '').trim();
    if (!newDisplay) { showToast('显示名不能为空', 'warning'); return; }
    if (newDisplay.length > 50) { showToast('显示名最长 50 字符', 'warning'); return; }
    if (newDisplay === (AuthManager.getUser()?.display_name || AuthManager.getUsername())) {
      showToast('显示名未变化', 'info');
      return;
    }

    this.saveDisplayBtn.disabled = true;
    this.saveDisplayBtn.classList.add('loading');
    this.saveDisplayBtn.textContent = '...';
    try {
      const resp = await APIClient.put('/auth/profile', { display_name: newDisplay });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        showToast(data.detail || '修改失败', 'warning');
        return;
      }
      const user = await resp.json();
      AuthManager.state.user = user;
      AuthManager._save();
      showToast('显示名已更新', 'info');
    } catch (e) {
      showToast(e.message || '修改失败', 'warning');
    } finally {
      this.saveDisplayBtn.disabled = false;
      this.saveDisplayBtn.classList.remove('loading');
      this.saveDisplayBtn.textContent = '保存';
    }
  },

  // ===== 邮箱变更 =====
  toggleChangeEmailForm(show) {
    if (!this.changeEmailForm) return;
    this.changeEmailForm.classList.toggle('hidden', !show);
    if (show) {
      this.clearEmailChangeResendCountdown();
      if (this.newEmailInput) this.newEmailInput.value = '';
      if (this.emailCodeInput) this.emailCodeInput.value = '';
      setTimeout(() => this.newEmailInput?.focus(), 100);
    }
  },

  async handleChangeEmailSendOtp() {
    const newEmail = (this.newEmailInput?.value || '').trim();
    if (!newEmail) { showToast('请输入新邮箱', 'warning'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('邮箱格式不正确', 'warning');
      return;
    }

    this.sendEmailChangeOtpBtn.disabled = true;
    this.sendEmailChangeOtpBtn.classList.add('loading');
    this.sendEmailChangeOtpBtn.textContent = '发送中...';
    try {
      await AuthManager.changeEmailSendOtp(newEmail);
      showToast('验证码已发送至新邮箱', 'info');
      this.startEmailChangeResendCountdown(60);
      setTimeout(() => this.emailCodeInput?.focus(), 100);
    } catch (e) {
      showToast(e.message || '发送失败', 'warning');
      this.sendEmailChangeOtpBtn.disabled = false;
      this.sendEmailChangeOtpBtn.classList.remove('loading');
      this.sendEmailChangeOtpBtn.textContent = '发送';
    }
  },

  startEmailChangeResendCountdown(seconds) {
    if (this.emailChangeResendTimer) { clearTimeout(this.emailChangeResendTimer); this.emailChangeResendTimer = null; }
    let remain = seconds;
    if (this.sendEmailChangeOtpBtn) {
      this.sendEmailChangeOtpBtn.disabled = true;
      this.sendEmailChangeOtpBtn.classList.remove('loading');
    }
    const tick = () => {
      if (remain <= 0) {
        if (this.sendEmailChangeOtpBtn) {
          this.sendEmailChangeOtpBtn.disabled = false;
          this.sendEmailChangeOtpBtn.textContent = '重新发送';
        }
        this.emailChangeResendTimer = null;
        return;
      }
      if (this.sendEmailChangeOtpBtn) this.sendEmailChangeOtpBtn.textContent = `${remain}s 后重发`;
      remain--;
      this.emailChangeResendTimer = setTimeout(tick, 1000);
    };
    tick();
  },

  clearEmailChangeResendCountdown() {
    if (this.emailChangeResendTimer) { clearTimeout(this.emailChangeResendTimer); this.emailChangeResendTimer = null; }
    if (this.sendEmailChangeOtpBtn) {
      this.sendEmailChangeOtpBtn.disabled = false;
      this.sendEmailChangeOtpBtn.classList.remove('loading');
      this.sendEmailChangeOtpBtn.textContent = '发送';
    }
  },

  async handleChangeEmailVerify() {
    const newEmail = (this.newEmailInput?.value || '').trim();
    const code = (this.emailCodeInput?.value || '').trim();
    if (!newEmail) { showToast('请输入新邮箱', 'warning'); return; }
    if (!/^\d{6}$/.test(code)) { showToast('验证码应为 6 位数字', 'warning'); return; }

    this.confirmChangeEmailBtn.disabled = true;
    this.confirmChangeEmailBtn.classList.add('loading');
    this.confirmChangeEmailBtn.textContent = '...';
    try {
      await AuthManager.changeEmailVerify(newEmail, code);
      showToast('邮箱已更换', 'info');
      this.toggleChangeEmailForm(false);
      // 重新拉取最新用户信息并刷新整个资料页（含菜单按钮头像/用户名/邮箱）
      await this.renderProfile();
      this.refreshMenuButton();
    } catch (e) {
      showToast(e.message || '邮箱变更失败', 'warning');
    } finally {
      this.confirmChangeEmailBtn.disabled = false;
      this.confirmChangeEmailBtn.classList.remove('loading');
      this.confirmChangeEmailBtn.textContent = '确认更换';
    }
  },

  // ===== 密码设置 / 修改 =====
  togglePasswordForm() {
    if (!this.passwordForm) return;
    const isHidden = this.passwordForm.classList.contains('hidden');
    if (isHidden) {
      // 展开表单：根据 has_password 决定显示"设置"还是"修改"
      const hasPassword = !!AuthManager.getUser()?.has_password;
      this.passwordForm.innerHTML = hasPassword
        ? this._renderChangePasswordForm()
        : this._renderSetPasswordForm();
      this.passwordForm.classList.remove('hidden');
      // 绑定按钮事件
      const submitBtn = this.passwordForm.querySelector('[data-pwd-submit]');
      submitBtn?.addEventListener('click', () => {
        if (hasPassword) this.handleChangePassword();
        else this.handleSetPassword();
      });
      // Enter 键提交
      this.passwordForm.querySelectorAll('input').forEach(input => {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); submitBtn?.click(); }
        });
      });
      // 明文/密文切换按钮
      this.passwordForm.querySelectorAll('[data-pwd-toggle]').forEach(btn => {
        btn.addEventListener('click', () => this._togglePasswordVisibility(btn));
      });
      // 新密码强度条
      const newPwdInput = this.passwordForm.querySelector('[data-pwd-field="new"]');
      const strengthIndicator = this.passwordForm.querySelector('[data-pwd-strength]');
      if (newPwdInput && strengthIndicator) {
        newPwdInput.addEventListener('input', () => this._updatePasswordStrength(newPwdInput, strengthIndicator));
      }
    } else {
      // 收起表单
      this.passwordForm.classList.add('hidden');
      this.passwordForm.innerHTML = '';
    }
  },

  // 密码强度计算：返回 { score: 0-3, label, class }
  _computePasswordStrength(pwd) {
    if (!pwd) return { score: 0, label: '', class: '' };
    if (pwd.length < 8) return { score: 0, label: '太短', class: 'weak' };
    let variety = 0;
    if (/[a-z]/.test(pwd)) variety++;
    if (/[A-Z]/.test(pwd)) variety++;
    if (/[0-9]/.test(pwd)) variety++;
    if (/[^a-zA-Z0-9]/.test(pwd)) variety++;
    if (pwd.length >= 12 && variety >= 3) return { score: 3, label: '强', class: 'strong' };
    if (pwd.length >= 10 && variety >= 2) return { score: 2, label: '中', class: 'medium' };
    return { score: 1, label: '弱', class: 'weak' };
  },

  _updatePasswordStrength(inputEl, indicatorEl) {
    if (!inputEl || !indicatorEl) return;
    const pwd = inputEl.value;
    const { score, label, class: cls } = this._computePasswordStrength(pwd);
    if (!pwd) { indicatorEl.hidden = true; return; }
    indicatorEl.hidden = false;
    const segs = indicatorEl.querySelectorAll('.pwd-seg');
    segs.forEach((seg, i) => {
      seg.classList.toggle('active', i < score);
      seg.classList.toggle('weak', cls === 'weak');
      seg.classList.toggle('medium', cls === 'medium');
      seg.classList.toggle('strong', cls === 'strong');
    });
    const labelEl = indicatorEl.querySelector('.pwd-strength-label');
    if (labelEl) labelEl.textContent = label;
  },

  _togglePasswordVisibility(btnEl) {
    const wrapper = btnEl.closest('.pwd-input-wrapper');
    const input = wrapper?.querySelector('input');
    if (!input) return;
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    const icon = btnEl.querySelector('i');
    if (icon) icon.className = isPwd ? 'fas fa-eye-slash' : 'fas fa-eye';
    btnEl.setAttribute('aria-label', isPwd ? '隐藏密码' : '显示密码');
  },

  _renderSetPasswordForm() {
    return `
      <div class="auth-input-group">
        <label>新密码</label>
        <div class="pwd-input-wrapper">
          <input type="password" class="auth-input" data-pwd-field="new" placeholder="8-64 位" autocomplete="new-password">
          <button type="button" class="pwd-visibility-toggle" data-pwd-toggle aria-label="显示密码"><i class="fas fa-eye"></i></button>
        </div>
        <div class="pwd-strength" data-pwd-strength hidden>
          <div class="pwd-strength-segments">
            <span class="pwd-seg"></span><span class="pwd-seg"></span><span class="pwd-seg"></span>
          </div>
          <span class="pwd-strength-label"></span>
        </div>
      </div>
      <div class="auth-input-group">
        <label>确认密码</label>
        <div class="pwd-input-wrapper">
          <input type="password" class="auth-input" data-pwd-field="confirm" placeholder="再次输入" autocomplete="new-password">
          <button type="button" class="pwd-visibility-toggle" data-pwd-toggle aria-label="显示密码"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <button type="button" class="btn btn-sm" data-pwd-submit>设置密码</button>
    `;
  },

  _renderChangePasswordForm() {
    return `
      <div class="auth-input-group">
        <label>旧密码</label>
        <div class="pwd-input-wrapper">
          <input type="password" class="auth-input" data-pwd-field="old" placeholder="当前密码" autocomplete="current-password">
          <button type="button" class="pwd-visibility-toggle" data-pwd-toggle aria-label="显示密码"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div class="auth-input-group">
        <label>新密码</label>
        <div class="pwd-input-wrapper">
          <input type="password" class="auth-input" data-pwd-field="new" placeholder="8-64 位" autocomplete="new-password">
          <button type="button" class="pwd-visibility-toggle" data-pwd-toggle aria-label="显示密码"><i class="fas fa-eye"></i></button>
        </div>
        <div class="pwd-strength" data-pwd-strength hidden>
          <div class="pwd-strength-segments">
            <span class="pwd-seg"></span><span class="pwd-seg"></span><span class="pwd-seg"></span>
          </div>
          <span class="pwd-strength-label"></span>
        </div>
      </div>
      <div class="auth-input-group">
        <label>确认新密码</label>
        <div class="pwd-input-wrapper">
          <input type="password" class="auth-input" data-pwd-field="confirm" placeholder="再次输入" autocomplete="new-password">
          <button type="button" class="pwd-visibility-toggle" data-pwd-toggle aria-label="显示密码"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <button type="button" class="btn btn-sm" data-pwd-submit>修改密码</button>
    `;
  },

  async handleSetPassword() {
    const form = this.passwordForm;
    if (!form) return;
    const newPassword = form.querySelector('[data-pwd-field="new"]')?.value || '';
    const confirmPassword = form.querySelector('[data-pwd-field="confirm"]')?.value || '';
    if (newPassword.length < 8 || newPassword.length > 64) {
      showToast('密码长度需 8-64 位', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的密码不一致', 'warning');
      return;
    }

    const submitBtn = form.querySelector('[data-pwd-submit]');
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    submitBtn.textContent = '...';
    try {
      await AuthManager.setPassword(newPassword);
      showToast('密码已设置', 'info');
      // 更新按钮文案 + 收起表单
      if (this.togglePasswordBtn) this.togglePasswordBtn.textContent = '修改密码';
      this.passwordForm.classList.add('hidden');
      this.passwordForm.innerHTML = '';
    } catch (e) {
      showToast(e.message || '设置密码失败', 'warning');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      submitBtn.textContent = '设置密码';
    }
  },

  async handleChangePassword() {
    const form = this.passwordForm;
    if (!form) return;
    const oldPassword = form.querySelector('[data-pwd-field="old"]')?.value || '';
    const newPassword = form.querySelector('[data-pwd-field="new"]')?.value || '';
    const confirmPassword = form.querySelector('[data-pwd-field="confirm"]')?.value || '';
    if (!oldPassword) { showToast('请输入旧密码', 'warning'); return; }
    if (newPassword.length < 8 || newPassword.length > 64) {
      showToast('新密码长度需 8-64 位', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次输入的新密码不一致', 'warning');
      return;
    }
    if (newPassword === oldPassword) { showToast('新密码不能与旧密码相同', 'warning'); return; }

    const submitBtn = form.querySelector('[data-pwd-submit]');
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    submitBtn.textContent = '...';
    try {
      await AuthManager.changePassword(oldPassword, newPassword);
      showToast('密码已修改', 'info');
      // 收起表单
      this.passwordForm.classList.add('hidden');
      this.passwordForm.innerHTML = '';
    } catch (e) {
      showToast(e.message || '修改密码失败', 'warning');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      submitBtn.textContent = '修改密码';
    }
  },

  async handleDeleteAccount() {
    if (!AuthManager.isLoggedIn()) return;
    const confirmed = window.confirm(
      '确定要注销账号吗？此操作不可恢复，所有进度、成就、皮肤和排行榜记录将被永久删除。'
    );
    if (!confirmed) return;
    // 二次确认
    const confirmed2 = window.confirm('再次确认：真的要永久删除账号吗？');
    if (!confirmed2) return;

    this.deleteAccountBtn.disabled = true;
    this.deleteAccountBtn.classList.add('loading');
    this.deleteAccountBtn.textContent = '注销中...';
    try {
      const resp = await APIClient.request('/auth/account?confirm=true', { method: 'DELETE' });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        showToast(data.detail || '注销失败', 'warning');
        return;
      }
      // 清本地状态（不调服务端 logout，账号已删除）
      AuthManager._clearLocal();
      this.refreshMenuButton();
      this.goToStep(1);
      showToast('账号已注销', 'info');
    } catch (e) {
      showToast(e.message || '注销失败', 'warning');
    } finally {
      this.deleteAccountBtn.disabled = false;
      this.deleteAccountBtn.classList.remove('loading');
      this.deleteAccountBtn.textContent = '注销账号';
    }
  },

  refreshMenuButton() {
    if (!this.menuBtn) return;
    if (AuthManager.isLoggedIn()) {
      const name = AuthManager.getUsername() || '玩家';
      const user = AuthManager.getUser();
      const avatarUrl = user?.avatar_url;
      this.menuBtn.classList.add('logged-in');
      // 有头像显示图片，无头像显示首字母 fallback
      if (avatarUrl) {
        const sep = avatarUrl.includes('?') ? '&' : '?';
        this.menuBtn.innerHTML = `<img class="user-avatar user-avatar-img" src="${avatarUrl}${sep}v=${Date.now()}" alt=""><span class="user-name-text">${name}</span>`;
      } else {
        this.menuBtn.innerHTML = `<span class="user-avatar">${name.charAt(0).toUpperCase()}</span><span class="user-name-text">${name}</span>`;
      }
      this.menuBtn.setAttribute('aria-label', `已登录：${name}`);
    } else {
      this.menuBtn.classList.remove('logged-in');
      this.menuBtn.innerHTML = `<i class="fas fa-user"></i><span class="user-name-text">登录</span>`;
      this.menuBtn.setAttribute('aria-label', '登录账户');
    }
  },

  // 云端进度合并后刷新皮肤/成就 UI（通过注入的游戏回调）
  _applyCloudChanges() {
    const cb = this._gameCallbacks;
    if (!cb) return;
    cb.loadSkins?.();
    cb.applySkin?.(safeGetItem(CONFIG.STORAGE_KEYS.CURRENT_SKIN, 'classic') || 'classic');
    cb.renderSkinsUI?.();
    cb.renderAchievementsUI?.();
  }
};
