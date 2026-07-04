// ============ 核心配置常量 ============

export const REGION_LENGTH = 800;   // 每个区域的长度（米），可随意调整

export const CONFIG = {
  // 玩法数值
  BASE_SPEED: 9,
  SPEED_ACCEL: 0.34,
  BOOST_SPEED_MULT: 1.85,
  JUMP_ENERGY_COST: 2,
  WALL_SWITCH_ENERGY_COST: 1,
  ENERGY_REFILL_AMOUNT: 35,
  COLLISION_ENERGY_PENALTY: 35,
  POWERUP_BONUS: 50,
  // 道具持续时间（秒）
  POWERUP_DURATIONS: { magnet: 8.0, boost: 4.0, invincible: 3.5 },
  // 碰撞箱阈值
  PLAYER_HITBOX_Y: 0.68,
  LATERAL_HIT_THRESHOLD: 1.2,
  OBSTACLE_SIZE: 0.85,
  // 输入
  SWIPE_THRESHOLD_PX: 30,
  // 综合评分系数
  SCORE_BONUS: { easy: 1.0, normal: 1.2, hard: 1.5 },
  COMBO_MULT_MAX: 3.0,
  COMBO_MULT_STEP: 0.1,
  // localStorage 键名
  STORAGE_KEYS: {
    LEADERBOARD: 'g_tunnel_leaderboard',
    ACHIEVEMENTS: 'g_tunnel_achievements',
    CUMULATIVE_POWERUPS: 'g_tunnel_cumulative_powerups',
    CREDITS: 'g_tunnel_credits',
    UNLOCKED_SKINS: 'g_tunnel_unlocked_skins',
    CURRENT_SKIN: 'g_tunnel_current_skin',
    AUTH: 'g_tunnel_auth',
    PENDING_SYNC: 'g_tunnel_pending_sync',
    // 用户偏好（音量/音乐/音效/难度）
    VOLUME: 'g_tunnel_volume',
    MUSIC_ENABLED: 'g_tunnel_music_enabled',
    SFX_ENABLED: 'g_tunnel_sfx_enabled',
    DIFFICULTY: 'g_tunnel_difficulty'
  },
  // 后端 API 地址
  // 部署时用空字符串走相对路径，由 Nginx 反代到后端；
  // 开发时 Vite proxy 会把 /auth /leaderboard 等转发到本地 8000 端口
  API_BASE_URL: ''
};

// 区域速度与密度配置
export const REGION_CONFIG = {
  1: { initSpeed: 9.0,  accel: 0.34, spread: 1.0 },
  2: { initSpeed: 12.0, accel: 0.55, spread: 1.3 },
  3: { initSpeed: 15.0, accel: 0.75, spread: 1.6 },
  4: { initSpeed: 18.0, accel: 0.95, spread: 2.0 },
  5: { initSpeed: 21.0, accel: 1.20, spread: 2.5 }
};

// ============ 统一色表（与 CSS --accent-* 对齐） ============
export const COLORS = {
  PRIMARY: 0x00E5C7,
  WARM: 0xFF8B3D,
  GOLD: 0xF5C842,
  DANGER: 0xFF4D6D,
  SHIELD: 0x3b82f6,
  MAGNET: 0xef4444,
  BOOST: 0x10b981,
  PURPLE: 0x8b5cf6,
  PINK: 0xe63ee0,
  ORANGE: 0xf97316
};
