// ============ 游戏主逻辑 ============
import { REGION_LENGTH, CONFIG, REGION_CONFIG, COLORS } from '../core/config.js';
import { safeGetItem, safeParseJSON, safeSetItem } from '../core/storage.js';
import { showToast, hexToCss } from '../core/utils.js';
import { APIClient } from '../services/api-client.js';
import { AuthManager } from '../services/auth.js';
import { CloudSync } from '../services/cloud-sync.js';
import { ChallengeCloud } from '../services/challenge-cloud.js';
import { NetworkIndicator } from '../services/network-indicator.js';
import { AuthUI } from '../ui/auth-ui.js';

/* global THREE */  // Three.js r128 通过 CDN 全局加载

// ============ URL种子检测（可分享链接） ============
// 支持两种格式：
//   旧版：?seed=BASE36&s=分数&c=连击（种子直传）
//   新版：?c=ABC123（6 位云端短码，需后端解析）
let isChallengeMode = false;
let challengeData = null;
let challengeCloudCode = null; // 短码（?c=ABC123）
const urlParams = new URLSearchParams(window.location.search);
const urlSeed = urlParams.get('seed');
const urlScore = urlParams.get('s');
const urlCombo = urlParams.get('c');
const urlShortCode = urlCombo && urlSeed ? null : urlCombo; // 仅无 seed 时把 c 视为短码

if (urlSeed) {
  // 旧版种子直传
  const parsedSeed = parseInt(urlSeed, 36);
  if (!isNaN(parsedSeed)) {
    isChallengeMode = true;
    challengeData = {
      seed: parsedSeed,
      score: urlScore ? parseInt(urlScore) : 0,
      combo: urlCombo ? parseInt(urlCombo) : 0  // 旧版 c 是连击数
    };
  }
} else if (urlShortCode && /^[A-Za-z0-9]{4,12}$/.test(urlShortCode)) {
  // 新版云端短码：标记挑战模式，待 ChallengeCloud 模块就绪后异步加载详情
  challengeCloudCode = urlShortCode.toUpperCase();
  isChallengeMode = true;
  challengeData = { seed: 0, score: 0, combo: 0, pendingCloudCode: true };
}

// ============ POWERUP 配置 ============
// 道具颜色映射（单一数据源，供材质/粒子/指示器共用）
const POWERUP_COLORS = {
  energy: COLORS.PRIMARY,
  invincible: COLORS.WARM,
  shield: COLORS.SHIELD,
  magnet: COLORS.MAGNET,
  boost: COLORS.BOOST
};

// 道具指示器文案表（颜色从 POWERUP_COLORS 派生，避免重复硬编码）
const POWERUP_INDICATORS = {
  energy:     '能量充满 FULL ENERGY',
  invincible: '神速无敌 INVINCIBLE',
  shield:     '护盾充能 SHIELD ON',
  magnet:     '磁力吸引 MAGNET ON',
  boost:      '超速冲刺 HYPERDRIVE'
};

// 震动反馈模式
const HAPTIC_PATTERNS = {
  wallSwitch: 15,
  jump: [20, 10, 20],
  collision: 20,
  damage: [15, 5, 25]
};

// ============ 音频系统 ============
// ===== 音乐预设：5 区域 × 3 情绪 + 菜单 =====
// 频率单位 Hz，null 表示休止
// drums: 'none'|'soft'|'mid'|'full' 控制鼓组活跃度
const MUSIC_PRESETS = {
  // Zone 1 霓虹起点：A 小调，明亮电子，triangle lead
  zone1: {
    ambient: {
      bpm: 88,
      bass: [110, null, null, null, 110, null, null, null, 146.83, null, null, null, 98, null, null, null],
      lead: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      arp: [220, 261.63, 329.63, 440, 220, 261.63, 329.63, 440, 220, 261.63, 329.63, 440, 220, 261.63, 329.63, 440],
      pad: [[220, 261.63, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 293.66]],
      drums: 'none', leadType: 'triangle', bassType: 'sine'
    },
    cruise: {
      bpm: 110,
      bass: [110, null, 110, null, 146.83, null, 146.83, null, 98, null, 98, null, 110, null, 110, null],
      lead: [440, null, null, 523.25, null, 659.25, null, null, 587.33, null, null, 523.25, null, 440, null, null],
      arp: [220, 329.63, 440, 523.25, 220, 329.63, 440, 523.25, 196, 293.66, 392, 493.88, 220, 329.63, 440, 523.25],
      pad: [[220, 261.63, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 293.66]],
      drums: 'mid', leadType: 'triangle', bassType: 'sawtooth'
    },
    intense: {
      bpm: 140,
      bass: [110, 110, 146.83, 146.83, 98, 98, 110, 110, 110, 110, 146.83, 146.83, 98, 98, 110, 110],
      lead: [440, 523.25, 659.25, 880, 659.25, 523.25, 440, 587.33, 523.25, 659.25, 880, 1046.50, 880, 659.25, 523.25, 440],
      arp: [440, 523.25, 659.25, 880, 440, 523.25, 659.25, 880, 392, 493.88, 587.33, 783.99, 440, 523.25, 659.25, 880],
      pad: [[220, 261.63, 329.63, 440], [196, 246.94, 293.66, 392], [174.61, 220, 261.63, 349.23], [196, 246.94, 293.66, 392]],
      drums: 'full', leadType: 'triangle', bassType: 'sawtooth'
    }
  },
  // Zone 2 脉冲幽谷：D Phrygian，深沉神秘，sine lead + sub bass
  zone2: {
    ambient: {
      bpm: 84,
      bass: [73.42, null, null, null, 73.42, null, null, null, 69.30, null, null, null, 65.41, null, null, null],
      lead: [null, null, null, null, null, null, 293.66, null, null, null, null, null, null, 261.63, null, null],
      arp: [146.83, 174.61, 220, 293.66, 146.83, 174.61, 220, 293.66, 138.59, 174.61, 220, 277.18, 130.81, 174.61, 220, 261.63],
      pad: [[146.83, 174.61, 220], [138.59, 174.61, 220], [130.81, 174.61, 220], [138.59, 174.61, 220]],
      drums: 'none', leadType: 'sine', bassType: 'sine'
    },
    cruise: {
      bpm: 104,
      bass: [73.42, null, 73.42, null, 69.30, null, 69.30, null, 65.41, null, 65.41, null, 73.42, null, 73.42, null],
      lead: [293.66, null, null, 349.23, null, 392, null, null, 329.63, null, null, 293.66, null, 261.63, null, null],
      arp: [146.83, 220, 293.66, 349.23, 146.83, 220, 293.66, 349.23, 138.59, 220, 277.18, 349.23, 130.81, 220, 261.63, 329.63],
      pad: [[146.83, 174.61, 220], [138.59, 174.61, 220], [130.81, 174.61, 220], [138.59, 174.61, 220]],
      drums: 'mid', leadType: 'sine', bassType: 'sine'
    },
    intense: {
      bpm: 132,
      bass: [73.42, 73.42, 69.30, 69.30, 65.41, 65.41, 73.42, 73.42, 73.42, 73.42, 69.30, 69.30, 65.41, 65.41, 73.42, 73.42],
      lead: [293.66, 349.23, 392, 466.16, 392, 349.23, 293.66, 329.63, 349.23, 392, 466.16, 587.33, 466.16, 392, 349.23, 293.66],
      arp: [293.66, 349.23, 440, 587.33, 293.66, 349.23, 440, 587.33, 277.18, 349.23, 440, 554.37, 261.63, 349.23, 440, 523.25],
      pad: [[146.83, 174.61, 220, 293.66], [138.59, 174.61, 220, 277.18], [130.81, 174.61, 220, 261.63], [138.59, 174.61, 220, 277.18]],
      drums: 'full', leadType: 'sine', bassType: 'sawtooth'
    }
  },
  // Zone 3 熔岩地带：E 和声小调，失真 lead，激进
  zone3: {
    ambient: {
      bpm: 92,
      bass: [82.41, null, null, null, 82.41, null, null, null, 98, null, null, null, 73.42, null, null, null],
      lead: [null, null, null, null, 329.63, null, null, null, null, null, null, null, 293.66, null, null, null],
      arp: [164.81, 196, 246.94, 329.63, 164.81, 196, 246.94, 329.63, 155.56, 196, 246.94, 311.13, 146.83, 196, 246.94, 293.66],
      pad: [[164.81, 196, 246.94], [155.56, 196, 246.94], [146.83, 196, 246.94], [155.56, 196, 246.94]],
      drums: 'soft', leadType: 'sawtooth', bassType: 'sine'
    },
    cruise: {
      bpm: 115,
      bass: [82.41, null, 82.41, null, 98, null, 98, null, 73.42, null, 73.42, null, 82.41, null, 82.41, null],
      lead: [329.63, null, null, 392, null, 466.16, null, null, 369.99, null, null, 329.63, null, 293.66, null, null],
      arp: [164.81, 246.94, 329.63, 392, 164.81, 246.94, 329.63, 392, 155.56, 246.94, 311.13, 392, 146.83, 246.94, 293.66, 369.99],
      pad: [[164.81, 196, 246.94], [155.56, 196, 246.94], [146.83, 196, 246.94], [155.56, 196, 246.94]],
      drums: 'mid', leadType: 'sawtooth', bassType: 'sawtooth'
    },
    intense: {
      bpm: 145,
      bass: [82.41, 82.41, 98, 98, 73.42, 73.42, 82.41, 82.41, 82.41, 82.41, 98, 98, 73.42, 73.42, 82.41, 82.41],
      lead: [329.63, 392, 466.16, 587.33, 466.16, 392, 329.63, 369.99, 392, 466.16, 587.33, 698.46, 587.33, 466.16, 392, 329.63],
      arp: [329.63, 392, 466.16, 587.33, 329.63, 392, 466.16, 587.33, 311.13, 392, 466.16, 622.25, 293.66, 392, 466.16, 587.33],
      pad: [[164.81, 196, 246.94, 329.63], [155.56, 196, 246.94, 311.13], [146.83, 196, 246.94, 293.66], [155.56, 196, 246.94, 311.13]],
      drums: 'full', leadType: 'sawtooth', bassType: 'sawtooth'
    }
  },
  // Zone 4 黑客矩阵：F# 小调，方波 arp，故障感
  zone4: {
    ambient: {
      bpm: 96,
      bass: [92.50, null, null, null, 92.50, null, null, null, 110, null, null, null, 82.41, null, null, null],
      lead: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      arp: [185, 220, 277.18, 369.99, 185, 220, 277.18, 369.99, 220, 277.18, 329.63, 440, 164.81, 220, 277.18, 349.23],
      pad: [[185, 220, 277.18], [220, 277.18, 329.63], [164.81, 220, 277.18], [185, 220, 277.18]],
      drums: 'soft', leadType: 'square', bassType: 'square'
    },
    cruise: {
      bpm: 118,
      bass: [92.50, null, 92.50, null, 110, null, 110, null, 82.41, null, 82.41, null, 92.50, null, 92.50, null],
      lead: [369.99, null, null, 440, null, 554.37, null, null, 440, null, null, 369.99, null, 329.63, null, null],
      arp: [185, 277.18, 369.99, 440, 185, 277.18, 369.99, 440, 220, 277.18, 329.63, 440, 164.81, 277.18, 349.23, 440],
      pad: [[185, 220, 277.18], [220, 277.18, 329.63], [164.81, 220, 277.18], [185, 220, 277.18]],
      drums: 'mid', leadType: 'square', bassType: 'square'
    },
    intense: {
      bpm: 148,
      bass: [92.50, 92.50, 110, 110, 82.41, 82.41, 92.50, 92.50, 92.50, 92.50, 110, 110, 82.41, 82.41, 92.50, 92.50],
      lead: [369.99, 440, 554.37, 698.46, 554.37, 440, 369.99, 440, 440, 554.37, 698.46, 880, 698.46, 554.37, 440, 369.99],
      arp: [369.99, 440, 554.37, 698.46, 369.99, 440, 554.37, 698.46, 329.63, 440, 554.37, 698.46, 349.23, 440, 554.37, 698.46],
      pad: [[185, 220, 277.18, 369.99], [220, 277.18, 329.63, 440], [164.81, 220, 277.18, 349.23], [185, 220, 277.18, 369.99]],
      drums: 'full', leadType: 'square', bassType: 'square'
    }
  },
  // Zone 5 黄金传说：C 大调，管弦史诗，大调和弦
  zone5: {
    ambient: {
      bpm: 90,
      bass: [130.81, null, null, null, 98, null, null, null, 110, null, null, null, 130.81, null, null, null],
      lead: [null, null, 523.25, null, null, null, 392, null, null, null, 440, null, null, null, 523.25, null],
      arp: [261.63, 329.63, 392, 523.25, 261.63, 329.63, 392, 523.25, 196, 261.63, 329.63, 392, 220, 261.63, 329.63, 440],
      pad: [[261.63, 329.63, 392, 523.25], [196, 261.63, 329.63, 392], [220, 277.18, 349.23, 440], [261.63, 329.63, 392, 523.25]],
      drums: 'soft', leadType: 'triangle', bassType: 'sine'
    },
    cruise: {
      bpm: 112,
      bass: [130.81, null, 130.81, null, 98, null, 98, null, 110, null, 110, null, 130.81, null, 130.81, null],
      lead: [523.25, null, null, 659.25, null, 783.99, null, null, 587.33, null, null, 523.25, null, 440, null, null],
      arp: [523.25, 659.25, 783.99, 1046.50, 523.25, 659.25, 783.99, 1046.50, 392, 523.25, 659.25, 783.99, 440, 523.25, 659.25, 880],
      pad: [[261.63, 329.63, 392, 523.25], [196, 261.63, 329.63, 392], [220, 277.18, 349.23, 440], [261.63, 329.63, 392, 523.25]],
      drums: 'mid', leadType: 'triangle', bassType: 'sawtooth'
    },
    intense: {
      bpm: 144,
      bass: [130.81, 130.81, 98, 98, 110, 110, 130.81, 130.81, 130.81, 130.81, 98, 98, 110, 110, 130.81, 130.81],
      lead: [523.25, 659.25, 783.99, 1046.50, 783.99, 659.25, 523.25, 587.33, 659.25, 783.99, 1046.50, 1318.51, 1046.50, 783.99, 659.25, 523.25],
      arp: [523.25, 659.25, 783.99, 1046.50, 523.25, 659.25, 783.99, 1046.50, 392, 523.25, 659.25, 783.99, 440, 523.25, 659.25, 880],
      pad: [[261.63, 329.63, 392, 523.25], [196, 261.63, 329.63, 392], [220, 277.18, 349.23, 440], [261.63, 329.63, 392, 523.25]],
      drums: 'full', leadType: 'triangle', bassType: 'sawtooth'
    }
  },
  // 菜单氛围乐：C 大调，ambient pad + 缓慢 arp，无鼓
  menu: {
    ambient: {
      bpm: 72,
      bass: [65.41, null, null, null, null, null, null, null, 73.42, null, null, null, null, null, null, null],
      lead: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      arp: [261.63, 329.63, 392, 523.25, 329.63, 392, 523.25, 659.25, 293.66, 369.99, 440, 587.33, 329.63, 392, 523.25, 659.25],
      pad: [[130.81, 196, 261.63, 329.63], [146.83, 220, 293.66, 369.99], [164.81, 246.94, 329.63, 392], [146.83, 220, 293.66, 369.99]],
      drums: 'none', leadType: 'sine', bassType: 'sine'
    }
  }
};

// 情绪判定阈值（按玩家速度）
const MOOD_THRESHOLDS = { ambientMax: 11, cruiseMax: 16 }; // <11=ambient, 11~16=cruise, >16=intense

class AudioManager {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    // 从 localStorage 恢复用户偏好，未设置则用默认值
    // 注意：safeGetItem 在 localStorage 可用时返回 null（不是 fallback），仅异常时才返回 fallback
    const savedVolume = safeGetItem(CONFIG.STORAGE_KEYS.VOLUME, null);
    this.volume = (savedVolume !== null && !isNaN(parseFloat(savedVolume))) ? parseFloat(savedVolume) : 0.5;
    const savedMusic = safeGetItem(CONFIG.STORAGE_KEYS.MUSIC_ENABLED, null);
    this.musicEnabled = savedMusic === null ? true : savedMusic === '1';
    const savedSfx = safeGetItem(CONFIG.STORAGE_KEYS.SFX_ENABLED, null);
    this.sfxEnabled = savedSfx === null ? true : savedSfx === '1';
    this.musicNodes = [];
    this.musicInterval = null;
    this.initialized = false;
    this.currentBPM = 110;
    this.windSource = null;
    this.windGain = null;
    this.windFilter = null;
    this.windHighFilter = null;   // 高频层 bandpass
    this.windHighGain = null;     // 高频层 gain
    this.windPanner = null;       // 低频层立体声
    this.windHighPanner = null;   // 高频层立体声
    this.windLFO = null;          // 阵风慢速 LFO
    this.windLFOGain = null;      // LFO→gain 调制

    // ===== 新增：效果总线 =====
    this.reverbNode = null;       // 共享卷积混响
    this.musicReverbGain = null;  // 音乐→混响 送量
    this.sfxReverbGain = null;    // 音效→混响 送量
    this.masterFilter = null;     // 主低通（高速闷感）
    this.masterFilterGain = null; // 经过 masterFilter 的总送量
    this.distortionCurve = null;  // 预生成失真曲线

    // ===== 新增：分层音乐引擎状态 =====
    this.currentZone = 1;         // 当前区域 1~5
    this.currentMood = 'cruise';  // 'ambient' | 'cruise' | 'intense'
    this.moodIntensity = { ambient: 0, cruise: 1, intense: 0 }; // 三层平滑权重
    this.targetMoodIntensity = { ambient: 0, cruise: 1, intense: 0 };
    this.musicLookaheadTimer = null;
    this.nextStepTime = 0;
    this.stepIndex = 0;
    this.barCount = 0;
    this.isMenuMusic = false;     // 是否在播放菜单配乐
    this.menuMusicNodes = [];

    // ===== 新增：风噪第二层（高频气流） =====
    this.windHighSource = null;
    this.windHighFilter = null;
    this.windHighGain = null;
    this.windPanner = null;

    // ===== 新增：层独立增益（用于情绪交叉淡化） =====
    this.layerGains = {}; // { kick, hat, bass, lead, pad, arp, perc }
  }

  init() {
    if (this.initialized) return;

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.audioContext.destination);

      // ===== 效果总线：主低通滤波器（隧道闷感） =====
      this.masterFilter = this.audioContext.createBiquadFilter();
      this.masterFilter.type = 'lowpass';
      this.masterFilter.frequency.value = 8000;
      this.masterFilter.Q.value = 0.5;
      this.masterFilterGain = this.audioContext.createGain();
      this.masterFilterGain.gain.value = 1.0;
      this.masterFilter.connect(this.masterFilterGain);
      this.masterFilterGain.connect(this.masterGain);

      // ===== 效果总线：卷积混响 =====
      this.reverbNode = this.audioContext.createConvolver();
      this.reverbNode.buffer = this._createReverbIR(2.2, 2.5);
      this.musicReverbGain = this.audioContext.createGain();
      this.musicReverbGain.gain.value = 0.28;
      this.sfxReverbGain = this.audioContext.createGain();
      this.sfxReverbGain.gain.value = 0.18;
      this.musicReverbGain.connect(this.reverbNode);
      this.sfxReverbGain.connect(this.reverbNode);
      this.reverbNode.connect(this.masterFilter);

      // ===== 音乐/音效 Gain（保留原接口） =====
      this.musicGain = this.audioContext.createGain();
      this.musicGain.gain.value = this.musicEnabled ? 0.3 : 0;
      this.musicGain.connect(this.masterFilter);
      this.musicGain.connect(this.musicReverbGain); // 送一份到混响

      this.sfxGain = this.audioContext.createGain();
      this.sfxGain.gain.value = this.sfxEnabled ? 0.65 : 0;
      this.sfxGain.connect(this.masterFilter);
      this.sfxGain.connect(this.sfxReverbGain); // 送一份到混响

      // ===== 预生成失真曲线 =====
      this.distortionCurve = this._makeDistortionCurve(40);

      // ===== 初始化层增益节点 =====
      ['kick', 'hat', 'bass', 'lead', 'pad', 'arp', 'perc'].forEach(name => {
        const g = this.audioContext.createGain();
        g.gain.value = 0;
        g.connect(this.musicGain);
        this.layerGains[name] = g;
      });

      this.initialized = true;
    } catch (e) {
      console.error('Audio initialization failed:', e);
    }
  }

  // ===== 工具：生成卷积混响 impulse response =====
  _createReverbIR(duration, decay) {
    const sr = this.audioContext.sampleRate;
    const len = sr * duration;
    const ir = this.audioContext.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return ir;
  }

  // ===== 工具：生成失真曲线 =====
  _makeDistortionCurve(amount) {
    const k = amount;
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // ===== 工具：创建失真节点 =====
  _createDistortion(amount = 40) {
    const ws = this.audioContext.createWaveShaper();
    ws.curve = this.distortionCurve;
    ws.oversample = '2x';
    return ws;
  }

  // ===== 工具：创建立体声 panner =====
  _createPan(value = 0) {
    const p = this.audioContext.createStereoPanner();
    p.pan.value = value;
    return p;
  }

  setVolume(value) {
    this.volume = value;
    if (this.masterGain) {
      this.masterGain.gain.value = value;
    }
  }

  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    if (this.musicGain) {
      this.musicGain.gain.value = this.musicEnabled ? 0.3 : 0;
    }
    if (this.musicEnabled) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
    return this.musicEnabled;
  }

  toggleSfx() {
    this.sfxEnabled = !this.sfxEnabled;
    if (this.sfxGain) {
      this.sfxGain.gain.value = this.sfxEnabled ? 0.65 : 0;
    }
    return this.sfxEnabled;
  }

  // ===== 工具：生成噪声 buffer（供音效滤波扫频使用） =====
  _noiseBuffer(duration) {
    const len = Math.floor(this.audioContext.sampleRate * duration);
    const buf = this.audioContext.createBuffer(1, len, this.audioContext.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ===== 动作音效 =====
  playJump() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 主体：sine + triangle 上升，经失真
    const osc1 = this.audioContext.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(380, now);
    osc1.frequency.exponentialRampToValueAtTime(650, now + 0.18);
    const osc2 = this.audioContext.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(480, now);
    osc2.frequency.exponentialRampToValueAtTime(750, now + 0.14);
    const dist = this._createDistortion(15);
    const env = this.audioContext.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.26, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(dist); osc2.connect(dist); dist.connect(env); env.connect(this.sfxGain);
    osc1.start(now); osc1.stop(now + 0.2);
    osc2.start(now); osc2.stop(now + 0.16);
    // swoosh 层：噪声 highpass 扫频
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(0.22);
    const hp = this.audioContext.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(800, now);
    hp.frequency.exponentialRampToValueAtTime(4000, now + 0.18);
    const ng = this.audioContext.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.1, now + 0.03);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    noise.connect(hp); hp.connect(ng); ng.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 0.24);
  }

  playWallSwitch() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 扫频 sawtooth + lowpass + 失真（金属切变）
    const osc = this.audioContext.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(450, now + 0.12);
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(1600, now + 0.12);
    const dist = this._createDistortion(25);
    const env = this.audioContext.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(filter); filter.connect(dist); dist.connect(env); env.connect(this.sfxGain);
    osc.start(now); osc.stop(now + 0.14);
    // click 层：短噪声 highpass
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(0.05);
    const hp = this.audioContext.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = this.audioContext.createGain();
    ng.gain.setValueAtTime(0.15, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    noise.connect(hp); hp.connect(ng); ng.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 0.06);
  }

  playCollision() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 低频 thud：sine 80→30 + 失真
    const thud = this.audioContext.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(80, now);
    thud.frequency.exponentialRampToValueAtTime(30, now + 0.3);
    const dist = this._createDistortion(50);
    const thudEnv = this.audioContext.createGain();
    thudEnv.gain.setValueAtTime(0.5, now);
    thudEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    thud.connect(dist); dist.connect(thudEnv); thudEnv.connect(this.sfxGain);
    thud.start(now); thud.stop(now + 0.36);
    // 金属碎片：噪声 bandpass 高频扫频 + 立体声随机偏移
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(0.25);
    const bp = this.audioContext.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2500, now);
    bp.frequency.linearRampToValueAtTime(4500, now + 0.2);
    bp.Q.value = 2;
    const pan = this._createPan((Math.random() - 0.5) * 0.8);
    const ng = this.audioContext.createGain();
    ng.gain.setValueAtTime(0.35, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    noise.connect(bp); bp.connect(pan); pan.connect(ng); ng.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 0.26);
  }

  collectPowerup(type) {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;

    if (type === 'energy') {
      // bell 质感：sine + triangle 倍频叠加
      const freqs = [523.25, 659.25, 783.99, 1046.50];
      freqs.forEach((f, i) => {
        const t = now + i * 0.05;
        const s = this.audioContext.createOscillator();
        s.type = 'sine'; s.frequency.value = f;
        const tri = this.audioContext.createOscillator();
        tri.type = 'triangle'; tri.frequency.value = f * 2;
        const env = this.audioContext.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.18, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        s.connect(env); tri.connect(env); env.connect(this.sfxGain);
        s.start(t); s.stop(t + 0.32);
        tri.start(t); tri.stop(t + 0.32);
      });
    } else if (type === 'invincible') {
      // power 层：sawtooth 低八度持续 + 上行琶音 + 失真
      const power = this.audioContext.createOscillator();
      power.type = 'sawtooth'; power.frequency.value = 110;
      const dist = this._createDistortion(30);
      const pEnv = this.audioContext.createGain();
      pEnv.gain.setValueAtTime(0, now);
      pEnv.gain.linearRampToValueAtTime(0.15, now + 0.05);
      pEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      power.connect(dist); dist.connect(pEnv); pEnv.connect(this.sfxGain);
      power.start(now); power.stop(now + 0.52);
      const freqs = [329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
      freqs.forEach((f, i) => {
        const t = now + i * 0.04;
        const s = this.audioContext.createOscillator();
        s.type = 'triangle'; s.frequency.value = f;
        const env = this.audioContext.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.2, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        s.connect(env); env.connect(this.sfxGain);
        s.start(t); s.stop(t + 0.27);
      });
    } else if (type === 'shield') {
      // 金属共振：3 个 sine 倍频 + amplitude modulation
      const freqs = [587.33, 1174.66, 1761.99];
      freqs.forEach((f, i) => {
        const t = now + i * 0.03;
        const s = this.audioContext.createOscillator();
        s.type = 'sine'; s.frequency.value = f;
        const lfo = this.audioContext.createOscillator();
        lfo.frequency.value = 30 + i * 10;
        const lfoGain = this.audioContext.createGain(); lfoGain.gain.value = 0.08;
        const env = this.audioContext.createGain();
        env.gain.value = 0.15;
        lfo.connect(lfoGain); lfoGain.connect(env.gain);
        s.connect(env); env.connect(this.sfxGain);
        s.start(t); s.stop(t + 0.25);
        lfo.start(t); lfo.stop(t + 0.25);
      });
    } else if (type === 'magnet') {
      // 吸附感：频率缓慢上升 + 立体声快速交替
      const s = this.audioContext.createOscillator();
      s.type = 'sine';
      s.frequency.setValueAtTime(440, now);
      s.frequency.linearRampToValueAtTime(880, now + 0.25);
      const tri = this.audioContext.createOscillator();
      tri.type = 'triangle';
      tri.frequency.setValueAtTime(660, now);
      tri.frequency.linearRampToValueAtTime(1320, now + 0.25);
      const pan = this.audioContext.createStereoPanner();
      const lfo = this.audioContext.createOscillator();
      lfo.type = 'square'; lfo.frequency.value = 12;
      const lfoGain = this.audioContext.createGain(); lfoGain.gain.value = 0.7;
      lfo.connect(lfoGain); lfoGain.connect(pan.pan);
      const env = this.audioContext.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.2, now + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      s.connect(pan); tri.connect(pan); pan.connect(env); env.connect(this.sfxGain);
      s.start(now); s.stop(now + 0.27);
      tri.start(now); tri.stop(now + 0.27);
      lfo.start(now); lfo.stop(now + 0.27);
    } else if (type === 'boost') {
      // 推背感：sawtooth 扫频 + sub sine + 噪声 highpass + 失真
      const osc = this.audioContext.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(1600, now + 0.4);
      const sub = this.audioContext.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(60, now);
      sub.frequency.exponentialRampToValueAtTime(120, now + 0.4);
      const dist = this._createDistortion(35);
      const env = this.audioContext.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.25, now + 0.05);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(dist); sub.connect(dist); dist.connect(env); env.connect(this.sfxGain);
      osc.start(now); osc.stop(now + 0.42);
      sub.start(now); sub.stop(now + 0.42);
      const noise = this.audioContext.createBufferSource();
      noise.buffer = this._noiseBuffer(0.4);
      const hp = this.audioContext.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(1000, now);
      hp.frequency.exponentialRampToValueAtTime(6000, now + 0.4);
      const ng = this.audioContext.createGain();
      ng.gain.setValueAtTime(0, now);
      ng.gain.linearRampToValueAtTime(0.1, now + 0.1);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      noise.connect(hp); hp.connect(ng); ng.connect(this.sfxGain);
      noise.start(now); noise.stop(now + 0.42);
    }
  }

  playAchievement() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 辉煌感：3 osc 叠加（saw+triangle+sine）+ 慢攻击 + 长尾
    const chord = [523.25, 659.25, 783.99, 987.77, 1046.50];
    chord.forEach((f, i) => {
      const t = now + i * 0.06;
      const saw = this.audioContext.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f;
      const tri = this.audioContext.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f;
      const sine = this.audioContext.createOscillator(); sine.type = 'sine'; sine.frequency.value = f * 2;
      const env = this.audioContext.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.12, t + 0.08);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      saw.connect(env); tri.connect(env); sine.connect(env); env.connect(this.sfxGain);
      saw.start(t); saw.stop(t + 0.62);
      tri.start(t); tri.stop(t + 0.62);
      sine.start(t); sine.stop(t + 0.62);
    });
  }

  playGameOver() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 绝望感：下行音 + sub sine 持续 + 噪声 lowpass 渐弱 + 失真
    const freqs = [440, 392, 349, 311, 261, 220, 196, 146];
    freqs.forEach((f, i) => {
      const t = now + i * 0.12;
      const s = this.audioContext.createOscillator();
      s.type = 'sine'; s.frequency.value = f;
      const env = this.audioContext.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.2, t + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      s.connect(env); env.connect(this.sfxGain);
      s.start(t); s.stop(t + 0.27);
    });
    const sub = this.audioContext.createOscillator();
    sub.type = 'sine'; sub.frequency.value = 60;
    const subEnv = this.audioContext.createGain();
    subEnv.gain.setValueAtTime(0, now);
    subEnv.gain.linearRampToValueAtTime(0.25, now + 0.1);
    subEnv.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    const dist = this._createDistortion(40);
    sub.connect(dist); dist.connect(subEnv); subEnv.connect(this.sfxGain);
    sub.start(now); sub.stop(now + 1.22);
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(1.0);
    const lp = this.audioContext.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 400;
    const ng = this.audioContext.createGain();
    ng.gain.setValueAtTime(0.15, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    noise.connect(lp); lp.connect(ng); ng.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 1.02);
  }

  playCombo(comboCount) {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    const pitchShift = Math.min(10, comboCount) * 40;
    const base = 400 + pitchShift;
    // 递进感：主音 + 五度泛音
    const s = this.audioContext.createOscillator();
    s.type = 'sine'; s.frequency.value = base;
    const fifth = this.audioContext.createOscillator();
    fifth.type = 'sine'; fifth.frequency.value = base * 1.5;
    const tri = this.audioContext.createOscillator();
    tri.type = 'triangle'; tri.frequency.value = base * 1.5;
    const env = this.audioContext.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    const fifthEnv = this.audioContext.createGain();
    fifthEnv.gain.setValueAtTime(0, now);
    fifthEnv.gain.linearRampToValueAtTime(0.1, now + 0.01);
    fifthEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    s.connect(env); env.connect(this.sfxGain);
    fifth.connect(fifthEnv); tri.connect(fifthEnv); fifthEnv.connect(this.sfxGain);
    s.start(now); s.stop(now + 0.11);
    fifth.start(now); fifth.stop(now + 0.09);
    tri.start(now); tri.stop(now + 0.09);
  }

  playPause() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 下沉感：sine + sub sine 100→50
    const s = this.audioContext.createOscillator();
    s.type = 'sine';
    s.frequency.setValueAtTime(300, now);
    s.frequency.exponentialRampToValueAtTime(150, now + 0.15);
    const sub = this.audioContext.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(100, now);
    sub.frequency.exponentialRampToValueAtTime(50, now + 0.15);
    const env = this.audioContext.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.2, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    s.connect(env); sub.connect(env); env.connect(this.sfxGain);
    s.start(now); s.stop(now + 0.16);
    sub.start(now); sub.stop(now + 0.16);
  }

  playResume() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 上升感：sine + sub sine 50→100
    const s = this.audioContext.createOscillator();
    s.type = 'sine';
    s.frequency.setValueAtTime(150, now);
    s.frequency.exponentialRampToValueAtTime(300, now + 0.15);
    const sub = this.audioContext.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(50, now);
    sub.frequency.exponentialRampToValueAtTime(100, now + 0.15);
    const env = this.audioContext.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.2, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    s.connect(env); sub.connect(env); env.connect(this.sfxGain);
    s.start(now); s.stop(now + 0.16);
    sub.start(now); sub.stop(now + 0.16);
  }

  playClick() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // sci-fi click：square 1200→600 + 噪声 highpass 短促
    const osc = this.audioContext.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.05);
    const env = this.audioContext.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.12, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(env); env.connect(this.sfxGain);
    osc.start(now); osc.stop(now + 0.06);
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(0.03);
    const hp = this.audioContext.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 4000;
    const ng = this.audioContext.createGain();
    ng.gain.setValueAtTime(0.08, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    noise.connect(hp); hp.connect(ng); ng.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 0.04);
  }

  playGameStart() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 启程感：5 音 + sub sine 持续 + 高音 sine
    const chord = [261.63, 329.63, 392.00, 523.25, 659.25];
    chord.forEach((f, i) => {
      const t = now + i * 0.07;
      const tri = this.audioContext.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f;
      const env = this.audioContext.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.2, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      tri.connect(env); env.connect(this.sfxGain);
      tri.start(t); tri.stop(t + 0.37);
    });
    const sub = this.audioContext.createOscillator();
    sub.type = 'sine'; sub.frequency.value = 80;
    const subEnv = this.audioContext.createGain();
    subEnv.gain.setValueAtTime(0, now);
    subEnv.gain.linearRampToValueAtTime(0.18, now + 0.1);
    subEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    sub.connect(subEnv); subEnv.connect(this.sfxGain);
    sub.start(now); sub.stop(now + 0.52);
    const high = this.audioContext.createOscillator();
    high.type = 'sine'; high.frequency.value = 1046.50;
    const highEnv = this.audioContext.createGain();
    const ht = now + chord.length * 0.07;
    highEnv.gain.setValueAtTime(0, ht);
    highEnv.gain.linearRampToValueAtTime(0.15, ht + 0.02);
    highEnv.gain.exponentialRampToValueAtTime(0.001, ht + 0.45);
    high.connect(highEnv); highEnv.connect(this.sfxGain);
    high.start(ht); high.stop(ht + 0.47);
  }

  playHover() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 微妙 shimmer：sine + 高八度 sine 极低 gain
    const s = this.audioContext.createOscillator();
    s.type = 'sine'; s.frequency.value = 600;
    const high = this.audioContext.createOscillator();
    high.type = 'sine'; high.frequency.value = 1200;
    const env = this.audioContext.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.04, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    const highEnv = this.audioContext.createGain();
    highEnv.gain.setValueAtTime(0, now);
    highEnv.gain.linearRampToValueAtTime(0.015, now + 0.01);
    highEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    s.connect(env); env.connect(this.sfxGain);
    high.connect(highEnv); highEnv.connect(this.sfxGain);
    s.start(now); s.stop(now + 0.07);
    high.start(now); high.stop(now + 0.07);
  }

  // ===== 获取当前区域+情绪的 preset =====
  _getCurrentPreset() {
    const zoneKey = this.isMenuMusic ? 'menu' : `zone${this.currentZone}`;
    const zoneData = MUSIC_PRESETS[zoneKey] || MUSIC_PRESETS.zone1;
    return zoneData[this.currentMood] || zoneData.cruise || zoneData.ambient || Object.values(zoneData)[0];
  }

  // ===== 启动游戏配乐（lookahead 调度器） =====
  startMusic() {
    if (!this.musicEnabled || !this.initialized) return;
    this.stopMusic();
    this.isMenuMusic = false;
    this.currentMood = 'cruise';
    this.moodIntensity = { ambient: 0, cruise: 1, intense: 0 };
    this.targetMoodIntensity = { ambient: 0, cruise: 1, intense: 0 };
    this.stepIndex = 0;
    this.barCount = 0;
    this.nextStepTime = this.audioContext.currentTime + 0.05;
    this._updateLayerGains();
    this._scheduleLoop();
  }

  // ===== lookahead 调度循环 =====
  _scheduleLoop() {
    if (!this.musicEnabled || !this.initialized) return;
    const preset = this._getCurrentPreset();
    if (!preset) return;
    const bpm = preset.bpm || 110;
    const stepDur = 60 / bpm / 2; // 8 分音符
    const lookahead = 0.12;

    while (this.nextStepTime < this.audioContext.currentTime + lookahead) {
      this._scheduleStep(this.stepIndex, this.nextStepTime, preset, stepDur);
      this.stepIndex = (this.stepIndex + 1) % 16;
      if (this.stepIndex === 0) {
        this.barCount++;
        // 每 2 小节平滑更新情绪权重
        if (this.barCount % 2 === 0) this._smoothMood();
      }
      this.nextStepTime += stepDur;
    }

    this.musicLookaheadTimer = setTimeout(() => this._scheduleLoop(), 25);
  }

  // ===== 调度单步：触发所有声部 =====
  _scheduleStep(i, time, preset, stepDur) {
    // 平滑插值情绪权重
    this._interpolateMood();

    // 鼓组活跃度判定
    const drums = preset.drums || 'none';
    const drumWeight = this._drumWeight(drums);

    // Kick：每 4 步一次（强拍）
    if (i % 4 === 0 && drumWeight > 0) {
      this._playKick(time, 0.6 * drumWeight);
    }
    // Hat：每 4 步偏移 2（弱拍）
    if (i % 4 === 2 && drumWeight > 0.3) {
      this._playHat(time, 'closed', 0.3 * drumWeight);
    }
    // 打击乐 perc：每 8 步
    if (i % 8 === 4 && drumWeight > 0.6) {
      this._playPerc(time, 0.25 * drumWeight);
    }

    // Bass
    const bassFreq = preset.bass ? preset.bass[i] : null;
    if (bassFreq) {
      this._playBass(bassFreq, time, stepDur * 0.95, preset.bassType || 'sawtooth');
    }

    // Lead（仅 cruise/intense 层有权重时播放）
    const leadWeight = this.moodIntensity.cruise + this.moodIntensity.intense;
    const leadFreq = preset.lead ? preset.lead[i] : null;
    if (leadFreq && leadWeight > 0.05) {
      this._playLead(leadFreq, time, stepDur * 0.8, preset.leadType || 'triangle', leadWeight);
    }

    // Arp（全情绪层都有，ambient 更轻）
    const arpFreq = preset.arp ? preset.arp[i] : null;
    if (arpFreq) {
      const arpWeight = this.moodIntensity.ambient * 0.5 + this.moodIntensity.cruise * 0.6 + this.moodIntensity.intense * 0.8;
      if (arpWeight > 0.05) this._playArp(arpFreq, time, stepDur * 0.5, arpWeight);
    }

    // Pad：每 4 步触发一次和弦长音
    if (i % 4 === 0 && preset.pad) {
      const chordIdx = (i / 4) % preset.pad.length;
      const chord = preset.pad[chordIdx];
      if (chord) {
        const padWeight = this.moodIntensity.ambient * 0.7 + this.moodIntensity.cruise * 0.4 + this.moodIntensity.intense * 0.3;
        this._playPad(chord, time, stepDur * 4, padWeight);
      }
    }
  }

  // ===== 鼓组活跃度→权重映射 =====
  _drumWeight(drums) {
    switch (drums) {
      case 'none': return 0;
      case 'soft': return 0.4;
      case 'mid': return 0.7;
      case 'full': return 1.0;
      default: return 0.5;
    }
  }

  // ===== 情绪平滑插值（每步调用） =====
  _interpolateMood() {
    const speed = 0.06;
    ['ambient', 'cruise', 'intense'].forEach(k => {
      const diff = this.targetMoodIntensity[k] - this.moodIntensity[k];
      this.moodIntensity[k] += diff * speed;
    });
    // 更新层增益
    this._updateLayerGains();
  }

  // ===== 每 2 小节重新计算目标情绪权重 =====
  _smoothMood() {
    // 根据 currentMood 设定目标权重（允许交叉淡化）
    if (this.currentMood === 'ambient') {
      this.targetMoodIntensity = { ambient: 1, cruise: 0, intense: 0 };
    } else if (this.currentMood === 'cruise') {
      this.targetMoodIntensity = { ambient: 0.3, cruise: 1, intense: 0 };
    } else {
      this.targetMoodIntensity = { ambient: 0, cruise: 0.4, intense: 1 };
    }
  }

  // ===== 更新层增益节点 =====
  _updateLayerGains() {
    if (!this.layerGains.kick) return;
    const drums = this._getCurrentPreset().drums || 'none';
    const dw = this._drumWeight(drums);
    const now = this.audioContext.currentTime;
    const ramp = 0.3;
    // kick/hat/perc 跟随 drumWeight
    this.layerGains.kick.gain.setTargetAtTime(0.7 * dw, now, ramp);
    this.layerGains.hat.gain.setTargetAtTime(0.35 * dw, now, ramp);
    this.layerGains.perc.gain.setTargetAtTime(0.28 * dw, now, ramp);
    // bass 跟随 cruise+intense
    const bassW = this.moodIntensity.cruise + this.moodIntensity.intense;
    this.layerGains.bass.gain.setTargetAtTime(0.5 * bassW + 0.15 * this.moodIntensity.ambient, now, ramp);
    // lead 仅 cruise+intense
    const leadW = this.moodIntensity.cruise * 0.7 + this.moodIntensity.intense * 0.85;
    this.layerGains.lead.gain.setTargetAtTime(leadW, now, ramp);
    // pad 全层
    const padW = this.moodIntensity.ambient * 0.85 + this.moodIntensity.cruise * 0.45 + this.moodIntensity.intense * 0.3;
    this.layerGains.pad.gain.setTargetAtTime(padW, now, ramp);
    // arp 全层
    const arpW = this.moodIntensity.ambient * 0.45 + this.moodIntensity.cruise * 0.55 + this.moodIntensity.intense * 0.7;
    this.layerGains.arp.gain.setTargetAtTime(arpW, now, ramp);
  }

  // ===== 区域切换：平滑切换 preset =====
  setZone(zoneNum) {
    if (!this.initialized || this.isMenuMusic) return;
    if (this.currentZone === zoneNum) return;
    this.currentZone = Math.min(5, Math.max(1, zoneNum));
    // 不立即重启调度器，下一小节自然切换 preset（因为 _scheduleStep 每步读取 _getCurrentPreset）
    // 更新层增益
    this._updateLayerGains();
  }

  // ===== 速度→情绪判定 =====
  setMood(speed) {
    if (!this.initialized || this.isMenuMusic) return;
    let newMood;
    if (speed < MOOD_THRESHOLDS.ambientMax) newMood = 'ambient';
    else if (speed < MOOD_THRESHOLDS.cruiseMax) newMood = 'cruise';
    else newMood = 'intense';
    if (newMood !== this.currentMood) {
      this.currentMood = newMood;
      this._smoothMood();
    }
  }

  // ===== 菜单配乐 =====
  startMenuMusic() {
    if (!this.musicEnabled || !this.initialized) return;
    this.stopMusic();
    this.isMenuMusic = true;
    this.currentMood = 'ambient';
    this.moodIntensity = { ambient: 1, cruise: 0, intense: 0 };
    this.targetMoodIntensity = { ambient: 1, cruise: 0, intense: 0 };
    this.stepIndex = 0;
    this.barCount = 0;
    this.nextStepTime = this.audioContext.currentTime + 0.05;
    this._updateLayerGains();
    this._scheduleLoop();
  }

  stopMenuMusic() {
    if (!this.isMenuMusic) return;
    this.isMenuMusic = false;
    this.stopMusic();
  }

  // ===== 停止配乐 =====
  stopMusic() {
    if (this.musicLookaheadTimer) {
      clearTimeout(this.musicLookaheadTimer);
      this.musicLookaheadTimer = null;
    }
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
    this.musicNodes.forEach(node => {
      try { node.stop(); } catch (e) {}
    });
    this.musicNodes = [];
  }

  trackMusicNode(node) {
    this.musicNodes.push(node);
    node.onended = () => {
      const i = this.musicNodes.indexOf(node);
      if (i > -1) this.musicNodes.splice(i, 1);
    };
  }

  // ===== Kick：sine + click 层 + 失真 + 立体声 =====
  _playKick(time, vel = 0.6) {
    if (!this.initialized) return;
    const layerGain = this.layerGains.kick || this.musicGain;
    // 主体 sine 频率衰减
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(vel * 0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(gain);
    gain.connect(layerGain);
    osc.start(time);
    osc.stop(time + 0.2);
    this.trackMusicNode(osc);
    // Click 层：短噪声增加冲击
    const clickBuf = this.audioContext.createBuffer(1, this.audioContext.sampleRate * 0.01, this.audioContext.sampleRate);
    const cd = clickBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = Math.random() * 2 - 1;
    const click = this.audioContext.createBufferSource();
    click.buffer = clickBuf;
    const clickGain = this.audioContext.createGain();
    clickGain.gain.setValueAtTime(vel * 0.15, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
    const clickFilter = this.audioContext.createBiquadFilter();
    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 3000;
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(layerGain);
    click.start(time);
    click.stop(time + 0.02);
    this.trackMusicNode(click);
  }

  // ===== Hat：噪声 + highpass + 滤波包络 =====
  _playHat(time, variant = 'closed', vel = 0.2) {
    if (!this.initialized) return;
    const layerGain = this.layerGains.hat || this.musicGain;
    const dur = variant === 'open' ? 0.12 : 0.04;
    const bufSize = Math.floor(this.audioContext.sampleRate * dur);
    const buf = this.audioContext.createBuffer(1, bufSize, this.audioContext.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = this.audioContext.createBufferSource();
    src.buffer = buf;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = variant === 'rim' ? 6000 : 8500;
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    // 立体声微偏
    const pan = this._createPan((Math.random() - 0.5) * 0.4);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(layerGain);
    src.start(time);
    src.stop(time + dur);
    this.trackMusicNode(src);
  }

  // ===== Perc：snare/clave 风格打击乐 =====
  _playPerc(time, vel = 0.2) {
    if (!this.initialized) return;
    const layerGain = this.layerGains.perc || this.musicGain;
    // 短噪声 + bandpass 模拟 snare
    const bufSize = Math.floor(this.audioContext.sampleRate * 0.08);
    const buf = this.audioContext.createBuffer(1, bufSize, this.audioContext.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = this.audioContext.createBufferSource();
    src.buffer = buf;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 1.5;
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(layerGain);
    src.start(time);
    src.stop(time + 0.1);
    this.trackMusicNode(src);
  }

  // ===== Bass：双 osc（saw+sine 下八度）+ 包络滤波 =====
  _playBass(freq, time, duration, type = 'sawtooth') {
    if (!this.initialized) return;
    const layerGain = this.layerGains.bass || this.musicGain;
    // 主 osc
    const osc1 = this.audioContext.createOscillator();
    osc1.type = type;
    osc1.frequency.setValueAtTime(freq, time);
    // 下八度 sine 增加低频厚度
    const osc2 = this.audioContext.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq / 2, time);
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, time);
    filter.frequency.exponentialRampToValueAtTime(80, time + duration);
    filter.Q.value = 3;
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.3, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(layerGain);
    osc1.start(time);
    osc1.stop(time + duration);
    osc2.start(time);
    osc2.stop(time + duration);
    this.trackMusicNode(osc1);
    this.trackMusicNode(osc2);
  }

  // ===== Lead：triangle/saw/square + chorus + 滤波包络 + ping-pong delay =====
  _playLead(freq, time, duration, type = 'triangle', vel = 1) {
    if (!this.initialized) return;
    const layerGain = this.layerGains.lead || this.musicGain;
    const osc = this.audioContext.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    // 滤波包络
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 4, time);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.5, time + duration);
    filter.Q.value = 2;
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.08 * vel, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    // ping-pong delay
    const delay = this.audioContext.createDelay();
    delay.delayTime.value = duration * 0.5;
    const delayGain = this.audioContext.createGain();
    delayGain.gain.value = 0.25 * vel;
    const panL = this._createPan(-0.5);
    const panR = this._createPan(0.5);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(layerGain);
    gain.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(panL);
    delayGain.connect(panR);
    panL.connect(layerGain);
    panR.connect(layerGain);
    osc.start(time);
    osc.stop(time + duration);
    this.trackMusicNode(osc);
  }

  // ===== Pad：3 osc 叠加 + 慢攻击 + 低通 + reverb =====
  _playPad(chord, time, duration, vel = 0.5) {
    if (!this.initialized || !chord) return;
    const layerGain = this.layerGains.pad || this.musicGain;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, time);
    filter.frequency.linearRampToValueAtTime(1500, time + duration * 0.3);
    filter.Q.value = 0.7;
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.04 * vel, time + duration * 0.3);
    gain.gain.setValueAtTime(0.04 * vel, time + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    // 立体声宽化
    const pan = this._createPan(0);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(layerGain);
    // 3 osc 叠加每个和弦音
    chord.forEach((freq, idx) => {
      const osc = this.audioContext.createOscillator();
      osc.type = idx === 0 ? 'sawtooth' : (idx === 1 ? 'triangle' : 'sine');
      osc.frequency.setValueAtTime(freq, time);
      // 微 detune 增加宽度
      osc.detune.value = (idx - 1) * 6;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + duration);
      this.trackMusicNode(osc);
    });
  }

  // ===== Arp：square + 短延迟 + 立体声偏移 =====
  _playArp(freq, time, duration, vel = 0.5) {
    if (!this.initialized) return;
    const layerGain = this.layerGains.arp || this.musicGain;
    const osc = this.audioContext.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 3;
    filter.Q.value = 1;
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.04 * vel, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    // 立体声交替偏移
    const pan = this._createPan((this.stepIndex % 2 === 0 ? -0.3 : 0.3));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(layerGain);
    osc.start(time);
    osc.stop(time + duration);
    this.trackMusicNode(osc);
  }

  // ===== 速度→情绪 + 动态滤波器（保留原接口） =====
  updateMusicBPM(speed) {
    if (!this.musicEnabled || !this.initialized) return;
    // 情绪判定
    this.setMood(speed);
    // 动态主低通：速度越高 cutoff 越低（隧道闷感）
    if (this.masterFilter) {
      const cutoff = Math.max(1500, 8000 - (speed - 9) * 400);
      this.masterFilter.frequency.setTargetAtTime(cutoff, this.audioContext.currentTime, 0.5);
    }
  }

  playNearMiss() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 噪声 bandpass 扫频 + 立体声掠过
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(0.15);
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(2000, now + 0.15);
    filter.Q.value = 2;
    const pan = this.audioContext.createStereoPanner();
    pan.pan.setValueAtTime(-0.8, now);
    pan.pan.linearRampToValueAtTime(0.8, now + 0.15);
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    noise.connect(filter); filter.connect(pan); pan.connect(gain); gain.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 0.16);
    // sub 层 sine 1200→1800 微弱
    const sub = this.audioContext.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(1200, now);
    sub.frequency.exponentialRampToValueAtTime(1800, now + 0.15);
    const subGain = this.audioContext.createGain();
    subGain.gain.setValueAtTime(0.08, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    sub.connect(subGain); subGain.connect(this.sfxGain);
    sub.start(now); sub.stop(now + 0.16);
  }

  playEnergyWarning() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 警报感：square 880 间断双击 + sub sine 220
    const playBleep = (t) => {
      const osc = this.audioContext.createOscillator();
      osc.type = 'square'; osc.frequency.value = 880;
      const env = this.audioContext.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.15, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(env); env.connect(this.sfxGain);
      osc.start(t); osc.stop(t + 0.11);
    };
    playBleep(now);
    playBleep(now + 0.15);
    const sub = this.audioContext.createOscillator();
    sub.type = 'sine'; sub.frequency.value = 220;
    const subEnv = this.audioContext.createGain();
    subEnv.gain.setValueAtTime(0.1, now);
    subEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    sub.connect(subEnv); subEnv.connect(this.sfxGain);
    sub.start(now); sub.stop(now + 0.26);
  }

  playZoneTransition() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 主体：triangle 6 音 + delay 链 + 立体声左右扩散
    const chord = [261.63, 329.63, 392.00, 523.25, 659.25, 1046.50];
    chord.forEach((freq, i) => {
      const t = now + i * 0.08;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      const delay = this.audioContext.createDelay();
      const delayGain = this.audioContext.createGain();
      const pan = this._createPan(i % 2 === 0 ? -0.4 : 0.4);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      delay.delayTime.value = 0.25;
      delayGain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(pan); pan.connect(this.sfxGain);
      gain.connect(delay); delay.connect(delayGain); delayGain.connect(this.sfxGain);
      osc.start(t); osc.stop(t + 0.6);
    });
    // whoosh 层：噪声 bandpass 扫频
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(0.5);
    const bp = this.audioContext.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(3000, now + 0.5);
    bp.Q.value = 1;
    const ng = this.audioContext.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.12, now + 0.1);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    noise.connect(bp); bp.connect(ng); ng.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 0.52);
  }

  playCountdownTick() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 电子 tick：square 880 短促 + 噪声 click
    const osc = this.audioContext.createOscillator();
    osc.type = 'square'; osc.frequency.value = 880;
    const env = this.audioContext.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.12, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(env); env.connect(this.sfxGain);
    osc.start(now); osc.stop(now + 0.09);
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(0.02);
    const hp = this.audioContext.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = this.audioContext.createGain();
    ng.gain.setValueAtTime(0.1, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    noise.connect(hp); hp.connect(ng); ng.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 0.03);
  }

  playCountdownGo() {
    if (!this.sfxEnabled || !this.initialized) return;
    const now = this.audioContext.currentTime;
    // 爆发感：4 音 + sub sine 持续 + 噪声 sweep
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const t = now + i * 0.05;
      const osc = this.audioContext.createOscillator();
      osc.type = 'triangle'; osc.frequency.value = freq;
      const env = this.audioContext.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.2, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(env); env.connect(this.sfxGain);
      osc.start(t); osc.stop(t + 0.32);
    });
    const sub = this.audioContext.createOscillator();
    sub.type = 'sine'; sub.frequency.value = 100;
    const subEnv = this.audioContext.createGain();
    subEnv.gain.setValueAtTime(0, now);
    subEnv.gain.linearRampToValueAtTime(0.2, now + 0.05);
    subEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    sub.connect(subEnv); subEnv.connect(this.sfxGain);
    sub.start(now); sub.stop(now + 0.32);
    const noise = this.audioContext.createBufferSource();
    noise.buffer = this._noiseBuffer(0.3);
    const hp = this.audioContext.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(500, now);
    hp.frequency.exponentialRampToValueAtTime(5000, now + 0.3);
    const ng = this.audioContext.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.1, now + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    noise.connect(hp); hp.connect(ng); ng.connect(this.sfxGain);
    noise.start(now); noise.stop(now + 0.32);
  }

  // ===== 工具：生成棕噪声 buffer（模拟自然风，低频能量集中） =====
  _brownNoiseBuffer(duration) {
    const sr = this.audioContext.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = this.audioContext.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last += (Math.random() * 2 - 1) * 0.02;
      if (last > 1.0) last = 1.0;
      if (last < -1.0) last = -1.0;
      data[i] = last;
    }
    return buf;
  }

  startWindSound() {
    if (!this.initialized || this.windSource) return;
    // 棕噪声源（4秒循环，更自然的风声质感）
    this.windSource = this.audioContext.createBufferSource();
    this.windSource.buffer = this._brownNoiseBuffer(4);
    this.windSource.loop = true;

    // 低频层：宽 bandpass 250Hz，低沉风吼
    this.windFilter = this.audioContext.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 250;
    this.windFilter.Q.value = 0.3; // 更宽，更自然
    this.windGain = this.audioContext.createGain();
    this.windGain.gain.value = 0;

    // 高频层：窄 bandpass 2500Hz，模拟风啸
    this.windHighFilter = this.audioContext.createBiquadFilter();
    this.windHighFilter.type = 'bandpass';
    this.windHighFilter.frequency.value = 2500;
    this.windHighFilter.Q.value = 1.5;
    this.windHighGain = this.audioContext.createGain();
    this.windHighGain.gain.value = 0;

    // 慢速增益 LFO（模拟阵风自然起伏）
    this.windLFO = this.audioContext.createOscillator();
    this.windLFO.type = 'sine'; this.windLFO.frequency.value = 0.3;
    this.windLFOGain = this.audioContext.createGain();
    this.windLFOGain.gain.value = 0;
    this.windLFO.connect(this.windLFOGain);
    this.windLFOGain.connect(this.windGain.gain);
    this.windLFO.start();

    // 立体声 pan
    this.windPanner = this.audioContext.createStereoPanner();
    this.windPanner.pan.value = 0;
    this.windHighPanner = this.audioContext.createStereoPanner();
    this.windHighPanner.pan.value = 0;

    // 路由
    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.windPanner);
    this.windPanner.connect(this.masterGain);

    this.windSource.connect(this.windHighFilter);
    this.windHighFilter.connect(this.windHighGain);
    this.windHighGain.connect(this.windHighPanner);
    this.windHighPanner.connect(this.masterGain);

    this.windSource.start();
  }

  updateWindSound(speed) {
    if (!this.windGain || !this.windFilter) return;
    const now = this.audioContext.currentTime;
    // 低频层：速度 9+ 开始有，线性增长
    const lowGain = Math.min(0.22, Math.max(0, (speed - 9) * 0.012));
    this.windGain.gain.setTargetAtTime(lowGain, now, 0.15);
    // 低频层频率随速度微升（模拟风压变化）
    this.windFilter.frequency.setTargetAtTime(180 + speed * 25, now, 0.15);
    // 阵风 LFO 幅度：速度越高起伏越大
    this.windLFOGain.gain.setTargetAtTime(Math.min(0.06, (speed - 9) * 0.004), now, 0.15);

    // 高频层：速度 13+ 才出现，更晚更克制
    const highGain = Math.min(0.06, Math.max(0, (speed - 14) * 0.005));
    this.windHighGain.gain.setTargetAtTime(highGain, now, 0.15);
    this.windHighFilter.frequency.setTargetAtTime(1800 + speed * 60, now, 0.15);

    // 立体声微摇：速度越高摇摆幅度越大
    const panAmount = Math.min(0.5, Math.max(0, (speed - 15) * 0.035));
    const lowPan = Math.sin(now * 0.8) * panAmount * 0.6;
    const highPan = Math.sin(now * 1.7 + 1.5) * panAmount;
    this.windPanner.pan.setTargetAtTime(lowPan, now, 0.08);
    this.windHighPanner.pan.setTargetAtTime(highPan, now, 0.08);
  }

  stopWindSound() {
    if (this.windSource) {
      try { this.windSource.stop(); } catch(e) {}
      this.windSource = null;
      this.windGain = null;
      this.windFilter = null;
      this.windHighFilter = null;
      this.windHighGain = null;
      this.windPanner = null;
      this.windHighPanner = null;
      if (this.windLFO) { try { this.windLFO.stop(); } catch(e) {} this.windLFO = null; }
      this.windLFOGain = null;
    }
  }
}

const audioManager = new AudioManager();

// ============ 粒子系统 ============
class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleMaterial = new THREE.PointsMaterial({
      size: 0.1,
      transparent: true,
      opacity: 0.8,
      vertexColors: true,
      blending: THREE.AdditiveBlending
    });
    
    this.maxParticles = 500;
    this.positions = new Float32Array(this.maxParticles * 3);
    this.velocities = new Float32Array(this.maxParticles * 3);
    this.lifetimes = new Float32Array(this.maxParticles);
    this.colors = new Float32Array(this.maxParticles * 3);
    
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    
    this.particleSystem = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.scene.add(this.particleSystem);
    
    this.activeCount = 0;
  }
  
  emit(position, count, color, speed = 1) {
    for (let i = 0; i < count && this.activeCount < this.maxParticles; i++) {
      const index = this.activeCount;
      
      this.positions[index * 3] = position.x;
      this.positions[index * 3 + 1] = position.y;
      this.positions[index * 3 + 2] = position.z;
      
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const MathSpeed = Math.random() * speed * 0.1;
      
      this.velocities[index * 3] = Math.sin(phi) * Math.cos(theta) * MathSpeed;
      this.velocities[index * 3 + 1] = Math.sin(phi) * Math.sin(theta) * MathSpeed;
      this.velocities[index * 3 + 2] = Math.cos(phi) * MathSpeed;
      
      this.lifetimes[index] = 1.0;
      
      this.colors[index * 3] = color.r;
      this.colors[index * 3 + 1] = color.g;
      this.colors[index * 3 + 2] = color.b;
      
      this.activeCount++;
    }
  }
  
  update(dt) {
    for (let i = 0; i < this.activeCount; i++) {
      this.positions[i * 3] += this.velocities[i * 3];
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1];
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2];
      
      this.lifetimes[i] -= dt * 2;
      
      if (this.lifetimes[i] <= 0) {
        if (i < this.activeCount - 1) {
          const lastIndex = this.activeCount - 1;
          
          this.positions[i * 3] = this.positions[lastIndex * 3];
          this.positions[i * 3 + 1] = this.positions[lastIndex * 3 + 1];
          this.positions[i * 3 + 2] = this.positions[lastIndex * 3 + 2];
          
          this.velocities[i * 3] = this.velocities[lastIndex * 3];
          this.velocities[i * 3 + 1] = this.velocities[lastIndex * 3 + 1];
          this.velocities[i * 3 + 2] = this.velocities[lastIndex * 3 + 2];
          
          this.lifetimes[i] = this.lifetimes[lastIndex];
          
          this.colors[i * 3] = this.colors[lastIndex * 3];
          this.colors[i * 3 + 1] = this.colors[lastIndex * 3 + 1];
          this.colors[i * 3 + 2] = this.colors[lastIndex * 3 + 2];
        }
        
        this.activeCount--;
        i--;
      }
    }
    
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
    this.particleGeometry.setDrawRange(0, this.activeCount);
  }
}

// ============ 屏幕震动效果 ============
class ScreenShake {
  constructor(camera) {
    this.camera = camera;
    this.originalPosition = camera.position.clone();
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeTimer = 0;
  }
  
  shake(intensity, duration) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTimer = 0;
  }
  
  update(dt) {
    if (this.shakeTimer < this.shakeDuration) {
      this.shakeTimer += dt;
      
      const progress = this.shakeTimer / this.shakeDuration;
      // 指数衰减：震动强度随时间快速衰减
      const decay = Math.exp(-progress * 4);
      const currentIntensity = this.shakeIntensity * decay * (1 - progress);
      
      // 多频率叠加：高频小幅度 + 低频大幅度，模拟自然震动
      const t = this.shakeTimer;
      const highFreq = Math.sin(t * 60) * 0.3 + Math.sin(t * 110) * 0.15;
      const lowFreq = Math.sin(t * 15) * 0.7;
      const amp = currentIntensity;
      
      this.camera.position.x = this.originalPosition.x + (highFreq + lowFreq) * amp;
      this.camera.position.y = this.originalPosition.y + (highFreq - lowFreq) * amp;
      // z 轴抖动幅度限制为 x/y 的 30%，避免画面纵向跳变
      this.camera.position.z = this.originalPosition.z + Math.sin(t * 40) * amp * 0.3;
    } else {
      this.camera.position.copy(this.originalPosition);
    }
  }
}

// ============ 速度线效果 ============
class SpeedLines {
  constructor() {
    this.container = document.getElementById('speedLines');
    this.lines = [];
    this.active = false;
    this.speed = 0;
    this.maxSpeed = 30;
  }
  
  createLines() {
    for (let i = 0; i < 20; i++) {
      const line = document.createElement('div');
      line.className = 'speed-line';
      // 初始化时固定纵向流动方向，方向锁定避免噪点感
      // 横向位置随机分布，但 transform 仅做纵向位移（rotate 固定 90deg 使线条纵向）
      line.style.left = (Math.random() * 100) + '%';
      line.style.top = '0%';
      line.style.transform = 'rotate(90deg) translateY(0%)';
      line.style.opacity = '0';
      this.container.appendChild(line);
      this.lines.push({
        element: line,
        speed: Math.random() * 0.5 + 0.5,
        offset: Math.random() * 100,
        // 固定方向脉动相位，避免每帧重随机
        phase: Math.random() * Math.PI * 2
      });
    }
  }
  
  update(currentSpeed) {
    this.speed = currentSpeed;
    const speedRatio = Math.min((currentSpeed - 10) / (this.maxSpeed - 10), 1);
    const opacity = speedRatio * 0.8;
    
    this.container.style.opacity = opacity;
    
    if (opacity > 0) {
      const time = performance.now() / 1000;
      this.lines.forEach(line => {
        line.offset += line.speed * speedRatio * 3;
        if (line.offset > 100) line.offset = 0;
        
        // 沿固定纵向方向位移 + 透明度脉动（基于固定相位，非每帧随机）
        line.element.style.transform = 'rotate(90deg) translateY(' + line.offset + '%)';
        const pulse = 0.5 + Math.sin(time * 4 + line.phase) * 0.3 + 0.2;
        line.element.style.opacity = opacity * pulse;
      });
    }
  }
}

// ============ 基础场景 ============
const bgColor = 0x05060c;
const scene = new THREE.Scene();
scene.background = new THREE.Color(bgColor);
scene.fog = new THREE.Fog(bgColor, 10, 60);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth/window.innerHeight, 0.1, 200);
camera.position.set(0, 0.6, 8);
camera.lookAt(0, -0.3, -6);

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ============ Bloom 后处理 ============
// 特性检测：CDN 后处理模块加载失败时降级为直接渲染
let composer = null;
let bloomPass = null;
if (typeof THREE.EffectComposer === 'function' && typeof THREE.RenderPass === 'function' && typeof THREE.UnrealBloomPass === 'function') {
  composer = new THREE.EffectComposer(renderer);
  const renderPass = new THREE.RenderPass(scene, camera);
  composer.addPass(renderPass);
  bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.7, 0.4, 0.82
  );
  composer.addPass(bloomPass);
} else {
  console.warn('[Gravity Tunnel] Three.js 后处理模块未加载，降级为直接渲染');
}

const particleSystem = new ParticleSystem(scene);
const screenShake = new ScreenShake(camera);
const speedLines = new SpeedLines();
speedLines.createLines();

function updateCameraFraming() {
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect < 0.85) {
    camera.fov = 82;
    camera.position.z = 10;
  } else if (aspect < 1.2) {
    camera.fov = 72;
    camera.position.z = 9;
  } else {
    camera.fov = 65;
    camera.position.z = 8;
  }
  camera.lookAt(0, -0.3, -6);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  screenShake.originalPosition.copy(camera.position);
}

window.addEventListener('resize', updateCameraFraming);
updateCameraFraming();

// ============ 游戏配置与环境 ============
scene.add(new THREE.AmbientLight(0x4a5a72, 0.9));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(4, 10, 6);
scene.add(dirLight);

// ============ 星星效果 (Three Layers for Nebula Depth) ============
const starGeo = new THREE.BufferGeometry();
const starCount = 400;
const starPos = new Float32Array(starCount*3);
const starSizes = new Float32Array(starCount);
const starColors = new Float32Array(starCount*3);

for (let i=0;i<starCount;i++) {
  starPos[i*3]   = (Math.random()-0.5)*90;
  starPos[i*3+1] = (Math.random()-0.5)*90;
  starPos[i*3+2] = -Math.random()*140 - 10;
  starSizes[i] = Math.random() * 0.2 + 0.1;
  
  const colorChoice = Math.random();
  if (colorChoice < 0.33) {
    starColors[i*3] = 0.3; starColors[i*3+1] = 0.9; starColors[i*3+2] = 0.88;
  } else if (colorChoice < 0.66) {
    starColors[i*3] = 0.55; starColors[i*3+1] = 0.36; starColors[i*3+2] = 0.96;
  } else {
    starColors[i*3] = 1; starColors[i*3+1] = 1; starColors[i*3+2] = 1;
  }
}

starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

const starMaterial = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 } },
  vertexShader: `
    attribute float size;
    attribute vec3 color;
    varying vec3 vColor;
    uniform float time;
    void main() {
      vColor = color;
      vec3 pos = position;
      pos.z += time * 5.0;
      if (pos.z > 10.0) pos.z -= 150.0;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = size * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    void main() {
      vec2 coord = gl_PointCoord - vec2(0.5);
      float dist = length(coord);
      if (dist > 0.5) discard;
      float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
      gl_FragColor = vec4(vColor, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const stars = new THREE.Points(starGeo, starMaterial);
scene.add(stars);

// Layer 2: Medium purple nebula stars
const starGeo2 = new THREE.BufferGeometry();
const starCount2 = 250;
const starPos2 = new Float32Array(starCount2*3);
const starSizes2 = new Float32Array(starCount2);
const starColors2 = new Float32Array(starCount2*3);
for (let i=0;i<starCount2;i++) {
  starPos2[i*3]   = (Math.random()-0.5)*120;
  starPos2[i*3+1] = (Math.random()-0.5)*120;
  starPos2[i*3+2] = -Math.random()*160 - 20;
  starSizes2[i] = Math.random() * 0.4 + 0.3;
  
  const c = new THREE.Color(0x8b5cf6);
  starColors2[i*3] = c.r; starColors2[i*3+1] = c.g; starColors2[i*3+2] = c.b;
}
starGeo2.setAttribute('position', new THREE.BufferAttribute(starPos2, 3));
starGeo2.setAttribute('size', new THREE.BufferAttribute(starSizes2, 1));
starGeo2.setAttribute('color', new THREE.BufferAttribute(starColors2, 3));

const starMaterial2 = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 } },
  vertexShader: `
    attribute float size;
    attribute vec3 color;
    varying vec3 vColor;
    uniform float time;
    void main() {
      vColor = color;
      vec3 pos = position;
      pos.z += time * 2.0;
      if (pos.z > 10.0) pos.z -= 180.0;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = size * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    void main() {
      vec2 coord = gl_PointCoord - vec2(0.5);
      if (length(coord) > 0.5) discard;
      gl_FragColor = vec4(vColor, 0.45);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
const stars2 = new THREE.Points(starGeo2, starMaterial2);
scene.add(stars2);

// Layer 3: Large slow deep orange background nebula clouds
const starGeo3 = new THREE.BufferGeometry();
const starCount3 = 100;
const starPos3 = new Float32Array(starCount3*3);
const starSizes3 = new Float32Array(starCount3);
const starColors3 = new Float32Array(starCount3*3);
for (let i=0;i<starCount3;i++) {
  starPos3[i*3]   = (Math.random()-0.5)*160;
  starPos3[i*3+1] = (Math.random()-0.5)*160;
  starPos3[i*3+2] = -Math.random()*200 - 30;
  starSizes3[i] = Math.random() * 1.5 + 1.0;
  
  const c = new THREE.Color(0xff3b3b);
  starColors3[i*3] = c.r; starColors3[i*3+1] = c.g; starColors3[i*3+2] = c.b;
}
starGeo3.setAttribute('position', new THREE.BufferAttribute(starPos3, 3));
starGeo3.setAttribute('size', new THREE.BufferAttribute(starSizes3, 1));
starGeo3.setAttribute('color', new THREE.BufferAttribute(starColors3, 3));

const starMaterial3 = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 } },
  vertexShader: `
    attribute float size;
    attribute vec3 color;
    varying vec3 vColor;
    uniform float time;
    void main() {
      vColor = color;
      vec3 pos = position;
      pos.z += time * 0.8;
      if (pos.z > 10.0) pos.z -= 230.0;
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = size * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    void main() {
      vec2 coord = gl_PointCoord - vec2(0.5);
      if (length(coord) > 0.5) discard;
      gl_FragColor = vec4(vColor, 0.3);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
const stars3 = new THREE.Points(starGeo3, starMaterial3);
scene.add(stars3);

// ============ 隧道参数 ============
const R = 4;
const SEG_LEN = 10;
const NUM_SEGMENTS = 16;
const PLAYER_Z = 3;
const WALL_COLORS = [0xffffff, 0xf0f4ff, 0xffffff, 0xf0f4ff];

const OBSTACLE_COLOR = 0xff3b3b;

const world = new THREE.Group();
scene.add(world);

const difficultySettings = {
  easy: {
    speedMultiplier: 0.75,
    obstacleMultiplier: 0.65,
    powerupMultiplier: 1.3,
    energyRegenMultiplier: 1.4
  },
  normal: {
    speedMultiplier: 1.0,
    obstacleMultiplier: 1.0,
    powerupMultiplier: 1.0,
    energyRegenMultiplier: 1.0
  },
  hard: {
    speedMultiplier: 1.25,
    obstacleMultiplier: 1.35,
    powerupMultiplier: 0.7,
    energyRegenMultiplier: 0.75
  }
};

// 难度曲线：按奔跑距离分段，方便无限模式渐进与 A/B 调参
// 数值为 normal 难度下的基准值，实际会乘上 difficultySettings 对应乘数
const DIFFICULTY_CURVE = [
  { distance: 0,    maxWallsBase: 0.5, laserChance: 0.20, movingChance: 0.00, powerupChance: 0.12, moveSpeedMin: 1.5, moveSpeedMax: 3.5 },
  { distance: 500,  maxWallsBase: 1.5, laserChance: 0.30, movingChance: 0.25, powerupChance: 0.22, moveSpeedMin: 2.0, moveSpeedMax: 4.0 },
  { distance: 1000, maxWallsBase: 2.5, laserChance: 0.35, movingChance: 0.40, powerupChance: 0.28, moveSpeedMin: 2.5, moveSpeedMax: 4.5 },
  { distance: 1500, maxWallsBase: 3.0, laserChance: 0.40, movingChance: 0.55, powerupChance: 0.30, moveSpeedMin: 3.0, moveSpeedMax: 5.0 },
  { distance: 2500, maxWallsBase: 3.5, laserChance: 0.45, movingChance: 0.70, powerupChance: 0.32, moveSpeedMin: 3.5, moveSpeedMax: 5.5 },
  { distance: 4000, maxWallsBase: 4.0, laserChance: 0.50, movingChance: 0.85, powerupChance: 0.34, moveSpeedMin: 4.0, moveSpeedMax: 6.0 }
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getDifficultyAt(distance) {
  const first = DIFFICULTY_CURVE[0];
  const last = DIFFICULTY_CURVE[DIFFICULTY_CURVE.length - 1];
  if (distance <= first.distance) return first;
  if (distance >= last.distance) return last;

  for (let i = 0; i < DIFFICULTY_CURVE.length - 1; i++) {
    const cur = DIFFICULTY_CURVE[i];
    const next = DIFFICULTY_CURVE[i + 1];
    if (distance >= cur.distance && distance < next.distance) {
      const t = (distance - cur.distance) / (next.distance - cur.distance);
      return {
        distance,
        maxWallsBase: lerp(cur.maxWallsBase, next.maxWallsBase, t),
        laserChance: lerp(cur.laserChance, next.laserChance, t),
        movingChance: lerp(cur.movingChance, next.movingChance, t),
        powerupChance: lerp(cur.powerupChance, next.powerupChance, t),
        moveSpeedMin: lerp(cur.moveSpeedMin, next.moveSpeedMin, t),
        moveSpeedMax: lerp(cur.moveSpeedMax, next.moveSpeedMax, t)
      };
    }
  }
  return last;
}

let currentDifficulty = safeGetItem(CONFIG.STORAGE_KEYS.DIFFICULTY, 'normal') || 'normal';

// ============ 预设关卡片段系统 ============
const PATTERNS = [
  // 简单模式（距离 0-300m）
  { walls: [0], minDist: 0, weight: 3 },
  { walls: [1], minDist: 0, weight: 3 },
  { walls: [2], minDist: 0, weight: 3 },
  { walls: [3], minDist: 0, weight: 3 },
  // 中等模式（距离 300-1500m）
  { walls: [0, 2], minDist: 300, weight: 4 },
  { walls: [1, 3], minDist: 300, weight: 4 },
  { walls: [0, 1], minDist: 500, weight: 3 },
  { walls: [2, 3], minDist: 500, weight: 3 },
  { walls: [1, 2], minDist: 500, weight: 3 },
  // 困难模式（距离 1500m+）
  { walls: [0, 1, 2], minDist: 1500, weight: 2 },
  { walls: [0, 2, 3], minDist: 1500, weight: 2 },
  { walls: [0, 1, 3], minDist: 1500, weight: 2 },
  { walls: [1, 2, 3], minDist: 1500, weight: 2 },
  { walls: [0, 2], minDist: 2000, weight: 3, tightGap: true },
  { walls: [1, 3], minDist: 2000, weight: 3, tightGap: true },
  // 分支路径模式（距离 2000m+）
  { walls: [0, 2], minDist: 2000, weight: 2, isBranch: true, branchSafe: [1, 3] },
  { walls: [1, 3], minDist: 2000, weight: 2, isBranch: true, branchSafe: [0, 2] },
];

// ============ 种子随机系统 ============
let currentSeed = null;
let gameRng = Math.random;

// ============ 动态难度系统 ============
let recentEvents = [];
let dynamicDifficultyMod = 1.0;

// Wall shaders for dynamic grid lines
const wallVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const wallFragmentShader = `
  uniform float time;
  uniform float speed;
  uniform vec3 zoneTint;
  uniform float zoneId;   // 区域编号 1~5，控制窗外景色
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // 稀疏星星（区域1 原始效果）
  vec3 getStars(vec2 uv, float t) {
    vec3 col = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float scale = 8.0 + fi * 15.0;
      vec2 gv = uv * scale;
      vec2 id = floor(gv);
      vec2 lv = fract(gv) - 0.5;
      float h = hash(id + fi * 53.7);
      float threshold = (i == 0) ? 0.985 : 0.97;
      if (h > threshold) {
        float d = length(lv);
        float size = (i == 0) ? 0.04 : 0.025;
        float star = smoothstep(size, 0.0, d);
        float bright = hash(id + fi * 91.3) * 0.5 + 0.5;
        float twinkle = 0.6 + 0.4 * sin(t * 1.8 + h * 50.0);
        vec3 starCol = mix(vec3(0.9, 0.95, 1.0), vec3(0.7, 0.8, 1.0), hash(id + fi * 7.1));
        col += starCol * star * bright * twinkle;
        if (bright > 0.8) {
          float crossX = smoothstep(0.015, 0.0, abs(lv.x)) * smoothstep(0.04, 0.0, abs(lv.y));
          float crossY = smoothstep(0.015, 0.0, abs(lv.y)) * smoothstep(0.04, 0.0, abs(lv.x));
          col += starCol * (crossX + crossY) * 0.25 * bright * twinkle;
        }
      }
    }
    return col;
  }

  // ===== 分形噪声（星云 / 银河共用）=====
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  // ===== 区域2: 彩色星云团 =====
  vec3 getNebula(vec2 uv, float t) {
    vec2 p = uv * 3.0;
    p.x += t * 0.02;
    float n1 = fbm(p);
    float n2 = fbm(p * 1.5 + vec2(5.0, 3.0));
    float n3 = fbm(p * 0.8 + vec2(-3.0, 7.0));
    vec3 col = vec3(0.02, 0.0, 0.05);               // 深紫底
    col += vec3(0.6, 0.2, 0.8) * smoothstep(0.3, 0.7, n1) * 0.7;  // 紫色云团
    col += vec3(0.2, 0.5, 1.0) * smoothstep(0.4, 0.8, n2) * 0.5;  // 蓝色云团
    col += vec3(1.0, 0.4, 0.7) * smoothstep(0.5, 0.9, n3) * 0.4;  // 粉色云团
    col += getStars(uv * 4.0, t) * 0.7;             // 叠加星星
    return col;
  }

  // ===== 区域3: 巨大恒星轮廓 =====
  vec3 getGiantStar(vec2 uv, float t) {
    vec2 center = vec2(0.5 + sin(t * 0.1) * 0.1, 0.5 + cos(t * 0.13) * 0.08);
    float d = length(uv - center);
    float star = smoothstep(0.35, 0.30, d);          // 恒星本体
    float corona = exp(-d * 4.0) * 0.8;              // 外日冕
    float corona2 = exp(-d * 8.0) * 1.5;             // 内日冕
    float granulation = noise(uv * 30.0 + t * 0.5) * 0.3;  // 表面颗粒
    vec3 col = vec3(0.01, 0.0, 0.0);                 // 深空底
    col += vec3(1.0, 0.6, 0.2) * corona;             // 橙色外冕
    col += vec3(1.0, 0.85, 0.5) * corona2;           // 黄色内冕
    col += vec3(1.0, 0.95, 0.8) * star;              // 恒星表面
    col += vec3(0.3, 0.15, 0.05) * granulation * star;
    // 日珥（旋转尖刺）
    float angle = atan(uv.y - center.y, uv.x - center.x);
    float flare = pow(0.5 + 0.5 * sin(angle * 8.0 + t * 2.0), 8.0);
    col += vec3(1.0, 0.5, 0.2) * flare * smoothstep(0.4, 0.3, d) * 0.5;
    col += getStars(uv * 3.0, t) * 0.3;              // 背景星
    return col;
  }

  // ===== 区域4: 流星雨 =====
  vec3 getMeteors(vec2 uv, float t) {
    vec3 col = vec3(0.0, 0.0, 0.02);                 // 深蓝底
    col += getStars(uv * 4.0, t) * 0.5;              // 背景星
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float period = 2.5 + fi * 0.7;
      float phase = mod(t * 0.6 + fi * 1.3, period);
      float life = phase / period;
      vec2 start = vec2(0.9 + fi * 0.05, 1.1);
      vec2 end = vec2(-0.1 - fi * 0.03, -0.1);
      vec2 pos = mix(start, end, life);
      vec2 toPixel = uv - pos;
      vec2 dir = normalize(end - start);
      float along = dot(toPixel, dir);
      float perp = abs(toPixel.x * dir.y - toPixel.y * dir.x);
      float head = exp(-length(toPixel) * 30.0);     // 流星头
      float tail = exp(-along * 3.0) * exp(-perp * 60.0);  // 流星尾
      tail *= step(0.0, along);
      float alpha = sin(life * 3.14159);             // 淡入淡出
      vec3 meteorCol = mix(vec3(0.6, 0.9, 1.0), vec3(1.0, 1.0, 0.9), fi * 0.2);
      col += meteorCol * (head + tail * 0.6) * alpha;
    }
    return col;
  }

  // ===== 区域5: 螺旋银河 =====
  vec3 getGalaxy(vec2 uv, float t) {
    vec2 center = vec2(0.5, 0.5);
    vec2 p = uv - center;
    float r = length(p);
    float angle = atan(p.y, p.x);
    float spiral = sin(angle * 2.0 + r * 12.0 - t * 0.3);
    float arms = pow(max(0.0, spiral), 3.0);
    float density = fbm(vec2(angle * 2.0, r * 8.0) + t * 0.05);
    float core = exp(-r * 6.0);                      // 银核
    float coreGlow = exp(-r * 2.5);                  // 银核光晕
    vec3 col = vec3(0.01, 0.01, 0.02);
    col += vec3(1.0, 0.95, 0.8) * core * 1.5;        // 白黄色银核
    col += vec3(1.0, 0.8, 0.5) * coreGlow * 0.5;
    col += vec3(0.4, 0.5, 1.0) * arms * smoothstep(0.05, 0.3, r) * 0.6;  // 蓝色旋臂
    col += vec3(0.8, 0.4, 0.9) * density * arms * 0.4;                    // 紫色尘埃
    col += vec3(0.3, 0.2, 0.5) * density * smoothstep(0.1, 0.4, r) * 0.3;
    col += getStars(uv * 3.0, t) * 0.4;
    return col;
  }

  void main() {
    float scroll = time * speed * 0.06;
    vec2 uv = vUv;

    // ===== 长方形窗户参数 =====
    float winBot = 0.18;
    float winTop = 0.82;
    float frameWidth = 0.015;
    float glowWidth = 0.04;

    float glassBottom = winBot + frameWidth;
    float glassTop    = winTop - frameWidth;
    float inGlass = step(glassBottom, uv.y) * step(uv.y, glassTop);

    float frameBottom = smoothstep(winBot, winBot + frameWidth, uv.y) *
                       (1.0 - smoothstep(glassBottom, glassBottom + frameWidth * 0.5, uv.y));
    float frameTop = smoothstep(glassTop, winTop, uv.y) *
                     (1.0 - smoothstep(winTop, winTop + frameWidth * 0.5, uv.y));
    float inFrame = max(frameBottom, frameTop);

    float glowBottom = smoothstep(winBot - glowWidth, winBot, uv.y) *
                       (1.0 - smoothstep(winBot, winBot + frameWidth, uv.y));
    float glowTop = smoothstep(winTop, winTop + glowWidth, uv.y) *
                    (1.0 - smoothstep(winTop - frameWidth, winTop, uv.y));
    float inGlow = max(glowBottom, glowTop);

    float isWall = 1.0 - inGlass - inFrame - inGlow;
    isWall = clamp(isWall, 0.0, 1.0);

    // ===== 窗外景色（按区域切换）=====
    vec3 space;
    if (zoneId < 1.5) {
      // 区域1: 普通星空
      vec2 spaceUv = vec2(uv.x * 3.5, (uv.y + scroll) * 4.0);
      space = vec3(0.0, 0.0, 0.01);
      space += getStars(spaceUv, time);
    } else if (zoneId < 2.5) {
      // 区域2: 彩色星云团
      space = getNebula(vec2(uv.x, uv.y + scroll), time);
    } else if (zoneId < 3.5) {
      // 区域3: 巨大恒星轮廓
      space = getGiantStar(vec2(uv.x, uv.y + scroll * 0.3), time);
    } else if (zoneId < 4.5) {
      // 区域4: 流星雨
      space = getMeteors(vec2(uv.x, uv.y + scroll), time);
    } else {
      // 区域5: 螺旋银河
      space = getGalaxy(vec2(uv.x, uv.y + scroll * 0.2), time);
    }

    // 玻璃边缘暗角
    float edgeFade = 1.0 - (1.0 - smoothstep(0.0, 0.25, uv.y - glassBottom)) *
                           (1.0 - smoothstep(0.0, 0.25, glassTop - uv.y)) * 0.35;
    space *= edgeFade;

    // 玻璃反射光斑
    vec2 glarePos = vec2(0.5, 0.5);
    float glare = exp(-length(uv - glarePos) * 2.0) * 0.06;
    space += vec3(0.5, 0.7, 0.9) * glare * inGlass;

    // ===== 金属窗框 =====
    vec3 innerMetal = vec3(0.25, 0.27, 0.3);
    vec3 outerMetal = vec3(0.65, 0.68, 0.72);
    float grad = 0.0;
    if (frameBottom > 0.0) grad = (uv.y - winBot) / frameWidth;
    if (frameTop > 0.0) grad = (winTop - uv.y) / frameWidth;
    grad = clamp(grad, 0.0, 1.0);
    vec3 frameCol = mix(innerMetal, outerMetal, smoothstep(0.2, 0.8, grad));
    frameCol += noise(uv * 35.0) * 0.015;
    frameCol = mix(frameCol, frameCol * zoneTint, 0.25);

    // ===== 发光过渡区 =====
    vec3 glowColor = mix(
      outerMetal,
      mix(vec3(0.2, 0.8, 1.0), vec3(0.6, 1.0, 0.9), sin(time * 2.0) * 0.5 + 0.5),
      0.6
    );
    glowColor = mix(glowColor, glowColor * zoneTint, 0.35);
    float glowIntensity = 0.0;
    if (glowBottom > 0.0) glowIntensity = smoothstep(winBot - glowWidth, winBot, uv.y);
    if (glowTop > 0.0) glowIntensity = smoothstep(winTop, winTop + glowWidth, uv.y);
    vec3 glowCol = glowColor * glowIntensity * 0.7;

    // ===== 科技墙壁 =====
    vec3 wallCol = vec3(0.5, 0.52, 0.57);
    float panelLine1 = smoothstep(0.13, 0.135, uv.y) * (1.0 - smoothstep(0.14, 0.145, uv.y));
    float panelLine2 = smoothstep(0.86, 0.865, uv.y) * (1.0 - smoothstep(0.87, 0.875, uv.y));
    wallCol = mix(wallCol, wallCol * 0.7, max(panelLine1, panelLine2) * 0.6);
    float rib = abs(sin(uv.x * 25.0)) < 0.15 ? 0.08 : 0.0;
    wallCol -= rib;
    float rivetUvX = mod(uv.x * 8.0, 1.0);
    float rivetUvY = uv.y;
    bool isRivetArea = false;
    if (rivetUvY > 0.1 && rivetUvY < 0.16 && abs(rivetUvX - 0.5) < 0.08) isRivetArea = true;
    if (rivetUvY > 0.84 && rivetUvY < 0.9 && abs(rivetUvX - 0.5) < 0.08) isRivetArea = true;
    if (isRivetArea) {
      float d = length(vec2(rivetUvX - 0.5, rivetUvY - (rivetUvY < 0.5 ? 0.13 : 0.87)) * 8.0);
      float rivet = 1.0 - smoothstep(0.25, 0.35, d);
      wallCol = mix(wallCol, vec3(0.85, 0.88, 0.92), rivet * 0.7);
    }
    float wallBlendBottom = smoothstep(winBot - glowWidth, winBot - glowWidth * 0.3, uv.y);
    float wallBlendTop = smoothstep(winTop + glowWidth * 0.3, winTop + glowWidth, uv.y);
    wallCol = mix(wallCol, glowColor * 0.3, (1.0 - wallBlendBottom) + (1.0 - wallBlendTop));
    float wallDark = 1.0 - smoothstep(0.0, 0.06, uv.y) * 0.4 - smoothstep(0.94, 1.0, uv.y) * 0.4;
    wallCol *= wallDark;
    wallCol = mix(wallCol, wallCol * zoneTint, 0.3);

    // ===== 合成 =====
    vec3 color = space * inGlass + frameCol * inFrame + glowCol * inGlow + wallCol * isWall;
    gl_FragColor = vec4(color, 1.0);
  }
`;




// Pre-created shared wall materials and geometries
const wallMaterials = WALL_COLORS.map(c => new THREE.ShaderMaterial({
  vertexShader: wallVertexShader,
  fragmentShader: wallFragmentShader,
  uniforms: {
    time: { value: 0 },
    speed: { value: 9.0 },
    zoneTint: { value: new THREE.Color(c) },
    zoneId: { value: 1 }
  }
}));


const WALL_THICKNESS = 0.3;
const wallGeoDefs = [
  [R*2, WALL_THICKNESS, SEG_LEN], [WALL_THICKNESS, R*2, SEG_LEN], [R*2, WALL_THICKNESS, SEG_LEN], [WALL_THICKNESS, R*2, SEG_LEN]
];
const wallGeometries = wallGeoDefs.map(s => new THREE.BoxGeometry(...s));
const wallEdgesGeos = wallGeometries.map(g => new THREE.EdgesGeometry(g));
const wallEdgeMats = WALL_COLORS.map(c => new THREE.LineBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.12 }));


const wallPosDefs = [
  [0, -R, 0], [R, 0, 0], [0, R, 0], [-R, 0, 0]
];

// mulberry32 种子伪随机数生成器
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ============ 对象池与共享几何体 (Object Pooling) ============
const obstacleGeometry = new THREE.BoxGeometry(CONFIG.OBSTACLE_SIZE, CONFIG.OBSTACLE_SIZE, CONFIG.OBSTACLE_SIZE);
const obstacleMaterial = new THREE.MeshStandardMaterial({
  color: OBSTACLE_COLOR,
  emissive: OBSTACLE_COLOR,
  emissiveIntensity: 0.35,
  roughness: 0.4
});

const laserGeometry = new THREE.CylinderGeometry(0.08, 0.08, 7.8, 8);
laserGeometry.rotateZ(Math.PI / 2);
const laserMaterial = new THREE.MeshStandardMaterial({
  color: OBSTACLE_COLOR,
  emissive: OBSTACLE_COLOR,
  emissiveIntensity: 1.5,
  roughness: 0.2
});

const powerupGeometries = {
  energy: new THREE.SphereGeometry(0.8, 16, 16),
  invincible: new THREE.SphereGeometry(0.8, 16, 16),
  shield: new THREE.OctahedronGeometry(0.7),
  magnet: new THREE.TorusGeometry(0.45, 0.15, 8, 20),
  boost: new THREE.ConeGeometry(0.5, 1.1, 12)
};

const powerupMaterials = {
  energy:     new THREE.MeshStandardMaterial({ color: POWERUP_COLORS.energy,     emissive: POWERUP_COLORS.energy,     emissiveIntensity: 0.5, roughness: 0.2 }),
  invincible: new THREE.MeshStandardMaterial({ color: POWERUP_COLORS.invincible, emissive: POWERUP_COLORS.invincible, emissiveIntensity: 0.5, roughness: 0.2 }),
  shield:     new THREE.MeshStandardMaterial({ color: POWERUP_COLORS.shield,     emissive: POWERUP_COLORS.shield,     emissiveIntensity: 0.6, roughness: 0.1, transparent: true, opacity: 0.95 }),
  magnet:     new THREE.MeshStandardMaterial({ color: POWERUP_COLORS.magnet,     emissive: POWERUP_COLORS.magnet,     emissiveIntensity: 0.6, roughness: 0.3 }),
  boost:      new THREE.MeshStandardMaterial({ color: POWERUP_COLORS.boost,      emissive: POWERUP_COLORS.boost,      emissiveIntensity: 0.7, roughness: 0.2 })
};

// ============ 通用对象池工厂 ============
function createPool(factory, onGet) {
  const free = [];
  return {
    get() {
      let item = free.pop();
      if (!item) item = factory();
      item.visible = true;
      if (onGet) onGet(item);
      return item;
    },
    return(item) {
      if (item.parent) item.parent.remove(item);
      item.visible = false;
      free.push(item);
    }
  };
}

const obstaclePool = createPool(
  () => new THREE.Mesh(obstacleGeometry, obstacleMaterial),
  (obs) => obs.scale.set(1, 1, 1)
);
const laserPool = createPool(
  () => new THREE.Mesh(laserGeometry, laserMaterial),
  (laser) => laser.scale.set(1, 1, 1)
);
const powerupPools = {};
['energy','invincible','shield','magnet','boost'].forEach(type => {
  powerupPools[type] = createPool(() => {
    const group = new THREE.Group();

    // ---------- 共享辅助函数 ----------
    const createGlowRing = (color, radius = 0.9, opacity = 0.3) => {
      const mat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.05, radius, 32), mat);
      ring.rotation.x = Math.PI / 2;
      return ring;
    };

    switch (type) {
      // ===== 1. 能量（钻石 + 旋转光环） =====
      case 'energy': {
        // 内核：高透钻石（八面体）
        const coreMat = new THREE.MeshPhysicalMaterial({
          color: 0x00e5c7,
          emissive: 0x00e5c7,
          emissiveIntensity: 0.8,
          metalness: 0.1,
          roughness: 0.15,
          clearcoat: 1.0,
          clearcoatRoughness: 0.1,
          transparent: true,
          opacity: 0.92,
          envMapIntensity: 0.6
        });
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), coreMat);
        group.add(core);

        // 外圈：旋转能量环
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x00e5c7,
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending
        });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 24), ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.05;
        group.add(ring);

        // 小粒子环（倾斜）
        const dotMat = new THREE.PointsMaterial({
          color: 0x88fff0,
          size: 0.08,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const dotGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(12 * 3);
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          positions[i*3] = Math.cos(angle) * 1.1;
          positions[i*3+1] = Math.sin(angle) * 0.2;
          positions[i*3+2] = Math.sin(angle) * 1.1;
        }
        dotGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const dots = new THREE.Points(dotGeo, dotMat);
        group.add(dots);
        break;
      }

      // ===== 2. 无敌（恒星爆裂 + 尖刺） =====
      case 'invincible': {
        // 内核：高光二十面体（复杂切面）
        const coreMat = new THREE.MeshPhysicalMaterial({
          color: 0xff8b3d,
          emissive: 0xff5500,
          emissiveIntensity: 1.2,
          metalness: 0.3,
          roughness: 0.2,
          clearcoat: 0.5
        });
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), coreMat);
        group.add(core);

        // 八根尖刺（旋转的星芒）
        const spikeMat = new THREE.MeshStandardMaterial({
          color: 0xffaa44,
          emissive: 0xff6600,
          emissiveIntensity: 0.9
        });
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 4), spikeMat);
          spike.position.set(Math.cos(angle) * 0.85, Math.sin(angle) * 0.85, 0);
          spike.rotation.z = angle - Math.PI / 2;
          group.add(spike);
        }

        // 外发光环（双环交叉）
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0xff6600,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending
        });
        const ring1 = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 32), glowMat);
        ring1.rotation.x = Math.PI / 2;
        const ring2 = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 32), glowMat);
        ring2.rotation.z = Math.PI / 2;
        group.add(ring1, ring2);
        break;
      }

      // ===== 3. 护盾（六边形能量盾 + 边框） =====
      case 'shield': {
        // 主体：六边形平板（半透明）
        const shieldMat = new THREE.MeshPhysicalMaterial({
          color: 0x3b82f6,
          emissive: 0x1d4ed8,
          emissiveIntensity: 0.6,
          metalness: 0.1,
          roughness: 0.3,
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
          clearcoat: 0.8
        });
        const shieldGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.12, 6);
        const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
        shieldMesh.rotation.x = Math.PI / 2;
        group.add(shieldMesh);

        // 外边框：发光六边形线框
        const edgeMat = new THREE.LineBasicMaterial({
          color: 0x60a5fa,
          transparent: true,
          opacity: 0.9
        });
        const edgeGeo = new THREE.EdgesGeometry(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 6));
        const edgeLine = new THREE.LineSegments(edgeGeo, edgeMat);
        edgeLine.rotation.x = Math.PI / 2;
        group.add(edgeLine);

        // 内层旋转三角形（能量聚焦）
        const innerMat = new THREE.MeshBasicMaterial({
          color: 0x93c5fd,
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending
        });
        const tri = new THREE.Mesh(new THREE.CircleGeometry(0.5, 3), innerMat);
        tri.rotation.x = Math.PI / 2;
        group.add(tri);

        // 能量球（中心核心）
        const coreMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0x3b82f6,
          emissiveIntensity: 1.5
        });
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), coreMat);
        group.add(core);
        break;
      }

      // ===== 4. 磁铁（U形马蹄 + 磁场线） =====
      case 'magnet': {
        const metalMat = new THREE.MeshPhysicalMaterial({
          color: 0xdc2626,
          emissive: 0xdc2626,
          emissiveIntensity: 0.5,
          metalness: 0.95,
          roughness: 0.25,
          clearcoat: 0.3
        });
        // 左柱
        const pillarL = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8), metalMat);
        pillarL.position.set(-0.35, 0.15, 0);
        // 右柱
        const pillarR = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8), metalMat);
        pillarR.position.set(0.35, 0.15, 0);
        // 横梁
        const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.15), metalMat);
        topBar.position.set(0, 0.45, 0);
        // 底座（增加厚重感）
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.2), metalMat);
        base.position.set(0, -0.1, 0);
        group.add(pillarL, pillarR, topBar, base);

        // 磁场弧线（发光虚线环）
        const fieldMat = new THREE.MeshBasicMaterial({
          color: 0xf87171,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending
        });
        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 8, 24), fieldMat);
        arc.position.y = 0.2;
        arc.rotation.x = Math.PI / 2;
        group.add(arc);

        // 第二层弧（垂直方向）
        const arc2 = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 8, 24), fieldMat);
        arc2.position.y = 0.2;
        arc2.rotation.z = Math.PI / 2;
        group.add(arc2);
        break;
      }

      // ===== 5. 加速（火箭箭矢 + 尾焰） =====
      case 'boost': {
        const bodyMat = new THREE.MeshPhysicalMaterial({
          color: 0x10b981,
          emissive: 0x10b981,
          emissiveIntensity: 0.8,
          metalness: 0.4,
          roughness: 0.2,
          clearcoat: 0.6
        });
        // 箭头主体（锥体）
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.5, 8), bodyMat);
        head.position.y = 0.35;
        // 箭杆
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 6), bodyMat);
        shaft.position.y = -0.05;
        // 尾翼（十字交叉）
        const finMat = new THREE.MeshStandardMaterial({
          color: 0x047857,
          emissive: 0x047857,
          emissiveIntensity: 0.4
        });
        const fin1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.35), finMat);
        fin1.position.set(0, -0.25, 0);
        const fin2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.02), finMat);
        fin2.position.set(0, -0.25, 0);
        group.add(head, shaft, fin1, fin2);

        // 尾焰（锥形光晕，使用 AdditiveBlending 模拟喷射）
        const flameMat = new THREE.MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.4, 6), flameMat);
        flame.position.y = -0.5;
        flame.rotation.x = Math.PI;
        group.add(flame);

        // 尾部光晕（更亮的点）
        const glowMat = new THREE.SpriteMaterial({
          map: (() => {
            const canvas = document.createElement('canvas');
            canvas.width = 32; canvas.height = 32;
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 1)');
            gradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.6)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 32, 32);
            return new THREE.CanvasTexture(canvas);
          })(),
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const glowSprite = new THREE.Sprite(glowMat);
        glowSprite.position.y = -0.7;
        glowSprite.scale.set(0.6, 0.6, 1);
        group.add(glowSprite);
        break;
      }
    }

    group.userData.type = type;
    return group;
  });
});

function getObstacleFromPool() { return obstaclePool.get(); }
function returnObstacleToPool(obs) { obstaclePool.return(obs); }
function getLaserFromPool() { return laserPool.get(); }
function returnLaserToPool(laser) { laserPool.return(laser); }
function getPowerupFromPool(type) { return powerupPools[type].get(); }
function returnPowerupToPool(pup) { powerupPools[pup.userData.type].return(pup); }

// ============ 段创建与生成 ============
function createSegment(startZ) {
  const group = new THREE.Group();
  group.position.z = startZ;
  group.userData.obstacles = [];
  group.userData.powerups = [];

  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(wallGeometries[i], wallMaterials[i]);
    mesh.position.set(...wallPosDefs[i]);
    group.add(mesh);

    const line = new THREE.LineSegments(wallEdgesGeos[i], wallEdgeMats[i]);
    line.position.set(...wallPosDefs[i]);
    group.add(line);
  }

  world.add(group);
  return group;
}

function spawnObstacles(seg, spawnDistance) {
  seg.userData.obstacles.forEach(o => {
    if (o.type === 'laser') returnLaserToPool(o.mesh);
    else returnObstacleToPool(o.mesh);
  });
  seg.userData.obstacles = [];

  const settings = difficultySettings[currentDifficulty];
  const curve = getDifficultyAt(spawnDistance);

  const effectiveMaxWalls = Math.min(3, Math.floor(curve.maxWallsBase * settings.obstacleMultiplier * dynamicDifficultyMod) + 1);
  let availablePatterns = PATTERNS.filter(p => spawnDistance >= p.minDist && p.walls.length <= effectiveMaxWalls);
  if (availablePatterns.length === 0) availablePatterns = [{ walls: [0], weight: 1 }];
  let totalWeight = availablePatterns.reduce((s, p) => s + p.weight, 0);
  let roll = gameRng() * totalWeight;
  let selectedPattern = availablePatterns[0];
  for (const p of availablePatterns) {
    roll -= p.weight;
    if (roll <= 0) { selectedPattern = p; break; }
  }
  const wallsToBlock = selectedPattern.walls;

  seg.userData.isBranch = false;
  if (selectedPattern.isBranch) {
    seg.userData.isBranch = true;
    seg.userData.branchSafeState = selectedPattern.branchSafe[Math.floor(gameRng() * selectedPattern.branchSafe.length)];
  }

  // ========== 区域主题配置 ==========
  const zone = Math.min(5, Math.floor(spawnDistance / REGION_LENGTH) + 1);
  const themes = {
    1: { // 太空站：科技六角柱
      obstacleGeo: () => new THREE.CylinderGeometry(0.6, 0.6, 1.15, 6),
      obstacleMat: new THREE.MeshPhysicalMaterial({
        color: 0x4fc3f7,
        emissive: 0x0288d1,
        emissiveIntensity: 0.4,
        metalness: 0.8,
        roughness: 0.2,
        clearcoat: 0.6,
        transparent: true,
        opacity: 0.9
      }),
      laserMat: new THREE.MeshPhysicalMaterial({
        color: 0x4fc3f7,
        emissive: 0x0288d1,
        emissiveIntensity: 1.2,
        metalness: 0.1,
        roughness: 0.1,
        transparent: true,
        opacity: 0.7
      }),
      edgeColor: 0x4fc3f7,
      rotateSpeed: 1.0
    },
    2: { // 星云：水晶八面体
      obstacleGeo: () => new THREE.OctahedronGeometry(0.75),
      obstacleMat: new THREE.MeshPhysicalMaterial({
        color: 0xab47bc,
        emissive: 0x7b1fa2,
        emissiveIntensity: 0.6,
        metalness: 0.0,
        roughness: 0.1,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        transparent: true,
        opacity: 0.85,
        envMapIntensity: 0.5
      }),
      laserMat: new THREE.MeshPhysicalMaterial({
        color: 0xab47bc,
        emissive: 0x7b1fa2,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.8
      }),
      edgeColor: 0xce93d8,
      rotateSpeed: 0.8
    },
    3: { // 恒星：熔岩球体+尖刺
      obstacleGeo: () => {
        const group = new THREE.Group();
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 12),
          new THREE.MeshPhysicalMaterial({ color: 0xff6f00, emissive: 0xe65100, emissiveIntensity: 0.9, roughness: 0.9, metalness: 0.1 })
        );
        group.add(core);
        for (let i = 0; i < 6; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 4),
            new THREE.MeshStandardMaterial({ color: 0xff6f00, emissive: 0xbf360c, emissiveIntensity: 0.5 })
          );
          const theta = (i / 6) * Math.PI * 2;
          spike.position.set(Math.cos(theta)*0.7, Math.sin(theta)*0.7, 0);
          spike.rotation.z = theta;
          group.add(spike);
        }
        return group;
      },
      obstacleMat: null, // 使用内部材质
      laserMat: new THREE.MeshPhysicalMaterial({
        color: 0xff6f00,
        emissive: 0xe65100,
        emissiveIntensity: 1.8,
        roughness: 0.4
      }),
      edgeColor: 0xffab00,
      rotateSpeed: 1.5
    },
    4: { // 深空：十字交叉镖
      obstacleGeo: () => {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
          color: 0x66bb6a,
          emissive: 0x2e7d32,
          emissiveIntensity: 0.5,
          metalness: 0.7,
          roughness: 0.3
        });
        const bar1 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 0.2), mat);
        const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.2), mat);
        bar2.rotation.z = Math.PI/4; // 让十字旋转45度更动感
        group.add(bar1, bar2);
        return group;
      },
      obstacleMat: null,
      laserMat: new THREE.MeshPhysicalMaterial({
        color: 0x66bb6a,
        emissive: 0x2e7d32,
        emissiveIntensity: 1.5
      }),
      edgeColor: 0xa5d6a7,
      rotateSpeed: 2.0
    },
    5: { // 银河：发光棱镜
      obstacleGeo: () => new THREE.DodecahedronGeometry(0.7),
      obstacleMat: new THREE.MeshPhysicalMaterial({
        color: 0xffd54f,
        emissive: 0xffb300,
        emissiveIntensity: 1.0,
        metalness: 0.9,
        roughness: 0.1,
        clearcoat: 0.2,
        envMapIntensity: 0.8
      }),
      laserMat: new THREE.MeshPhysicalMaterial({
        color: 0xffd54f,
        emissive: 0xffb300,
        emissiveIntensity: 2.0
      }),
      edgeColor: 0xffecb3,
      rotateSpeed: 0.6
    }
  };

  const theme = themes[zone] || themes[1];

  wallsToBlock.forEach(state => {
    const spread = currentSpread || 1.0;
const zRange = (selectedPattern.tightGap ? 0.35 : 0.55) * spread;
    const localZ = (gameRng()-0.5) * SEG_LEN * zRange;
    const isLaser = gameRng() < curve.laserChance;

    let mesh;
    let type = 'box';
    const size = CONFIG.OBSTACLE_SIZE;

    if (isLaser) {
      // 激光使用 region 专属材质
      const laserMat = theme.laserMat.clone();
      mesh = getLaserFromPool();
      mesh.material = laserMat;
      type = 'laser';
      // 激光位置和旋转逻辑不变
      if (state === 0 || state === 2) {
        mesh.rotation.set(0, 0, 0);
        mesh.position.set(0, (state === 0 ? -R + 0.8 : R - 0.8), localZ);
      } else {
        mesh.rotation.set(0, 0, Math.PI / 2);
        mesh.position.set((state === 1 ? R - 0.8 : -R + 0.8), 0, localZ);
      }
    } else {
      // 障碍物
      let geoOrGroup;
      if (typeof theme.obstacleGeo === 'function') {
        geoOrGroup = theme.obstacleGeo();
      } else {
        // fallback
        geoOrGroup = new THREE.BoxGeometry(size, size, size);
      }

      let mat;
      if (theme.obstacleMat) {
        mat = theme.obstacleMat.clone();
      } else {
        mat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 0.5 });
      }

      // 如果返回的是Group，需要遍历其子Mesh设置材质
      if (geoOrGroup.isGroup) {
        mesh = geoOrGroup;
        mesh.traverse(child => {
          if (child.isMesh) {
            if (!child.material) child.material = mat;
            else child.material = mat.clone();
          }
        });
      } else {
        mesh = new THREE.Mesh(geoOrGroup, mat);
      }

      type = 'box';
     let pos;
     const offset = 0.2; // 向内偏移量，让玩家可以从墙壁边缘通过
     if (state===0) pos = [0, -R + size/2 + offset, localZ];
      if (state===1) pos = [R - size/2 - offset, 0, localZ];
      if (state===2) pos = [0, R - size/2 - offset, localZ];
      if (state===3) pos = [-R + size/2 + offset, 0, localZ];
      mesh.position.set(...pos);
      mesh.rotation.set(0, 0, 0);
    }

    seg.add(mesh);

    const isMoving = !isLaser && (gameRng() < curve.movingChance * settings.obstacleMultiplier);
    // 根据区域调整旋转速度
    const rotationSpeed = !isLaser ? (0.5 + gameRng() * 1.5) * theme.rotateSpeed : 0;

    seg.userData.obstacles.push({
      mesh,
      state,
      localZ,
      height: isLaser ? 0.2 : size,
      type,
      isMoving,
      moveDirection: gameRng() < 0.5 ? 1 : -1,
      moveSpeed: curve.moveSpeedMin + gameRng() * (curve.moveSpeedMax - curve.moveSpeedMin),
      rotationSpeed,
      armingTimer: isLaser ? 0.45 : 0,
      armed: isLaser ? false : true,
      zoneEffect: getZoneEffect(zone),
      blinkTimer: 0,
      pulseTimer: 0,
      swapTimer: 0
    });
  });
}

function spawnPowerups(seg, spawnDistance) {
  seg.userData.powerups.forEach(p => {
    returnPowerupToPool(p.mesh);
  });
  seg.userData.powerups = [];

  const settings = difficultySettings[currentDifficulty];
  const curve = getDifficultyAt(spawnDistance);
  const powerupChance = curve.powerupChance * settings.powerupMultiplier;

  if (gameRng() < powerupChance) {
    const rand = gameRng();
    let type = 'energy';
    if (rand < 0.35) type = 'energy';
    else if (rand < 0.55) type = 'invincible';
    else if (rand < 0.75) type = 'shield';
    else if (rand < 0.90) type = 'magnet';
    else type = 'boost';

    const isHighValue = (type === 'invincible' || type === 'boost');
    let state, localZ;

    // 分支路径：在安全侧放高价值道具
    if (seg.userData.isBranch && seg.userData.branchSafeState !== undefined) {
      state = seg.userData.branchSafeState;
      type = gameRng() < 0.6 ? 'boost' : 'invincible';
      localZ = (gameRng()-0.5) * SEG_LEN * 0.4;
      seg.userData.isBranch = false;
    } else if (isHighValue && seg.userData.obstacles.length > 0) {
      // 高价值道具：放在障碍物附近（紧贴后方，制造风险-收益选择）
      const nearestObs = seg.userData.obstacles[0];
      state = nearestObs.state;
      localZ = nearestObs.localZ + 0.5 + gameRng() * 1.0;
    } else {
      // 低价值道具或无障碍段：保持随机位置
      state = Math.floor(gameRng() * 4);
      localZ = (gameRng()-0.5) * SEG_LEN * 0.55;
    }

    const mesh = getPowerupFromPool(type);
    const size = 0.8;

    let pos;
    if (state===0) pos = [0, -R+size/2, localZ];
    if (state===1) pos = [R-size/2, 0, localZ];
    if (state===2) pos = [0, R-size/2, localZ];
    if (state===3) pos = [-R+size/2, 0, localZ];
    mesh.position.set(...pos);
    mesh.rotation.set(0, 0, 0);

    seg.add(mesh);
    seg.userData.powerups.push({ mesh, state, localZ, type });
  }
}

const segments = [];
for (let i=0;i<NUM_SEGMENTS;i++) segments.push(createSegment(-i*SEG_LEN));

// ============ 玩家角色与特效附件 ============
const player = new THREE.Group();
const BASE_Y = -R + 0.85;
player.position.set(0, BASE_Y, PLAYER_Z);
scene.add(player);

const playerLight = new THREE.PointLight(0x4ee6e0, 1.5, 18);
playerLight.position.set(0, 1, 0);
player.add(playerLight);

// ---- 科技感材质系统 ----
// 主体：微光泽白色装甲
const bodyMat = new THREE.MeshStandardMaterial({
  color: 0xe8edf5,
  roughness: 0.35,
  metalness: 0.15
});

// 装饰/发光件：青蓝色半透明合金
const accentMat = new THREE.MeshPhysicalMaterial({
  color: 0x3ef0e8,
  emissive: 0x3ef0e8,
  emissiveIntensity: 0.65,
  metalness: 0.25,
  roughness: 0.2,
  clearcoat: 0.35,
  transparent: true,
  opacity: 0.95
});

// 高能核心：强烈自发光
const coreMat = new THREE.MeshPhysicalMaterial({
  color: 0x3ef0e8,
  emissive: 0x3ef0e8,
  emissiveIntensity: 1.2,
  metalness: 0.1,
  roughness: 0.05,
  transparent: true,
  opacity: 0.92,
  clearcoat: 0.5
});

// 深色金属（关节/结构件）
const darkMetalMat = new THREE.MeshStandardMaterial({
  color: 0x2a2e35,
  roughness: 0.3,
  metalness: 0.9
});

// ---- 头部：全封闭头盔 + 全景面罩 ----
const headGroup = new THREE.Group();
headGroup.position.y = 0.94;

// 头盔主体（球形，使用 bodyMat 并增加深色底部收边）
const helmetBase = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12, 0, Math.PI*2, 0, Math.PI*0.65), bodyMat);
helmetBase.position.y = 0.0;
headGroup.add(helmetBase);

// 头盔深色下沿（环）
const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 16), darkMetalMat);
rim.position.y = -0.01;
rim.rotation.x = Math.PI/2;
headGroup.add(rim);

// 面罩（大型透明曲面，覆盖前方）
const visorGeom = new THREE.SphereGeometry(0.2, 16, 12,
  -Math.PI*0.5, Math.PI,
  Math.PI*0.2, Math.PI*0.5);
const visorMat = new THREE.MeshPhysicalMaterial({
  color: 0x3ef0e8,
  emissive: 0x3ef0e8,
  emissiveIntensity: 0.7,
  metalness: 0.1,
  roughness: 0.05,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  clearcoat: 0.8
});
const visor = new THREE.Mesh(visorGeom, visorMat);
visor.position.set(0, 0.01, 0.01);
headGroup.add(visor);

// 头顶通信阵列（三个小棱锥）
for (let i = 0; i < 3; i++) {
  const angle = (i / 3) * Math.PI * 2;
  const ant = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), accentMat);
  ant.position.set(Math.sin(angle)*0.12, 0.18, Math.cos(angle)*0.12);
  ant.rotation.x = -0.3;
  headGroup.add(ant);
}

// 呼吸灯（微小发光点）
const breather = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 4), coreMat);
breather.position.set(0, -0.1, 0.23);
headGroup.add(breather);

player.add(headGroup);
const head = headGroup; // 兼容

// ---- 躯干：装甲板 + 核心反应堆 ----
const torsoGroup = new THREE.Group();
torsoGroup.position.y = 0.46;

// 主躯干（圆柱削切感，使用 bodyMat）
const torsoMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.6, 8), bodyMat);
torsoMesh.position.y = 0;
torsoGroup.add(torsoMesh);

// 胸甲（前面板，深色金属）
const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.25, 0.12), darkMetalMat);
chestPlate.position.set(0, 0.05, 0.23);
torsoGroup.add(chestPlate);

// 能量核心（多层结构）
const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), coreMat);
coreSphere.position.set(0, 0.08, 0.27);
torsoGroup.add(coreSphere);
// 外环
const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 16), accentMat);
coreRing.position.set(0, 0.08, 0.27);
coreRing.rotation.x = Math.PI/2;
torsoGroup.add(coreRing);
// 核心十字辉光
const glowX = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), coreMat);
glowX.position.set(0, 0.08, 0.27);
torsoGroup.add(glowX);
const glowY = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.02), coreMat);
glowY.position.set(0, 0.08, 0.27);
torsoGroup.add(glowY);

// 背部推进器（两个圆柱喷嘴）
for (let i = -1; i <= 1; i+=2) {
  const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.15, 6), darkMetalMat);
  thruster.position.set(i*0.2, -0.1, -0.28);
  torsoGroup.add(thruster);
  const nozzleLight = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.05, 6), coreMat);
  nozzleLight.position.set(i*0.2, -0.15, -0.28);
  torsoGroup.add(nozzleLight);
}

// 腰部护甲环（宽环）
const belt = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 8, 16), darkMetalMat);
belt.position.y = -0.28;
belt.rotation.x = Math.PI/2;
torsoGroup.add(belt);
// 腰带指示灯
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 4), coreMat);
  light.position.set(Math.sin(angle)*0.33, -0.28, Math.cos(angle)*0.33);
  torsoGroup.add(light);
}

player.add(torsoGroup);
const torso = torsoGroup; // 兼容

// ---- 腿部：外骨骼装甲 ----
function createLeg(side) {
  const group = new THREE.Group();
  const dir = side === 'left' ? -1 : 1;
  group.position.set(dir * 0.15, 0.05, 0);

  // 大腿
  const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.28, 8), bodyMat);
  thigh.position.y = 0.14;
  group.add(thigh);
  // 大腿外侧护甲
  const thighArmor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), darkMetalMat);
  thighArmor.position.set(dir*0.1, 0.14, 0.05);
  group.add(thighArmor);

  // 膝关节（球形关节 + 环）
  const kneeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), darkMetalMat);
  kneeSphere.position.y = 0.02;
  group.add(kneeSphere);
  const kneeRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 8), accentMat);
  kneeRing.position.y = 0.02;
  kneeRing.rotation.x = Math.PI/2;
  group.add(kneeRing);

  // 小腿
  const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.24, 6), bodyMat);
  shin.position.y = -0.07;
  group.add(shin);
  // 小腿前部装甲
  const shinPlate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), darkMetalMat);
  shinPlate.position.set(0, -0.07, 0.07);
  group.add(shinPlate);

  // 靴子（厚重设计）
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.18), darkMetalMat);
  boot.position.y = -0.24;
  boot.position.z = 0.03;
  group.add(boot);
  const bootSole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.2), bodyMat);
  bootSole.position.y = -0.28;
  bootSole.position.z = 0.03;
  group.add(bootSole);
  // 靴子指示灯
  const bootLight = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 4), coreMat);
  bootLight.position.set(0, -0.27, 0.13);
  group.add(bootLight);

  return group;
}

const legL = createLeg('left');
const legR = createLeg('right');
player.add(legL, legR);

// ---- 手臂：复合装甲 + 能量关节 ----
function createArm(side) {
  const group = new THREE.Group();
  const dir = side === 'left' ? -1 : 1;
  group.position.set(dir * 0.32, 0.45, 0);

  // 肩甲（大型层叠球体）
  const shoulderBase = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), bodyMat);
  shoulderBase.position.y = 0.22;
  group.add(shoulderBase);
  const shoulderPad = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6, 0, Math.PI*2, 0, Math.PI*0.6), darkMetalMat);
  shoulderPad.position.y = 0.2;
  group.add(shoulderPad);
  const shoulderLight = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 4), coreMat);
  shoulderLight.position.set(dir*0.1, 0.26, 0.05);
  group.add(shoulderLight);

  // 上臂
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.2, 6), bodyMat);
  upper.position.y = 0.04;
  group.add(upper);
  // 上臂装甲条
  const upperStrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), darkMetalMat);
  upperStrip.position.set(dir*0.05, 0.04, 0.0);
  group.add(upperStrip);

  // 肘关节（球体）
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), darkMetalMat);
  elbow.position.y = -0.08;
  group.add(elbow);

  // 前臂
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6), bodyMat);
  lower.position.y = -0.18;
  group.add(lower);
  // 前臂外侧装甲
  const forearmPlate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), darkMetalMat);
  forearmPlate.position.set(dir*0.06, -0.18, 0.0);
  group.add(forearmPlate);

  // 手部（机械手掌，简化）
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), darkMetalMat);
  hand.position.y = -0.29;
  group.add(hand);
  const finger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.02), darkMetalMat);
  finger.position.set(0, -0.33, 0.02);
  group.add(finger);
  const handGlow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 4), coreMat);
  handGlow.position.set(0, -0.32, 0.04);
  group.add(handGlow);

  return group;
}

const armL = createArm('left');
const armR = createArm('right');
player.add(armL, armR);

// ---- 动态光环（可缩放用于状态反馈） ----
const playerGlow = new THREE.Mesh(
  new THREE.TorusGeometry(0.75, 0.03, 16, 32),
  new THREE.MeshBasicMaterial({
    color: 0x3ef0e8,
    transparent: true,
    opacity: 0.25,
    depthWrite: false
  })
);
playerGlow.rotation.x = Math.PI/2;
player.add(playerGlow);

// 额外悬浮粒子环（科技感点缀）
const particlesRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.7, 0.015, 8, 24),
  new THREE.MeshBasicMaterial({
    color: 0x3ef0e8,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  })
);
particlesRing.rotation.x = Math.PI/2;
particlesRing.position.y = 0.2;
player.add(particlesRing);
const shieldVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const shieldFragmentShader = `
  uniform vec3 color;
  uniform float time;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float intensity = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5);
    float pulse = 0.35 + 0.15 * sin(time * 6.0);
    float alpha = intensity * pulse;
    gl_FragColor = vec4(color + vec3(intensity * 0.4), alpha);
  }
`;

const shieldMaterial = new THREE.ShaderMaterial({
  vertexShader: shieldVertexShader,
  fragmentShader: shieldFragmentShader,
  uniforms: {
    color: { value: new THREE.Color(COLORS.SHIELD) },
    time: { value: 0 }
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const shieldBubble = new THREE.Mesh(
  new THREE.SphereGeometry(1.2, 24, 24),
  shieldMaterial
);
player.add(shieldBubble);
shieldBubble.visible = false;

const magnetRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.0, 0.08, 8, 24),
  new THREE.MeshBasicMaterial({
    color: COLORS.MAGNET,
    transparent: true,
    opacity: 0.4
  })
);
magnetRing.rotation.x = Math.PI / 2;
player.add(magnetRing);
magnetRing.visible = false;

// ============ 玩家霓虹尾迹效果 (Neon Trail) ============
const trailLength = 15;
const trailHistory = [];
let trailWriteIndex = 0;
const trailMeshes = [];
const trailGeometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);
const trailContainer = new THREE.Group();
world.add(trailContainer);
const _trailTempVec = new THREE.Vector3();

// Pre-create trail meshes and materials
for (let i = 0; i < trailLength; i++) {
  const ratio = (trailLength - i) / trailLength;
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0x4ee6e0,
    transparent: true,
    opacity: ratio * 0.4,
    blending: THREE.AdditiveBlending
  });
  const mesh = new THREE.Mesh(trailGeometry, trailMat);
  trailContainer.add(mesh);
  mesh.visible = false;
  trailMeshes.push(mesh);
}

function initTrail() {
  trailHistory.length = 0;
  trailWriteIndex = 0;
  // Pre-populate trailHistory with Vector3 objects so we can copy values instead of creating new instances
  for (let i = 0; i < trailLength * 2; i++) {
    trailHistory.push(new THREE.Vector3());
  }
  trailMeshes.forEach(m => {
    m.visible = false;
  });
}

// ============ 皮肤解锁配置 ============
const skins = [
  { id: 'classic', name: '经典霓蓝', cost: 0, color: 0x4ee6e0, accent: 0x49ffd0, body: 0xf2f6ff, unlocked: true },
  { id: 'neon_purple', name: '脉冲幽紫', cost: 250, color: 0x8b5cf6, accent: 0xa78bfa, body: 0x2e1b4b, unlocked: false },
  { id: 'flame_orange', name: '熔岩红橙', cost: 750, color: 0xf97316, accent: 0xfdba74, body: 0x5c1407, unlocked: false },
  { id: 'matrix_green', name: '黑客矩阵', cost: 1500, color: 0x22c55e, accent: 0x86efac, body: 0x064e3b, unlocked: false },
  { id: 'golden_legend', name: '黄金传说', cost: 3000, color: 0xeab308, accent: 0xfef08a, body: 0x78350f, unlocked: false }
];
let currentSkin = 'classic';
let currentSkinObj = skins[0];
let totalCredits = parseInt(safeGetItem(CONFIG.STORAGE_KEYS.CREDITS, '0')) || 0;

function loadSkins() {
  const unlocked = safeParseJSON(CONFIG.STORAGE_KEYS.UNLOCKED_SKINS, ['classic']);
  skins.forEach(s => {
    if (unlocked.includes(s.id)) s.unlocked = true;
  });
  currentSkin = safeGetItem(CONFIG.STORAGE_KEYS.CURRENT_SKIN, 'classic') || 'classic';
  currentSkinObj = skins.find(s => s.id === currentSkin) || skins[0];
}

function saveSkins() {
  const unlocked = skins.filter(s => s.unlocked).map(s => s.id);
  safeSetItem(CONFIG.STORAGE_KEYS.UNLOCKED_SKINS, JSON.stringify(unlocked));
  safeSetItem(CONFIG.STORAGE_KEYS.CURRENT_SKIN, currentSkin);
}

function applySkin(skinId) {
  const skin = skins.find(s => s.id === skinId);
  if (!skin) return;
  const changed = (currentSkin !== skinId);
  currentSkin = skinId;
  currentSkinObj = skin;
  saveSkins();

  bodyMat.color.setHex(skin.body);
  accentMat.color.setHex(skin.accent);
  playerGlow.material.color.setHex(skin.color);
  playerLight.color.setHex(skin.color);

  trailMeshes.forEach(mesh => {
    mesh.material.color.setHex(skin.color);
  });

  renderSkinsUI();

  // 皮肤切换触发云端同步（防抖）
  if (changed) CloudSync.scheduleSync();
}

function renderSkinsUI() {
  document.getElementById('creditsValue').textContent = totalCredits;
  const grid = document.getElementById('skinsGrid');
  grid.innerHTML = '';

  skins.forEach(skin => {
    const card = document.createElement('div');
    card.className = 'skin-card';
    if (!skin.unlocked) card.classList.add('locked');
    if (skin.unlocked && skin.id === currentSkin) card.classList.add('equipped');

    const hexColor = '#' + skin.color.toString(16).padStart(6, '0');

    let btnHtml = '';
    if (skin.unlocked) {
      if (skin.id === currentSkin) {
        btnHtml = `<div class="skin-btn equipped">使用中</div>`;
      } else {
        btnHtml = `<div class="skin-btn equip" data-action="equip" data-skin-id="${skin.id}">装备</div>`;
      }
    } else {
      btnHtml = `<div class="skin-btn buy" data-action="buy" data-skin-id="${skin.id}">${skin.cost} M</div>`;
    }

    card.innerHTML = `
      <div class="skin-info">
        <div class="skin-color-preview" style="background-color: ${hexColor}; box-shadow: 0 0 10px ${hexColor}aa;"></div>
        <div class="skin-name-container">
          <div class="skin-name">${skin.name}</div>
          <div class="skin-cost">${skin.unlocked ? '已解锁' : '未解锁'}</div>
        </div>
      </div>
      ${btnHtml}
    `;
    grid.appendChild(card);
  });
}

function buySkin(skinId) {
  const skin = skins.find(s => s.id === skinId);
  if (!skin || skin.unlocked) return;

  if (totalCredits >= skin.cost) {
    totalCredits -= skin.cost;
    safeSetItem(CONFIG.STORAGE_KEYS.CREDITS, totalCredits);
    skin.unlocked = true;
    saveSkins();
    applySkin(skinId);
    audioManager.playAchievement();
    // 触发云端同步（防抖）
    CloudSync.scheduleSync();
  } else {
    audioManager.playCollision();
    const need = skin.cost - totalCredits;
    showToast(`点数不足！还需 ${need} 点，继续奔跑赚取。`, 'warning');
  }
}

// 皮肤按钮事件委托（替代内联 onclick）
document.getElementById('skinsGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('.skin-btn[data-action]');
  if (!btn) return;
  const skinId = btn.dataset.skinId;
  if (btn.dataset.action === 'equip') applySkin(skinId);
  else if (btn.dataset.action === 'buy') buySkin(skinId);
});

// ============ 游戏机制状态变量 ============
let isJumping = false;
let playerY = 0;
let prevPlayerY = 0;
let velocityY = 0;
const GRAVITY = -42;
const JUMP_POWER = 15;

// 能量系统
let energy = 100;
let maxEnergy = 100;
let energyRegenRate = 5;

// 状态 Buffs
let isInvincible = false;
let invincibleTimer = 0;
let invincibleDuration = CONFIG.POWERUP_DURATIONS.invincible;

let shieldActive = false;
let magnetActive = false;
let magnetTimer = 0;

let boostActive = false;
let boostTimer = 0;

// 连击系统
let combo = 0;
let maxCombo = 0;
let comboTimer = 0;
let comboWindow = 1.8;

// 成就系统
// 成就系统
const achievements = {
  firstSteps: { name: "初出茅庐", desc: "完成第一次奔跑", unlocked: false },
  comboMaster: { name: "连击大师", desc: "达到10连击", unlocked: false },
  speedDemon: { name: "速度恶魔", desc: "速度达到20.0", unlocked: false },
  survivor: { name: "生存专家", desc: "单局距离达到500米", unlocked: false },
  collector: { name: "收藏家", desc: "收集10个道具", unlocked: false },

  // New achievements
  phoenix: { name: "不死鸟", desc: "单局1000米且无碰撞", unlocked: false },
  collector100: { name: "终极收藏家", desc: "累计收集100个道具", unlocked: false },
  speedKing: { name: "速度之王", desc: "速度达到30.0", unlocked: false },
  zoneExplorer: { name: "区域探索者", desc: "到达区域 5 (2500米)", unlocked: false },
  comboLegend: { name: "连击传奇", desc: "达到25连击", unlocked: false }
};

let powerupsCollected = 0;
let cumulativePowerups = 0;
let collisionsCount = 0;
let powerupBonusPoints = 0;
let currentZone = 1;

function loadAchievements() {
  const saved = safeParseJSON(CONFIG.STORAGE_KEYS.ACHIEVEMENTS, {});
  Object.keys(saved).forEach(key => {
    if (achievements[key]) achievements[key].unlocked = saved[key];
  });
  cumulativePowerups = parseInt(safeGetItem(CONFIG.STORAGE_KEYS.CUMULATIVE_POWERUPS, '0')) || 0;
}

function saveAchievements() {
  const toSave = {};
  Object.keys(achievements).forEach(key => {
    toSave[key] = achievements[key].unlocked;
  });
  safeSetItem(CONFIG.STORAGE_KEYS.ACHIEVEMENTS, JSON.stringify(toSave));
  safeSetItem(CONFIG.STORAGE_KEYS.CUMULATIVE_POWERUPS, cumulativePowerups);
}

function jump() {
  if (!isJumping && gameRunning) {
    isJumping = true;
    velocityY = JUMP_POWER;

    if (energy >= CONFIG.JUMP_ENERGY_COST) {
      energy -= CONFIG.JUMP_ENERGY_COST;
      updateEnergyBar();
    }

    audioManager.playJump();
    if (navigator.vibrate) navigator.vibrate(HAPTIC_PATTERNS.jump);

    const pColor = new THREE.Color(currentSkinObj.color);
    particleSystem.emit(player.position, 15, pColor, 1.8);
  }
}

let prevEnergy = -1;
function updateEnergyBar() {
  const roundedEnergy = Math.round(energy);
  if (roundedEnergy === prevEnergy) return;
  prevEnergy = roundedEnergy;
  const energyBarContainer = document.querySelector('.energy-bar-container');
  const energyBar = document.getElementById('energyBar');
  if (energyBar) energyBar.style.width = `${roundedEnergy}%`;

  if (energyBarContainer) {
    if (roundedEnergy < 25) {
      energyBarContainer.classList.add('warning');
    } else {
      energyBarContainer.classList.remove('warning');
    }
  }
}

const COMBO_MILESTONES = [
  { threshold: 10, title: 'COMBO MASTER', color: '#00E5C7', shake: 0.3 },
  { threshold: 20, title: 'COMBO KING',   color: '#f97316', shake: 0.5 },
  { threshold: 30, title: 'COMBO GOD',   color: '#eab308', shake: 0.8 },
];
let lastComboMilestone = 0;

function showCombo() {
  const comboDisplay = document.getElementById('comboDisplay');
  if (combo > 1) {
    comboDisplay.textContent = `COMBO x${combo}`;
    comboDisplay.style.opacity = '1';
    comboDisplay.style.transform = 'translateX(-50%) scale(1.15)';
    setTimeout(() => {
      comboDisplay.style.transform = 'translateX(-50%) scale(1)';
    }, 150);
    audioManager.playCombo(combo);

    // 检测连击里程碑
    for (const m of COMBO_MILESTONES) {
      if (combo >= m.threshold && lastComboMilestone < m.threshold) {
        lastComboMilestone = m.threshold;
        triggerComboMilestone(m);
        break;
      }
    }
  } else {
    comboDisplay.style.opacity = '0';
    lastComboMilestone = 0;
  }
}

function triggerComboMilestone(milestone) {
  const el = document.getElementById('comboMilestone');
  if (el) {
    el.textContent = milestone.title;
    el.style.color = milestone.color; // 动态颜色保留内联
    el.classList.add('show');
    setTimeout(() => { el.classList.remove('show'); }, 1500);
  }
  screenShake.shake(milestone.shake, 0.3);
  particleSystem.emit(player.position, 30, new THREE.Color(milestone.color), 2.0);
}

function showPowerupIndicator(type) {
  const indicator = document.getElementById('powerupIndicator');
  const text = POWERUP_INDICATORS[type];
  if (text) {
    indicator.textContent = text;
    indicator.style.color = hexToCss(POWERUP_COLORS[type]);
  }
  indicator.style.opacity = '1';
  setTimeout(() => {
    if (indicator.textContent.includes(type.toUpperCase())) {
      indicator.style.opacity = '0';
    }
  }, 2000);
}

function showAchievement(achievementKey) {
  const achievement = achievements[achievementKey];
  if (!achievement || achievement.unlocked) return;

  achievement.unlocked = true;
  saveAchievements();

  const popup = document.getElementById('achievementPopup');
  const title = document.getElementById('achievementTitle');
  const desc = document.getElementById('achievementDesc');

  title.textContent = `成就解锁: ${achievement.name}`;
  desc.textContent = achievement.desc;

  popup.classList.add('show');

  audioManager.playAchievement();

  const achievementColor = new THREE.Color(COLORS.WARM);
  particleSystem.emit(player.position, 40, achievementColor, 2.5);

  setTimeout(() => {
    popup.classList.remove('show');
  }, 3000);

  // 触发云端同步（防抖）
  CloudSync.scheduleSync();
}

function checkAchievements() {
  if (distance > 10 && !achievements.firstSteps.unlocked) {
    showAchievement('firstSteps');
  }
  if (combo >= 10 && !achievements.comboMaster.unlocked) {
    showAchievement('comboMaster');
  }
  if (speed >= 20 && !achievements.speedDemon.unlocked) {
    showAchievement('speedDemon');
  }
  if (distance >= 500 && !achievements.survivor.unlocked) {
    showAchievement('survivor');
  }
  if (powerupsCollected >= 10 && !achievements.collector.unlocked) {
    showAchievement('collector');
  }
  if (distance >= 1000 && collisionsCount === 0 && !achievements.phoenix.unlocked) {
    showAchievement('phoenix');
  }
  if (cumulativePowerups >= 100 && !achievements.collector100.unlocked) {
    showAchievement('collector100');
  }
  if (speed >= 30.0 && !achievements.speedKing.unlocked) {
    showAchievement('speedKing');
  }
  if (distance >= 2500 && !achievements.zoneExplorer.unlocked) {
    showAchievement('zoneExplorer');
  }
  if (combo >= 25 && !achievements.comboLegend.unlocked) {
    showAchievement('comboLegend');
  }
}

// ============ 重力隧道旋转控制 ============
let gravityState = 0;
let targetRotZ = 0;
let currentRotZ = 0;

function setGravity(state) {
  if (state === gravityState || !gameRunning) return;

  gravityState = state;
  targetRotZ = -state * Math.PI/2;

  if (energy >= CONFIG.WALL_SWITCH_ENERGY_COST) {
    energy -= CONFIG.WALL_SWITCH_ENERGY_COST;
    updateEnergyBar();
  }

  audioManager.playWallSwitch();
  if (navigator.vibrate) navigator.vibrate(HAPTIC_PATTERNS.wallSwitch);

  const sColor = new THREE.Color(currentSkinObj.color);
  particleSystem.emit(player.position, 12, sColor, 1.5);

  if (comboTimer > 0) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    comboTimer = comboWindow;
    showCombo();
  } else {
    combo = 1;
    comboTimer = comboWindow;
  }
}

function shortestDelta(from, to) {
  let diff = (to - from) % (Math.PI*2);
  if (diff > Math.PI) diff -= Math.PI*2;
  if (diff < -Math.PI) diff += Math.PI*2;
  return diff;
}

// 输入监听
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && gameRunning) {
    e.preventDefault();
    togglePause();
    return;
  }
  // 如果游戏暂停或未开始，不执行后续移动操作
  if (!gameRunning || gamePaused) return;

  switch(e.code) {
    case 'Space': case 'ArrowUp': jump(); break;
    case 'ArrowLeft': case 'KeyA': setGravity((gravityState + 3) % 4); break;
    case 'ArrowRight': case 'KeyD': setGravity((gravityState + 1) % 4); break;
    case 'ArrowDown': case 'KeyS': setGravity((gravityState + 2) % 4); break;
  }
});


let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', e => {
  if(e.touches.length > 0) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, {passive: false});

document.addEventListener('touchend', e => {
  if(!gameRunning || e.changedTouches.length === 0) return;
  let touchEndX = e.changedTouches[0].clientX;
  let touchEndY = e.changedTouches[0].clientY;

  let dx = touchEndX - touchStartX;
  let dy = touchEndY - touchStartY;

  if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) setGravity((gravityState + 1) % 4);
      else setGravity((gravityState + 3) % 4);
    } else {
      if (dy < 0) jump();
      else setGravity((gravityState + 2) % 4);
    }
  }
}, {passive: false});

// ============ 游戏状态与排行榜 ============
let gameRunning = false;
let currentAccel = CONFIG.SPEED_ACCEL;   // 当前加速度
let currentSpread = 1.0;                // 当前障碍物分散度
let zoneStartTime = 0;                  // 进入当前区域的时间
let gamePaused = false;
let speed = 9;
let distance = 0;
let elapsedTime = 0;
let deathAnimating = false;
let deathTimer = 0;

const scoreEl = document.getElementById('scoreValue');
const speedEl = document.getElementById('speedValue');
const finalScoreEl = document.getElementById('finalScore');
const finalComboEl = document.getElementById('finalCombo');
const finalAchievementsEl = document.getElementById('finalAchievements');
const hudEl = document.getElementById('hud');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const pauseScreen = document.getElementById('pauseScreen');
const pauseScoreEl = document.getElementById('pauseScore');

let leaderboard = safeParseJSON(CONFIG.STORAGE_KEYS.LEADERBOARD, []);
let achievementsBeforeRun = 0;

function saveScore(score, maxCombo, difficulty, isChallenge = false) {
  // 判断是否新纪录（在 push 排序前比较）
  const isNewRecord = leaderboard.length === 0 || score > leaderboard[0].score;
  const dateStr = new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  leaderboard.push({ score, combo: maxCombo, difficulty, date: dateStr, challenge: isChallenge });
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard = leaderboard.slice(0, 5);
  safeSetItem(CONFIG.STORAGE_KEYS.LEADERBOARD, JSON.stringify(leaderboard));
  renderLeaderboardUI();

  // 已登录用户异步提交到云端（失败不影响本地）
  if (AuthManager.isLoggedIn()) {
    CloudSync.submitScore(score, maxCombo, difficulty, isChallenge, score, elapsedTime).catch(() => {});
    // 挑战模式且使用了云端短码：额外提交挑战成绩
    if (isChallenge && challengeCloudCode) {
      ChallengeCloud.submitChallengeScore(challengeCloudCode, score, maxCombo, score, elapsedTime).catch(() => {});
    }
  }
  return isNewRecord;
}

let leaderboardSource = 'local'; // 'local' | 'global'
let globalLeaderboardCache = [];
let globalLeaderboardLoading = false;

function renderLeaderboardUI() {
  const tbody = document.getElementById('leaderboardBody');
  const headerExtra = document.getElementById('leaderboardHeaderExtra');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (leaderboardSource === 'global') {
    if (headerExtra) headerExtra.textContent = '玩家';
    renderGlobalLeaderboard(tbody);
    return;
  }

  if (headerExtra) headerExtra.textContent = '时间';
  if (leaderboard.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="leaderboard-empty">暂无记录，快去创造历史吧！</td></tr>`;
    return;
  }
  leaderboard.forEach((item, index) => {
    const diffNames = { easy: '简单', normal: '普通', hard: '困难' };
    const challengeTag = item.challenge ? ' <span class="challenge-tag">[挑战]</span>' : '';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${item.score} M${challengeTag}</td>
      <td>x${item.combo}</td>
      <td>${diffNames[item.difficulty] || item.difficulty}</td>
      <td>${item.date}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderGlobalLeaderboard(tbody) {
  if (!AuthManager.isLoggedIn()) {
    tbody.innerHTML = `<tr><td colspan="5" class="leaderboard-empty cloud">请先登录以查看全球排行榜</td></tr>`;
    return;
  }
  if (globalLeaderboardLoading) {
    tbody.innerHTML = `<tr><td colspan="5" class="leaderboard-empty cloud">加载中...</td></tr>`;
    return;
  }
  if (globalLeaderboardCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="leaderboard-empty cloud">暂无全球记录</td></tr>`;
    return;
  }
  const diffNames = { easy: '简单', normal: '普通', hard: '困难' };
  globalLeaderboardCache.forEach((item, index) => {
    const challengeTag = item.is_challenge ? ' <span class="challenge-tag">[挑战]</span>' : '';
    const username = item.username || item.user_username || '匿名';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${item.score} M${challengeTag}</td>
      <td>x${item.combo || 0}</td>
      <td>${diffNames[item.difficulty] || item.difficulty || '-'}</td>
      <td>${username}</td>
    `;
    tbody.appendChild(row);
  });
}

async function loadGlobalLeaderboard() {
  if (!AuthManager.isLoggedIn()) return;
  globalLeaderboardLoading = true;
  renderLeaderboardUI();
  const data = await CloudSync.getGlobalLeaderboard();
  globalLeaderboardCache = data;
  globalLeaderboardLoading = false;
  renderLeaderboardUI();
}

// 排行榜切换按钮事件委托
document.querySelectorAll('.lb-tab').forEach(tab => {
  tab.addEventListener('click', function() {
    audioManager.playClick();
    document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    leaderboardSource = this.dataset.lbSource;
    if (leaderboardSource === 'global') {
      loadGlobalLeaderboard();
    } else {
      renderLeaderboardUI();
    }
  });
});

function renderAchievementsUI() {
  const list = document.getElementById('achievementsList');
  if (!list) return;
  list.innerHTML = '';

  const keys = Object.keys(achievements);
  const unlockedCount = keys.filter(k => achievements[k].unlocked).length;

  const countEl = document.getElementById('achUnlockedCount');
  const totalEl = document.getElementById('achTotalCount');
  if (countEl) countEl.textContent = unlockedCount;
  if (totalEl) totalEl.textContent = keys.length;

  keys.forEach(key => {
    const ach = achievements[key];
    const item = document.createElement('div');
    item.className = 'ach-item ' + (ach.unlocked ? 'unlocked' : 'locked');
    item.innerHTML = `
      <div class="ach-item-icon"><i class="fas ${ach.unlocked ? 'fa-trophy' : 'fa-lock'}"></i></div>
      <div class="ach-item-body">
        <div class="ach-item-name">${ach.unlocked ? ach.name : '???'}</div>
        <div class="ach-item-desc">${ach.desc}</div>
      </div>
    `;
    list.appendChild(item);
  });
}

function triggerDamageFlash() {
  const flash = document.getElementById('damageFlash');
  if (flash) {
    flash.classList.add('active');
    setTimeout(() => { flash.classList.remove('active'); }, 120);
  }
}

// 选项卡切换功能
document.querySelectorAll('.menu-tab').forEach(tab => {
  tab.addEventListener('click', function() {
    audioManager.playClick();
    document.querySelectorAll('.menu-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    this.classList.add('active');
    this.setAttribute('aria-selected', 'true');
    const tabId = 'tab-' + this.dataset.tab;
    document.getElementById(tabId).classList.add('active');

    if (this.dataset.tab === 'skins') {
      renderSkinsUI();
    } else if (this.dataset.tab === 'leaderboard') {
      renderLeaderboardUI();
    } else if (this.dataset.tab === 'achievements') {
      renderAchievementsUI();
    }
  });
});

// UI 悬停音效绑定
document.querySelectorAll('button, input').forEach(el => {
  el.addEventListener('mouseenter', () => audioManager.playHover());
  el.addEventListener('click', () => audioManager.playClick());
});

// 暂停按钮点击（补充 Escape 键之外的触控方式）
document.getElementById('pauseBtn').addEventListener('click', togglePause);

// 音频控件绑定
document.getElementById('musicBtn').addEventListener('click', function() {
  const enabled = audioManager.toggleMusic();
  this.classList.toggle('active', enabled);
  this.setAttribute('aria-pressed', String(enabled));
  safeSetItem(CONFIG.STORAGE_KEYS.MUSIC_ENABLED, enabled ? '1' : '0');
});
document.getElementById('sfxBtn').addEventListener('click', function() {
  const enabled = audioManager.toggleSfx();
  this.classList.toggle('active', enabled);
  this.setAttribute('aria-pressed', String(enabled));
  safeSetItem(CONFIG.STORAGE_KEYS.SFX_ENABLED, enabled ? '1' : '0');
});
document.getElementById('volumeSlider').addEventListener('input', function() {
  audioManager.setVolume(this.value / 100);
  safeSetItem(CONFIG.STORAGE_KEYS.VOLUME, String(this.value / 100));
});

// 分享按钮事件
document.getElementById('shareBtn').addEventListener('click', async () => {
  const score = Math.floor(distance);
  const btn = document.getElementById('shareBtn');
  if (!btn) return;

  // 已登录用户优先创建云端短码（?c=ABC123），未登录则降级为旧版种子直传
  let shareUrl = '';
  let cloudCode = null;
  if (AuthManager.isLoggedIn()) {
    const originalText = btn.textContent;
    btn.textContent = '生成短码中...';
    btn.disabled = true;
    try {
      const challenge = await ChallengeCloud.createChallenge(currentSeed, score, maxCombo);
      if (challenge && challenge.share_code) {
        cloudCode = challenge.share_code;
        shareUrl = `${window.location.origin}${window.location.pathname}?c=${cloudCode}`;
      }
    } catch (e) { /* 降级到种子直传 */ }
    btn.textContent = originalText;
    btn.disabled = false;
  }
  if (!shareUrl) {
    const seedStr = currentSeed.toString(36).toUpperCase();
    shareUrl = `${window.location.origin}${window.location.pathname}?seed=${seedStr}&s=${score}&c=${maxCombo}`;
  }

  let feedbackShown = false;
  function showFeedback(text) {
    if (feedbackShown) return;
    feedbackShown = true;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = '分享此地图'; }, 2000);
  }

  // 500ms 超时兜底，确保沙箱/受限环境也有视觉反馈
  const timeoutId = setTimeout(() => showFeedback('链接已生成（请手动复制）'), 500);

  function onCopySuccess() {
    clearTimeout(timeoutId);
    showFeedback(cloudCode ? `短码已复制: ${cloudCode}` : '链接已复制到剪贴板!');
  }

  function fallbackCopy(text) {
    clearTimeout(timeoutId);
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      showFeedback(success ? (cloudCode ? `短码已复制: ${cloudCode}` : '链接已复制到剪贴板!') : '链接已生成（请手动复制）');
    } catch (e) {
      showFeedback('链接已生成（请手动复制）');
    }
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl).then(onCopySuccess).catch(() => fallbackCopy(shareUrl));
  } else {
    fallbackCopy(shareUrl);
  }
});

function togglePause() {
  if (!gameRunning) return;

  gamePaused = !gamePaused;

  if (gamePaused) {
    pauseScreen.classList.remove('hidden');
    pauseScoreEl.textContent = Math.floor(distance);
    audioManager.stopMusic();
    audioManager.playPause();
  } else {
    pauseScreen.classList.add('hidden');
    audioManager.startMusic();
    audioManager.playResume();
  }
}

function triggerNearMiss() {
  audioManager.playNearMiss();
  powerupBonusPoints += 150;

  if (comboTimer > 0) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    comboTimer = comboWindow;
    showCombo();
  } else {
    combo = 1;
    comboTimer = comboWindow;
  }

  const el = document.getElementById('nearMissDisplay');
  if (el) {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) scale(1.2)';

    // 擦边连击颜色分层：白 -> 蓝 -> 紫 -> 金
    let color = '#ffffff';
    if (combo >= 15) color = '#eab308';
    else if (combo >= 10) color = '#8b5cf6';
    else if (combo >= 5) color = '#3b82f6';
    el.style.color = color;
    el.textContent = combo >= 2 ? `擦边! x${combo}` : '擦边!';

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) scale(1.0)';
    }, 800);
  }

  // 高连击擦边追加粒子与微震，强化正反馈
  if (combo >= 5) {
    const pColor = new THREE.Color(currentSkinObj.color);
    particleSystem.emit(player.position, 12, pColor, 1.2);
    screenShake.shake(0.15, 0.12);
  }
}

function checkCollisions() {
  const threshold = 0.75;
  const segCullDist = SEG_LEN * 0.75;

  // 检查道具碰撞（仅遍历玩家所在段及空间相邻段）
  for (const seg of segments) {
    if (Math.abs(seg.position.z - PLAYER_Z) > segCullDist) continue;

    const collected = [];
    for (const powerup of seg.userData.powerups) {
      const worldZ = seg.position.z + powerup.localZ;
      if (powerup.state === gravityState && Math.abs(worldZ - PLAYER_Z) < threshold) {
        collected.push(powerup);

        powerupsCollected++;
        cumulativePowerups++;
        powerupBonusPoints += CONFIG.POWERUP_BONUS;

        audioManager.collectPowerup(powerup.type);

        const pColor = new THREE.Color(POWERUP_COLORS[powerup.type] || COLORS.PRIMARY);
        particleSystem.emit(player.position, 25, pColor, 2.0);

        if (powerup.type === 'energy') {
          energy = Math.min(energy + CONFIG.ENERGY_REFILL_AMOUNT, maxEnergy);
          updateEnergyBar();
          showPowerupIndicator('energy');
        } else if (powerup.type === 'invincible') {
          isInvincible = true;
          invincibleTimer = Math.max(invincibleTimer, invincibleDuration);
          showPowerupIndicator('invincible');
          playerGlow.material.color.setHex(POWERUP_COLORS.invincible);
        } else if (powerup.type === 'shield') {
          shieldActive = true;
          shieldBubble.visible = true;
          showPowerupIndicator('shield');
        } else if (powerup.type === 'magnet') {
          magnetActive = true;
          magnetTimer = CONFIG.POWERUP_DURATIONS.magnet;
          showPowerupIndicator('magnet');
        } else if (powerup.type === 'boost') {
          boostActive = true;
          boostTimer = CONFIG.POWERUP_DURATIONS.boost;
          isInvincible = true;
          invincibleTimer = Math.max(invincibleTimer, CONFIG.POWERUP_DURATIONS.boost);
          showPowerupIndicator('boost');
          playerGlow.material.color.setHex(POWERUP_COLORS.boost);
        }
      }
    }

    for (const powerup of collected) {
      returnPowerupToPool(powerup.mesh);
      const idx = seg.userData.powerups.indexOf(powerup);
      if (idx >= 0) seg.userData.powerups.splice(idx, 1);
    }
  }

  // 检查障碍物碰撞
  for (const seg of segments) {
    if (Math.abs(seg.position.z - PLAYER_Z) > segCullDist) continue;

    const removedObstacles = [];
    for (const obs of seg.userData.obstacles) {
      const worldZ = seg.position.z + obs.localZ;
      const prevWorldZ = (seg.userData.prevZ !== undefined) ? seg.userData.prevZ + obs.localZ : worldZ;
      const zNear = Math.abs(worldZ - PLAYER_Z) < threshold;
      const zCrossed = (prevWorldZ > PLAYER_Z + threshold && worldZ < PLAYER_Z - threshold) ||
                       (prevWorldZ < PLAYER_Z - threshold && worldZ > PLAYER_Z + threshold);

      if (obs.state === gravityState && (zNear || zCrossed) && !obs._disabled) {

        const playerYBottom = Math.min(prevPlayerY, playerY);
        const playerYTop = Math.max(prevPlayerY, playerY);
        let collided = false;
        if (obs.type === 'laser') {
          if (obs.armed === false) collided = false;
          else if (playerYBottom < CONFIG.PLAYER_HITBOX_Y && playerYTop >= 0) collided = true;
        } else {
          let playerLocalOffset = 0;
          let obsLocalOffset = obs.mesh.position.x;
          if (obs.state === 1 || obs.state === 3) {
            obsLocalOffset = obs.mesh.position.y;
          }
          if (playerYBottom < 1.05 && playerYTop >= 0 && Math.abs(obsLocalOffset - playerLocalOffset) < CONFIG.LATERAL_HIT_THRESHOLD) {
            collided = true;
          }
        }

        if (collided) {
          collisionsCount++;
          recentEvents.push({ time: elapsedTime, success: false });
          if (recentEvents.length > 50) recentEvents.shift();
          removedObstacles.push(obs);

          if (isInvincible) {
            audioManager.playCollision();
            if (navigator.vibrate) navigator.vibrate(HAPTIC_PATTERNS.collision);
            particleSystem.emit(obs.mesh.position, 40, new THREE.Color(0xff6b6b), 2.5);
            screenShake.shake(0.35, 0.2);

            if (comboTimer > 0) {
              combo++;
              if (combo > maxCombo) maxCombo = combo;
              comboTimer = comboWindow;
              showCombo();
            } else {
              combo = 1;
              comboTimer = comboWindow;
            }
          } else if (shieldActive) {
            shieldActive = false;
            shieldBubble.visible = false;

            audioManager.playCollision();
            if (navigator.vibrate) navigator.vibrate(HAPTIC_PATTERNS.collision);
            particleSystem.emit(player.position, 35, new THREE.Color(COLORS.SHIELD), 2.2);
            screenShake.shake(0.25, 0.18);
          } else {
            energy -= CONFIG.COLLISION_ENERGY_PENALTY;
            updateEnergyBar();

            audioManager.playCollision();
            if (navigator.vibrate) navigator.vibrate(HAPTIC_PATTERNS.damage);
            particleSystem.emit(player.position, 40, new THREE.Color(OBSTACLE_COLOR), 3.0);
            screenShake.shake(0.65, 0.35);
            triggerDamageFlash();

            if (energy <= 0) {
              startDeathAnimation();
              return;
            }
          }
        }
      } else if ((Math.abs(worldZ - PLAYER_Z) < CONFIG.LATERAL_HIT_THRESHOLD || zCrossed) && !obs.nearMissed) {
        // Near miss detection when obstacle passes but no collision occurred
        obs.nearMissed = true;
        triggerNearMiss();
        recentEvents.push({ time: elapsedTime, success: true });
        if (recentEvents.length > 50) recentEvents.shift();
      }
    }

    for (const obs of removedObstacles) {
      if (obs.type === 'laser') returnLaserToPool(obs.mesh);
      else returnObstacleToPool(obs.mesh);
      const idx = seg.userData.obstacles.indexOf(obs);
      if (idx >= 0) seg.userData.obstacles.splice(idx, 1);
    }
  }
}

const ZONE_THEMES = {
  1: { colors: [0xeafcff, 0xeafcff, 0xeafcff, 0xeafcff], name: '第一区域: 太空站 Alpha' },
  2: { colors: [0xe8d8ff, 0xd8c8ff, 0xe8d8ff, 0xd8c8ff], name: '第二区域: 星云穿越' },
  3: { colors: [0xffe0d0, 0xffd0c0, 0xffe0d0, 0xffd0c0], name: '第三区域: 恒星轨道' },
  4: { colors: [0xd8ffe8, 0xc8ffd8, 0xd8ffe8, 0xc8ffd8], name: '第四区域: 深空航线' },
  5: { colors: [0xfff0c0, 0xffe0a0, 0xfff0c0, 0xffe0a0], name: '极限挑战: 银河之心' }
};

const ZONE_EFFECTS = {
  1: { type: 'none' },
  2: { type: 'blink', interval: 2 },
  3: { type: 'pulse', interval: 1.5, amplitude: 0.3 },
  4: { type: 'swap', interval: 3.0 },
  5: { type: 'speed', multiplier: 1.4 },
};

// 工厂函数：返回浅拷贝，避免障碍物修改共享的 ZONE_EFFECTS 对象
function getZoneEffect(zoneNum) {
  const effect = ZONE_EFFECTS[Math.min(5, zoneNum)];
  return effect ? { ...effect } : { type: 'none' };
}

function updateZoneTheme(zoneNum) {
  const theme = ZONE_THEMES[Math.min(5, zoneNum)];
  for (let i = 0; i < 4; i++) {
    const colorVal = theme.colors[i];
    if (wallMaterials[i] && wallMaterials[i].uniforms) {
      wallMaterials[i].uniforms.zoneTint.value.setHex(colorVal);
      wallMaterials[i].uniforms.zoneId.value = zoneNum;
    }
    if (wallEdgeMats[i]) {
      wallEdgeMats[i].color.setHex(0x8899aa);
    }
  }
}


function triggerZoneChange(zoneNum) {
  currentZone = zoneNum;
  updateZoneTheme(zoneNum);

  const flash = document.getElementById('zoneFlash');
  const theme = ZONE_THEMES[Math.min(5, zoneNum)];
  const hexColor = '#' + theme.colors[0].toString(16).padStart(6, '0');

  if (flash) {
    flash.style.backgroundColor = hexColor;
    flash.style.opacity = '0.5';
    setTimeout(() => {
      flash.style.opacity = '0';
    }, 500);
  }

  const nameEl = document.getElementById('zoneName');
  if (nameEl) {
    nameEl.textContent = theme.name;
    nameEl.style.color = hexColor;
    nameEl.style.opacity = '1';
    nameEl.style.transform = 'translate(-50%, -50%) scale(1.15)';
    setTimeout(() => {
      nameEl.style.opacity = '0';
      nameEl.style.transform = 'translate(-50%, -50%) scale(1.0)';
    }, 2200);
  }

  audioManager.playZoneTransition();
  audioManager.setZone(zoneNum); // 切换配乐 preset（下一小节自然切，不重启调度器）
  // ---- 创建场景切换隧道（发光长方体） ----
const tunnelGroup = new THREE.Group();
const tunnelMat = new THREE.MeshPhysicalMaterial({
  color: 0x00e5c7,
  emissive: 0x00e5c7,
  emissiveIntensity: 0.6,
  transparent: true,
  opacity: 0.4,
  metalness: 0.0,
  roughness: 0.2,
  side: THREE.DoubleSide
});
const tunnelMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 2), tunnelMat);
tunnelMesh.position.set(0, 0, -10); // 放在玩家前方10米处
tunnelGroup.add(tunnelMesh);

// 发光边框
const edgeMat = new THREE.LineBasicMaterial({
  color: 0x00e5c7,
  transparent: true,
  opacity: 0.9
});
const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(6, 6, 2));
const edgeLine = new THREE.LineSegments(edgeGeo, edgeMat);
edgeLine.position.copy(tunnelMesh.position);
tunnelGroup.add(edgeLine);

// 内发光粒子（可选，增加细节）
const glowParticles = new THREE.Points(
  new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 50 }, () => {
      const x = (Math.random() - 0.5) * 5;
      const y = (Math.random() - 0.5) * 5;
      const z = (Math.random() - 0.5) * 1.5 - 10;
      return new THREE.Vector3(x, y, z);
    })
  ),
  new THREE.PointsMaterial({
    color: 0x00e5c7,
    size: 0.1,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
);
tunnelGroup.add(glowParticles);

scene.add(tunnelGroup);

// 动画：缩放+淡出
let startTime = performance.now();
const duration = 1500; // 1.5秒

function animateTunnel() {
  const elapsed = performance.now() - startTime;
  const progress = Math.min(1, elapsed / duration);
  // 从0.5倍放大到1.5倍，然后消失
  const scale = 0.5 + progress * 1.0;
  const opacity = 1 - progress;
  tunnelGroup.scale.set(scale, scale, scale);
  tunnelMesh.material.opacity = opacity * 0.4;
  edgeLine.material.opacity = opacity * 0.9;
  // 粒子位置波动
  const positions = glowParticles.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += (Math.random() - 0.5) * 0.02;
    positions[i+1] += (Math.random() - 0.5) * 0.02;
    positions[i+2] += (Math.random() - 0.5) * 0.02;
  }
  glowParticles.geometry.attributes.position.needsUpdate = true;

  if (progress < 1) {
    requestAnimationFrame(animateTunnel);
  } else {
    scene.remove(tunnelGroup);
    // 清理几何体和材质（可选）
    tunnelMesh.geometry.dispose();
    tunnelMesh.material.dispose();
    edgeLine.geometry.dispose();
    edgeLine.material.dispose();
    glowParticles.geometry.dispose();
    glowParticles.material.dispose();
  }
}
animateTunnel();
  // 应用该区域的配置
const config = REGION_CONFIG[zoneNum] || REGION_CONFIG[1];
currentAccel = config.accel;
currentSpread = config.spread;
speed = config.initSpeed;
zoneStartTime = elapsedTime;
}

function getCompositeScore() {
  const diffBonus = CONFIG.SCORE_BONUS[currentDifficulty] ?? CONFIG.SCORE_BONUS.normal;
  const comboMult = Math.min(CONFIG.COMBO_MULT_MAX, 1.0 + combo * CONFIG.COMBO_MULT_STEP);
  return Math.floor(Math.floor(distance) * comboMult * diffBonus + powerupBonusPoints);
}

function startCountdown() {
  audioManager.playClick();
  audioManager.init();
  audioManager.stopMenuMusic(); // 停止菜单配乐，避免与倒计时音效叠加

  startGame();

  const overlay = document.getElementById('countdownOverlay');
  const text = document.getElementById('countdownText');
  if (overlay) overlay.classList.remove('hidden');

  let count = 3;
  if (text) {
    text.textContent = count;
    text.className = 'countdown-number';
  }
  audioManager.playCountdownTick();

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      if (text) text.textContent = count;
      audioManager.playCountdownTick();
    } else if (count === 0) {
      if (text) {
        text.textContent = 'GO!';
        text.className = 'countdown-go';
      }
      audioManager.playCountdownGo();
    } else {
      clearInterval(interval);
      if (overlay) overlay.classList.add('hidden');
      startGameLoop();
    }
  }, 800);
}

function startGameLoop() {
  gameRunning = true;
  audioManager.playGameStart();
  audioManager.startMusic();
  audioManager.startWindSound();
}

function startGame() {
  particleSystem.activeCount = 0;
particleSystem.particleGeometry.setDrawRange(0, 0);
  // 游戏开始前快照已解锁成就数，用于 endGame 计算本次新解锁数
  achievementsBeforeRun = Object.values(achievements).filter(a => a.unlocked).length;
  // 种子初始化
  if (isChallengeMode && challengeData && challengeData.seed) {
    currentSeed = challengeData.seed;
  } else {
    currentSeed = Date.now();
  }
  gameRng = mulberry32(currentSeed);

  loadSkins();
  applySkin(currentSkin);
  initTrail();

  gravityState = 0; targetRotZ = 0; currentRotZ = 0;
  world.rotation.z = 0;
  camera.rotation.z = 0;
  // 应用区域1的配置
const region1 = REGION_CONFIG[1];
currentAccel = region1.accel;
currentSpread = region1.spread;
speed = region1.initSpeed;
zoneStartTime = 0;
 distance = 0;
 elapsedTime = 0;
  isJumping = false; playerY = 0; prevPlayerY = 0; velocityY = 0;
  player.position.y = BASE_Y;
  player.visible = true;

  energy = maxEnergy;
  updateEnergyBar();

  isInvincible = false;
  invincibleTimer = 0;
  shieldActive = false;
  shieldBubble.visible = false;
  magnetActive = false;
  magnetRing.visible = false;
  magnetTimer = 0;
  boostActive = false;
  boostTimer = 0;

  combo = 0;
  maxCombo = 0;
  comboTimer = 0;
  lastComboMilestone = 0;
  recentEvents = [];
  dynamicDifficultyMod = 1.0;
  powerupsCollected = 0;
  powerupBonusPoints = 0;
  collisionsCount = 0;
  currentZone = 1;
  updateZoneTheme(1);
  gamePaused = false;
  deathAnimating = false;
  deathTimer = 0;

  loadAchievements();

  segments.forEach((seg, idx) => {
    seg.position.z = -idx*SEG_LEN;
    if (idx > 2) {
      spawnObstacles(seg, 0);
      spawnPowerups(seg, 0);
    } else {
      seg.userData.obstacles.forEach(o => {
        if (o.type === 'laser') returnLaserToPool(o.mesh);
        else returnObstacleToPool(o.mesh);
      });
      seg.userData.obstacles = [];
      seg.userData.powerups.forEach(p => { returnPowerupToPool(p.mesh); });
      seg.userData.powerups = [];
    }
  });

  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  hudEl.classList.remove('hidden');
  document.getElementById('comboDisplay').style.opacity = '0';
  document.getElementById('powerupIndicator').style.opacity = '0';

  // 挑战模式横幅
  if (isChallengeMode && challengeData) {
    const banner = document.getElementById('challengeBanner');
    if (banner) {
      banner.textContent = `挑战模式 · 原始记录: ${challengeData.score}米 x${challengeData.combo}`;
      banner.classList.add('show');
      setTimeout(() => { banner.classList.remove('show'); }, 3500);
    }
  }
}

function startDeathAnimation() {
  deathAnimating = true;
  deathTimer = 1.2;
  screenShake.shake(1.2, 1.2);
  particleSystem.emit(player.position, 60, new THREE.Color(OBSTACLE_COLOR), 3.5);
  player.visible = false;
}

function endGame() {
  gameRunning = false;
  audioManager.stopWindSound();
  const finalDist = Math.floor(distance);
  const compositeScore = getCompositeScore();

  finalScoreEl.textContent = finalDist;
  const compositeEl = document.getElementById('finalComposite');
  if (compositeEl) compositeEl.textContent = compositeScore;
  finalComboEl.textContent = maxCombo;

  totalCredits += Math.floor(compositeScore * 0.1);
  safeSetItem(CONFIG.STORAGE_KEYS.CREDITS, totalCredits);

  const isNewRecord = saveScore(finalDist, maxCombo, currentDifficulty, isChallengeMode);

  const unlockedCount = Object.values(achievements).filter(a => a.unlocked).length;
  finalAchievementsEl.textContent = unlockedCount;

  // 本次新解锁成就数（与 startGame 时快照对比）
  const newUnlocks = unlockedCount - achievementsBeforeRun;

  audioManager.stopMusic();
  audioManager.playGameOver();

  // 挑战模式成绩对比
  const compareEl = document.getElementById('challengeCompare');
  if (compareEl) {
    if (isChallengeMode && challengeData) {
      const myScore = Math.floor(distance);
      const beat = myScore > challengeData.score;
      compareEl.innerHTML = beat
        ? `<p class="desc challenge-beat">超越原始记录 ${challengeData.score}米!</p>`
        : `<p class="desc challenge-missed">原始记录: ${challengeData.score}米 · 差距: ${challengeData.score - myScore}米</p>`;
      compareEl.classList.remove('hidden');
    } else {
      compareEl.classList.add('hidden');
    }
  }

  // 新纪录徽章 + 金色闪光
  const badgeContainer = document.getElementById('gameOverTitle');
  const existingBadge = document.getElementById('newRecordBadge');
  if (existingBadge) existingBadge.remove();
  const existingFlash = document.getElementById('gameOverFlash');
  if (existingFlash) existingFlash.remove();
  if (isNewRecord) {
    const badge = document.createElement('div');
    badge.id = 'newRecordBadge';
    badge.className = 'new-record-badge';
    badge.textContent = '新纪录!';
    badgeContainer.parentNode.insertBefore(badge, badgeContainer);
    const flash = document.createElement('div');
    flash.id = 'gameOverFlash';
    flash.className = 'game-over-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1300);
    audioManager.playAchievement();
  }

  // 本次新解锁成就提示
  const existingCallout = document.getElementById('newUnlocksCallout');
  if (existingCallout) existingCallout.remove();
  if (newUnlocks > 0) {
    const callout = document.createElement('div');
    callout.id = 'newUnlocksCallout';
    callout.className = 'new-unlocks-callout';
    callout.innerHTML = `<i class="fas fa-trophy"></i> 本次新解锁 <span>${newUnlocks}</span> 个成就`;
    const statsGrid = document.querySelector('#gameOverScreen .stats-grid');
    if (statsGrid && statsGrid.nextSibling) {
      statsGrid.parentNode.insertBefore(callout, statsGrid.nextSibling);
    } else if (statsGrid) {
      statsGrid.parentNode.appendChild(callout);
    }
  }

  gameOverScreen.classList.remove('hidden');

  document.getElementById('powerupIndicator').style.opacity = '0';
  document.getElementById('comboDisplay').style.opacity = '0';
}

function restartGame() {
  audioManager.playClick();
  audioManager.init();
  startGame();
  startGameLoop();
}

function returnToMenu() {
  gameRunning = false;
  gamePaused = false;
  audioManager.stopMusic();
  audioManager.stopWindSound();

  startScreen.classList.remove('hidden');
  gameOverScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  hudEl.classList.add('hidden');

  renderSkinsUI();

  audioManager.init();
  audioManager.startMenuMusic();
}

// 难度选择
function syncDifficultyUI() {
  document.querySelectorAll('.difficulty-btn').forEach(b => {
    const isActive = b.dataset.difficulty === currentDifficulty;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-pressed', String(isActive));
  });
}
syncDifficultyUI();
document.querySelectorAll('.difficulty-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.difficulty-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    this.classList.add('active');
    this.setAttribute('aria-pressed', 'true');
    currentDifficulty = this.dataset.difficulty;
    safeSetItem(CONFIG.STORAGE_KEYS.DIFFICULTY, currentDifficulty);
  });
});

// ============ 首次用户交互启动菜单配乐（浏览器自动播放策略） ============
let menuMusicStarted = false;
function ensureMenuMusic() {
  if (menuMusicStarted) return;
  if (startScreen.classList.contains('hidden')) return; // 已离开菜单（如直接点开始），不启动
  menuMusicStarted = true;
  audioManager.init();
  audioManager.startMenuMusic();
  // 同步音频按钮 UI 到已恢复的状态
  const musicBtn = document.getElementById('musicBtn');
  const sfxBtn = document.getElementById('sfxBtn');
  const volumeSlider = document.getElementById('volumeSlider');
  if (musicBtn) {
    musicBtn.classList.toggle('active', audioManager.musicEnabled);
    musicBtn.setAttribute('aria-pressed', String(audioManager.musicEnabled));
  }
  if (sfxBtn) {
    sfxBtn.classList.toggle('active', audioManager.sfxEnabled);
    sfxBtn.setAttribute('aria-pressed', String(audioManager.sfxEnabled));
  }
  if (volumeSlider) volumeSlider.value = Math.round(audioManager.volume * 100);
  document.removeEventListener('click', ensureMenuMusic);
  document.removeEventListener('touchstart', ensureMenuMusic);
}
document.addEventListener('click', ensureMenuMusic);
document.addEventListener('touchstart', ensureMenuMusic);

// ============ 游戏按钮事件绑定 ============
document.getElementById('startBtn').addEventListener('click', () => {
  startCountdown();
});

document.getElementById('restartBtn').addEventListener('click', () => {
  restartGame();
});

gameOverScreen.addEventListener('touchend', (e) => {
  if (e.target.closest('button')) return;
  if (!gameRunning && !gameOverScreen.classList.contains('hidden')) {
    e.preventDefault();
    restartGame();
  }
});

document.getElementById('menuBtn').addEventListener('click', () => {
  returnToMenu();
});

// 游戏结束页"查看排行榜"按钮：返回主菜单并切到全球榜
document.getElementById('viewLeaderboardBtn').addEventListener('click', () => {
  audioManager.playClick();
  gameOverScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  // 切到排行榜 tab
  document.querySelectorAll('.menu-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const lbTab = document.querySelector('.menu-tab[data-tab="leaderboard"]');
  if (lbTab) {
    lbTab.classList.add('active');
    lbTab.setAttribute('aria-selected', 'true');
  }
  const lbContent = document.getElementById('tab-leaderboard');
  if (lbContent) lbContent.classList.add('active');
  // 切到"全球榜" lb-tab
  document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
  const globalTab = document.querySelector('.lb-tab[data-lb-source="global"]');
  if (globalTab) globalTab.classList.add('active');
  leaderboardSource = 'global';
  loadGlobalLeaderboard().then(() => renderLeaderboardUI());
  // loadGlobalLeaderboard 在未登录时立即 return，但仍需渲染一次显示空状态
  renderLeaderboardUI();
});

document.getElementById('resumeBtn').addEventListener('click', () => {
  if (gamePaused) togglePause();
});


document.getElementById('quitBtn').addEventListener('click', () => {
  returnToMenu();
});

const clock = new THREE.Clock();
let speedLinesFrameCount = 0;
let energyWarningTimer = 0;

// 性能自适应：FPS 采样与画质阶梯
const FPS_SAMPLE_COUNT = 60;
const fpsHistory = new Float32Array(FPS_SAMPLE_COUNT);
let fpsIndex = 0;
let fpsTimer = 0;
let qualityLevel = 0; // 0=全特效, 1=低 Bloom, 2=关闭 Bloom
const BLOOM_STRENGTH_LOW = 0.35;

function updateAdaptiveQuality(dt) {
  const fps = dt > 0 ? 1 / dt : 60;
  fpsHistory[fpsIndex] = fps;
  fpsIndex = (fpsIndex + 1) % FPS_SAMPLE_COUNT;
  fpsTimer += dt;

  if (fpsTimer >= 2.0) {
    fpsTimer = 0;
    let avgFps = 0;
    for (let i = 0; i < FPS_SAMPLE_COUNT; i++) avgFps += fpsHistory[i];
    avgFps /= FPS_SAMPLE_COUNT;

    if (qualityLevel === 0 && avgFps < 45) {
      qualityLevel = 1;
      if (bloomPass) bloomPass.strength = BLOOM_STRENGTH_LOW;
    } else if (qualityLevel <= 1 && avgFps < 35) {
      qualityLevel = 2;
      if (composer && bloomPass) {
        const idx = composer.passes.indexOf(bloomPass);
        if (idx >= 0) composer.passes.splice(idx, 1);
      }
    }
  }
}

function renderFrame() {
  if (!composer || qualityLevel >= 2) {
    renderer.render(scene, camera);
  } else {
    composer.render();
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  updateAdaptiveQuality(dt);

  if (deathAnimating) {
    deathTimer -= dt;
    speed = Math.max(0, speed - speed * dt * 2.5);
    distance += speed * dt;

    segments.forEach(seg => {
      seg.position.z += speed * dt;
    });

    particleSystem.update(dt);
    screenShake.update(dt);

    if (deathTimer <= 0) {
      deathAnimating = false;
      endGame();
    }
    renderFrame();
    return;
  }

  if (gameRunning && !gamePaused) {
    elapsedTime += dt;
    const settings = difficultySettings[currentDifficulty];

    let speedMult = settings.speedMultiplier;
    if (boostActive) {
      speedMult *= CONFIG.BOOST_SPEED_MULT;
    }

    const timeInZone = elapsedTime - zoneStartTime;
const baseSpeed = currentAccel * timeInZone + (REGION_CONFIG[currentZone] ? REGION_CONFIG[currentZone].initSpeed : 9);
speed = baseSpeed * speedMult;
    distance += speed*dt;

    if (starMaterial && starMaterial.uniforms) {
      starMaterial.uniforms.time.value = elapsedTime;
    }
    if (starMaterial2 && starMaterial2.uniforms) {
      starMaterial2.uniforms.time.value = elapsedTime;
    }
    if (starMaterial3 && starMaterial3.uniforms) {
      starMaterial3.uniforms.time.value = elapsedTime;
    }

    wallMaterials.forEach(mat => {
      if (mat.uniforms) {
        mat.uniforms.time.value = elapsedTime;
        mat.uniforms.speed.value = speed;
      }
    });

    const targetZone = 1 + Math.floor(distance / REGION_LENGTH
    );
    // 只在区域5之前触发切换
if (currentZone < 5) {
    if (targetZone > currentZone) {
        triggerZoneChange(targetZone);
    }
}

    audioManager.updateWindSound(speed);
    audioManager.updateMusicBPM(speed);

    segments.forEach(seg => {
      seg.userData.prevZ = seg.position.z;
      seg.position.z += speed*dt;

      seg.userData.obstacles.forEach(obs => {
        if (obs.type === 'box' && obs.mesh) {
          obs.mesh.rotation.y += dt * obs.rotationSpeed;
          obs.mesh.rotation.x += dt * obs.rotationSpeed * 0.4;
        }

        // 激光蓄力状态更新
        if (obs.type === 'laser' && obs.armingTimer > 0) {
          obs.armingTimer -= dt;
          const progress = 1 - (obs.armingTimer / 0.45);
          // 蓄力中：激光从极细逐渐变粗（避免共享材质问题，用scale模拟）
          const scaleVal = 0.1 + progress * 0.9;
          obs.mesh.scale.set(scaleVal, scaleVal, scaleVal);
          if (obs.armingTimer <= 0) {
            obs.armed = true;
            obs.mesh.scale.set(1, 1, 1);
          }
        }

        // Zone 招牌机制更新
        if (obs.zoneEffect && obs.mesh) {
          switch (obs.zoneEffect.type) {
            case 'blink':
              obs.blinkTimer += dt;
              if (obs.blinkTimer >= obs.zoneEffect.interval) {
                obs.mesh.visible = !obs.mesh.visible;
                obs.blinkTimer = 0;
                obs._disabled = !obs.mesh.visible;
              }
              break;
            case 'pulse': {
              obs.pulseTimer += dt;
              const pulseScale = 1 + Math.sin(obs.pulseTimer / obs.zoneEffect.interval * Math.PI * 2) * obs.zoneEffect.amplitude;
              obs.mesh.scale.setScalar(pulseScale);
              break;
            }
            case 'swap':
              if (obs.type !== 'laser') {
                obs.swapTimer += dt;
                if (obs.swapTimer >= obs.zoneEffect.interval) {
                  obs.swapTimer = 0;
                  obs.state = (obs.state + 2) % 4;
                  const swSize = CONFIG.OBSTACLE_SIZE;
                  let swPos;
                  if (obs.state===0) swPos = [0, -R+swSize/2, obs.localZ];
                  if (obs.state===1) swPos = [R-swSize/2, 0, obs.localZ];
                  if (obs.state===2) swPos = [0, R-swSize/2, obs.localZ];
                  if (obs.state===3) swPos = [-R+swSize/2, 0, obs.localZ];
                  obs.mesh.position.set(...swPos);
                }
              }
              break;
            case 'speed':
              obs.moveSpeed *= obs.zoneEffect.multiplier;
              obs.zoneEffect.type = 'none';
              break;
          }
        }

        if (obs.isMoving && obs.mesh) {
          let val = obs.mesh.position.x;
if (obs.state === 1 || obs.state === 3) {
    val = obs.mesh.position.y;
}
val += obs.moveDirection * obs.moveSpeed * dt;

const maxVal = R - CONFIG.OBSTACLE_SIZE - 0.2; // 加入偏移限制
if (Math.abs(val) > maxVal) {
    obs.moveDirection *= -1;
    val = Math.sign(val) * maxVal;
}

          if (obs.state === 0 || obs.state === 2) {
            obs.mesh.position.x = val;
          } else {
            obs.mesh.position.y = val;
          }
        }
      });

      seg.userData.powerups.forEach(powerup => {
        if (powerup.mesh) {
          powerup.mesh.rotation.y += dt * 2.5;
          powerup.mesh.rotation.x += dt * 0.8;

          if (!magnetActive || (seg.position.z + powerup.localZ - PLAYER_Z >= 15) || (seg.position.z + powerup.localZ - PLAYER_Z <= -1.5)) {
            const floatOffset = Math.sin(elapsedTime * 4.0 + powerup.localZ) * 0.08;
            const size = 0.8;
            if (powerup.state === 0) { powerup.mesh.position.y = -R + size/2 + floatOffset; }
            else if (powerup.state === 1) { powerup.mesh.position.x = R - size/2 - floatOffset; }
            else if (powerup.state === 2) { powerup.mesh.position.y = R - size/2 - floatOffset; }
            else if (powerup.state === 3) { powerup.mesh.position.x = -R + size/2 + floatOffset; }
          }
        }
      });

      if (magnetActive) {
        seg.userData.powerups.forEach(powerup => {
          const worldZ = seg.position.z + powerup.localZ;
          const distZ = worldZ - PLAYER_Z;
          if (distZ < 15 && distZ > -1.5) {
            const targetLocalZ = PLAYER_Z - seg.position.z;

            let targetX = 0, targetY = 0;
            const pSize = 0.8;
            if (gravityState === 0) { targetX = 0; targetY = -R + pSize/2; }
            if (gravityState === 1) { targetX = R - pSize/2; targetY = 0; }
            if (gravityState === 2) { targetX = 0; targetY = R - pSize/2; }
            if (gravityState === 3) { targetX = -R + pSize/2; targetY = 0; }

            if (gravityState === 0) targetY += playerY;
            if (gravityState === 1) targetX -= playerY;
            if (gravityState === 2) targetY -= playerY;
            if (gravityState === 3) targetX += playerY;

            powerup.mesh.position.x += (targetX - powerup.mesh.position.x) * dt * 7;
            powerup.mesh.position.y += (targetY - powerup.mesh.position.y) * dt * 7;
            powerup.localZ += (targetLocalZ - powerup.localZ) * dt * 7;
            powerup.mesh.position.z = powerup.localZ;

            if (Math.abs(powerup.mesh.position.x - targetX) < 1.1 && Math.abs(powerup.mesh.position.y - targetY) < 1.1) {
              powerup.state = gravityState;
            }
          }
        });
      }

      if (seg.position.z > camera.position.z + 4) {
        let minZ = segments[0].position.z;
        for (let idx = 1; idx < segments.length; idx++) {
          if (segments[idx].position.z < minZ) {
            minZ = segments[idx].position.z;
          }
        }
        seg.position.z = minZ - SEG_LEN;
        spawnObstacles(seg, distance);
        spawnPowerups(seg, distance);
      }
    });

    const d = shortestDelta(currentRotZ, targetRotZ);
    const rotSpeed = d * Math.min(1, dt*9.5);
    currentRotZ += rotSpeed;
    world.rotation.z = currentRotZ;

    const targetTilt = -Math.min(0.20, Math.max(-0.20, rotSpeed / (dt + 0.001) * 0.016));
    let currentTilt = camera.rotation.z;
    currentTilt += (targetTilt - currentTilt) * dt * 8;
    camera.rotation.z = currentTilt;

    let targetFov = 65;
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect < 0.85) targetFov = 82;
    else if (aspect < 1.2) targetFov = 72;
    if (boostActive) targetFov += 14;

    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * dt * 5;
      camera.updateProjectionMatrix();
    }

    prevPlayerY = playerY;
    if (isJumping) {
      velocityY += GRAVITY * dt;
      playerY += velocityY * dt;
      if (playerY <= 0) {
        playerY = 0;
        isJumping = false;
        velocityY = 0;
      }
    }
    player.position.y = BASE_Y + playerY;

    energy = Math.min(energy + energyRegenRate * settings.energyRegenMultiplier * dt, maxEnergy);
    updateEnergyBar();

    if (energy < 25) {
      energyWarningTimer -= dt;
      if (energyWarningTimer <= 0) {
        audioManager.playEnergyWarning();
        energyWarningTimer = 1.5;
      }
    } else {
      energyWarningTimer = 0;
    }

    if (!isInvincible) {
      const baseScale = 1.0 + (speed - 9) * 0.02;
      const pulse = Math.sin(elapsedTime * 4.0) * 0.05;
      playerGlow.scale.setScalar(baseScale + pulse);
      playerGlow.material.opacity = 0.15;
    } else {
      const baseScale = 1.2 + (speed - CONFIG.BASE_SPEED) * 0.02;
      const pulse = Math.sin(elapsedTime * 20.0) * 0.15;
      playerGlow.scale.setScalar(baseScale + pulse);
      playerGlow.material.opacity = 0.28 + Math.sin(elapsedTime * 20.0) * 0.12;
    }

    if (isInvincible) {
      invincibleTimer -= dt;
      if (invincibleTimer <= 0) {
        isInvincible = false;
        playerGlow.material.color.setHex(currentSkinObj.color);
      }
    }

    if (shieldActive) {
      shieldMaterial.uniforms.time.value = elapsedTime;
    }

    if (magnetActive) {
      magnetTimer -= dt;
      if (magnetTimer <= 0) {
        magnetActive = false;
        magnetRing.visible = false;
      } else {
        magnetRing.visible = true;
        magnetRing.rotation.z += dt * 3.5;
        magnetRing.scale.setScalar(1.0 + Math.sin(elapsedTime * 9) * 0.14);
      }
    }

    if (boostActive) {
      boostTimer -= dt;
      if (boostTimer <= 0) {
        boostActive = false;
        isInvincible = false;
        invincibleTimer = 0;
        playerGlow.material.color.setHex(currentSkinObj.color);
      }
    }

    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) {
        combo = 0;
        showCombo();
      }
    }

    // 动态难度更新
    recentEvents = recentEvents.filter(e => elapsedTime - e.time < 10);
    if (Math.floor(elapsedTime * 0.5) > Math.floor((elapsedTime - dt) * 0.5)) {
      if (recentEvents.length >= 3) {
        const successRate = recentEvents.filter(e => e.success).length / recentEvents.length;
        if (successRate > 0.8) dynamicDifficultyMod = Math.min(1.3, dynamicDifficultyMod + 0.05);
        else if (successRate < 0.4) dynamicDifficultyMod = Math.max(0.7, dynamicDifficultyMod - 0.05);
      }
    }

    if (!isJumping) {
      const runCycle = elapsedTime * (14 + speed * 0.2);
      const bob = Math.sin(runCycle) * 0.05;
      legL.rotation.x = Math.sin(runCycle) * 0.65;
      legR.rotation.x = -Math.sin(runCycle) * 0.65;
      armL.rotation.x = -Math.sin(runCycle) * 0.55;
      armR.rotation.x = Math.sin(runCycle) * 0.55;
      torso.position.y = 0.46 + Math.abs(bob);
    } else {
      legL.rotation.x = -0.35;
      legR.rotation.x = -0.55;
      armL.rotation.x = 0.1;
      armR.rotation.x = 0.1;
    }

    _trailTempVec.copy(player.position);
    world.worldToLocal(_trailTempVec);
    if (trailHistory.length > 0) {
      trailHistory[trailWriteIndex].copy(_trailTempVec);
      trailWriteIndex = (trailWriteIndex + 1) % trailHistory.length;
    }

    for (let i = 0; i < trailMeshes.length; i++) {
      const histIdx = (trailWriteIndex - 1 - i * 2 + trailHistory.length) % trailHistory.length;
      if (i * 2 < trailHistory.length) {
        trailMeshes[i].position.copy(trailHistory[histIdx]);
        const scaleVal = 1.0 - (i / trailMeshes.length) * 0.65;
        trailMeshes[i].scale.setScalar(scaleVal);
        trailMeshes[i].visible = true;
      } else {
        trailMeshes[i].visible = false;
      }
    }

    checkCollisions();
    checkAchievements();

    const currentDist = Math.floor(distance);
    const compositeScore = getCompositeScore();
    scoreEl.textContent = currentDist;
    const scoreBonusEl = document.getElementById('scoreBonus');
    if (scoreBonusEl) {
      const bonus = compositeScore - currentDist;
      scoreBonusEl.textContent = bonus > 0 ? `+${bonus} 综合评分` : '';
    }
    speedEl.textContent = speed.toFixed(1);

    speedLinesFrameCount++;
    if (speedLinesFrameCount % 3 === 0) {
      speedLines.update(speed);
    }
  } else {
    trailMeshes.forEach(m => { m.visible = false; });
  }

  particleSystem.update(dt);
  screenShake.update(dt);

  renderFrame();
}

// ============ 启动序列 ============
loadSkins();
renderSkinsUI();
renderLeaderboardUI();
renderAchievementsUI();

// ============ 云端集成初始化 ============
AuthManager.init();
NetworkIndicator.init();
AuthUI.init();

// 注入 APIClient token 获取器与刷新处理器（让 APIClient 自动带 token / 自动刷新）
APIClient.setTokenGetter(() => AuthManager.getAccessToken());
APIClient.setRefreshHandler(async () => {
  // token 过期时尝试刷新；失败则强制登出
  const ok = await AuthManager.refresh();
  if (!ok) AuthManager.logout();
  return ok;
});

// 注入 AuthUI 游戏回调（让 AuthUI 在云端进度合并后刷新皮肤/成就 UI）
AuthUI.setGameCallbacks({
  loadSkins,
  applySkin,
  renderSkinsUI,
  renderAchievementsUI
});

// 已登录用户：自动加载云端进度 + 重放待同步队列
if (AuthManager.isLoggedIn()) {
  AuthManager.fetchMe().catch(() => {});
  CloudSync.flushPending().catch(() => {});
  CloudSync.loadProgress().then(cloudData => {
    if (cloudData) {
      const changed = CloudSync.mergeAndApply(cloudData);
      if (changed) {
        loadSkins();
        applySkin(safeGetItem(CONFIG.STORAGE_KEYS.CURRENT_SKIN, 'classic') || 'classic');
        renderSkinsUI();
        renderAchievementsUI();
        showToast('云端进度已加载', 'info');
      }
    }
  }).catch(() => {});
}

// 处理云端短码 ?c=ABC123：异步加载挑战详情，覆盖 challengeData
if (challengeCloudCode) {
  ChallengeCloud.getChallenge(challengeCloudCode).then(challenge => {
    if (challenge && challenge.seed) {
      challengeData = {
        seed: challenge.seed,
        score: challenge.initial_score || 0,
        combo: challenge.initial_combo || 0,
        cloudCode: challengeCloudCode
      };
      showToast(`挑战地图加载成功（${challengeCloudCode}）`, 'info');
    } else {
      // 短码无效，关闭挑战模式
      isChallengeMode = false;
      challengeData = null;
      challengeCloudCode = null;
      showToast('挑战短码无效或已失效', 'warning');
    }
  }).catch(() => {
    isChallengeMode = false;
    challengeData = null;
    challengeCloudCode = null;
    showToast('挑战短码加载失败', 'warning');
  });
}

animate();

// ============ 模块导出（供外部消费者使用） ============
export {
  isChallengeMode,
  challengeData,
  challengeCloudCode,
  loadSkins,
  applySkin,
  renderSkinsUI,
  renderAchievementsUI
};






