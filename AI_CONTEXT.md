# AI Context — Gravity Tunnel Runner

> 本文档供 AI 编程工具（Trae / Claude / Cursor 等）阅读，提供项目架构、代码导航和修改约束。
> 文档已与代码核对一致（截至 2026-07-04，前端已拆分为 Vite + ES Module 项目，认证已从手机短信迁移到邮箱 SMTP）。

## 项目概述

3D 无限跑酷游戏，前端采用 Vite + ES Module 架构。`index.html` 仅保留 HTML 结构与 CDN 引用（260 行），所有 CSS / JS 拆分到 `src/` 目录。基于 Three.js r128（CDN 全局加载），Vite 5.4 构建。
配套有 FastAPI 后端（`backend/` 目录）已实现完整云服务，**前端已接入全部后端 API**（登录 / 云存档 / 全球榜 / 挑战短码）。

## 文件结构

```
index.html              # HTML 入口（结构 + CDN 引用，260 行）
package.json            # Vite 项目配置
vite.config.js          # Vite 配置（proxy + 分块策略）
src/                    # 前端源码（ES Module）
├── main.js             # 应用入口，导入 game/main-game.js
├── styles/             # CSS 模块（11 个文件）
│   ├── main.css        #   样式入口，@import 按序引入 10 个文件
│   ├── variables.css   #   CSS 变量（颜色/字体/间距）
│   ├── base.css        #   基础重置
│   ├── overlay.css     #   遮罩面板
│   ├── buttons.css     #   按钮基类 + 变体
│   ├── hud.css         #   游戏内 HUD
│   ├── menu.css        #   主菜单 tabs / 难度选择
│   ├── components.css  #   皮肤网格 / 成就列表 / 排行榜表格
│   ├── toast.css       #   Toast 通知
│   ├── auth-modal.css  #   登录 modal / 网络指示器 / 用户菜单
│   └── responsive.css  #   响应式断点（375/768/1440/1920px + reduced-motion）
├── core/               # 核心工具
│   ├── config.js       #   CONFIG / REGION_CONFIG / COLORS 常量
│   ├── storage.js      #   localStorage 安全访问封装
│   └── utils.js        #   showToast / hexToCss
├── services/           # 云端服务模块
│   ├── api-client.js   #   APIClient（fetch 封装 + 401 自动刷新 + 依赖注入）
│   ├── auth.js         #   AuthManager（OTP 登录 / token 管理）
│   ├── cloud-sync.js   #   CloudSync（进度同步 + 防抖 500ms + 离线队列）
│   ├── challenge-cloud.js # ChallengeCloud（挑战短码 API）
│   └── network-indicator.js # NetworkIndicator（在线状态 UI）
├── ui/                 # UI 控制模块
│   └── auth-ui.js      #   AuthUI（登录 modal 3 步流程 + setGameCallbacks 注入）
└── game/
    └── main-game.js    # 游戏主逻辑（Three.js 场景/物理/碰撞/生成/循环，5450+ 行）
.gitignore
backend/                # FastAPI 后端（已实现，前端已接入）
├── pyproject.toml      # 依赖与项目元信息
├── .env.example        # 环境变量模板
├── alembic.ini
├── _libs/              # vendored 运行时依赖（无虚拟环境时使用）
├── alembic/            # 数据库 migration
│   ├── env.py
│   └── versions/
│       ├── 0001_mysql_initial.py
│       └── 0002_refresh_token_jti.py   # refresh token jti（服务端撤销）
├── app/
│   ├── main.py         # FastAPI 入口（lifespan + CORS + 路由挂载）
│   ├── config.py       # 配置加载（.env）
│   ├── db.py           # aiomysql 连接池 + MySQLConn 兼容包装层
│   ├── security.py     # JWT
│   ├── deps.py         # 依赖注入（当前用户、DB 连接）
│   ├── limiter.py      # slowapi 速率限制
│   ├── schemas/        # Pydantic 模型（auth/leaderboard/progress/challenge）
│   ├── routers/        # 路由（auth/leaderboard/progress/challenge）
│   └── services/       # 业务逻辑（anti_cheat / share_code / sms_service / otp_store）
└── tests/              # pytest 集成测试（test_auth / test_leaderboard / test_progress / test_challenge / conftest）
```

## 代码架构导航

前端代码按功能拆分到 `src/` 目录下的 ES Module 文件：

### 一、HTML 入口（`index.html`，260 行）
- `<head>`：meta、字体（Chakra Petch / Sora / JetBrains Mono）、Font Awesome、Three.js r128 CDN 脚本
- `<link rel="stylesheet" href="/src/styles/main.css">`：CSS 入口
- `<script type="module" src="/src/main.js">`：JS 入口
- `<body>` HTML 结构：
  - `#hud`：游戏内 HUD（距离/速度/能量/综合评分加成 `#scoreBonus`）
  - `#startScreen`：主菜单（开始/涂装车间/排行榜/成就 选项卡）
  - `#gameOverScreen`：结束面板（分数/成就/分享按钮/返回）
  - `#pauseScreen`：暂停面板
  - `#authModal`：登录 modal（3 步流程：邮箱→验证码→已登录）
  - `#networkStatus`：左下角网络状态指示器
  - `#userMenuBtn`：菜单右上角用户按钮
  - `#toastContainer`：Toast 通知容器
  - `.leaderboard-tabs`：排行榜本地榜/全球榜切换

### 二、CSS 模块（`src/styles/`，11 个文件）
- `main.css`：入口，`@import` 按序引入 10 个样式文件
- `variables.css`：CSS 变量（`--accent-primary` / `--bg-base` / `--panel-glass` 等 24 个）
- `base.css` / `overlay.css` / `buttons.css`：基础样式 + 面板 + 按钮
- `hud.css` / `menu.css` / `components.css`：HUD + 菜单 + 皮肤/成就/排行榜组件
- `toast.css` / `auth-modal.css`：Toast + 登录 modal / 网络指示器
- `responsive.css`：响应式断点（375/768/1440/1920px + `prefers-reduced-motion`）

### 三、核心工具（`src/core/`）
| 文件 | 导出 | 说明 |
|------|------|------|
| `config.js` | `REGION_LENGTH`(800) / `CONFIG` / `REGION_CONFIG` / `COLORS` | 核心配置常量，`CONFIG.STORAGE_KEYS` 含 8 个 localStorage key，`CONFIG.API_BASE_URL = 'http://127.0.0.1:8000'` |
| `storage.js` | `safeGetItem` / `safeParseJSON` / `safeSetItem` | localStorage 安全访问封装（try-catch + JSON 解析） |
| `utils.js` | `showToast` / `hexToCss` | Toast 通知 + 颜色格式转换 |

### 四、云端服务模块（`src/services/`）
| 文件 | 导出 | 说明 |
|------|------|------|
| `api-client.js` | `APIClient` | fetch 封装，`setTokenGetter(fn)` / `setRefreshHandler(fn)` 注入 AuthManager（避免循环依赖），401 自动刷新重试 |
| `auth.js` | `AuthManager` | OTP 登录流程（`sendOTP` / `verifyOTP`）、token 管理（`getAccessToken` / `refresh`）、localStorage 持久化 |
| `cloud-sync.js` | `CloudSync` | 进度同步（防抖 500ms + 失败入队 + 合并策略），`saveProgress` / `loadProgress` / `submitScore` / `getGlobalLeaderboard` |
| `challenge-cloud.js` | `ChallengeCloud` | 挑战短码 API：`createChallenge` / `getChallenge` / `submitChallengeScore` / `getChallengeLeaderboard` |
| `network-indicator.js` | `NetworkIndicator` | 在线状态 UI：`init` / `probe` / `setOnline` / `setOffline` / `setSyncing` |

### 五、UI 控制模块（`src/ui/`）
| 文件 | 导出 | 说明 |
|------|------|------|
| `auth-ui.js` | `AuthUI` | 登录 modal 3 步流程控制，通过 `setGameCallbacks({ loadSkins, applySkin, renderSkinsUI, renderAchievementsUI })` 注入游戏函数（可选链 `?.` 防护） |

### 六、游戏主逻辑（`src/game/main-game.js`，5340+ 行）
所有游戏逻辑集中在此文件（共享变量多，不宜进一步拆分）。顶部 import 9 个模块 + `/* global THREE */`。

| 功能区 | 说明 |
|--------|------|
| URL 参数检测 | 支持 `?seed=BASE36&s=分数&c=连击`（旧版种子直传）和 `?c=ABC123`（新版云端短码） |
| AudioManager | Web Audio 合成器：菜单氛围乐 + 5 区域×3 情绪分层配乐 + 16 种音效 + 双层立体风噪 |
| ParticleSystem / ScreenShake / SpeedLines | 粒子特效 / 屏幕震动 / 速度线 |
| Three.js 场景 | Scene/Camera/Renderer + EffectComposer（特性检测：CDN 加载失败降级为直接渲染） |
| 难度系统 | `difficultySettings`(3档) + `DIFFICULTY_CURVE`(6段距离曲线) + `getDifficultyAt()` |
| PATTERNS | 17 种预设障碍模式数组 |
| 种子随机 | `mulberry32(seed)` + `gameRng`（仅替换玩法生成的 `Math.random`） |
| Wall Shaders + 对象池 | 自定义墙体着色器 + 障碍/激光/道具 Mesh 复用池 |
| 玩家角色 + 霓虹尾迹 | 立方体 Mesh + 光晕 + 护盾 + 拖尾效果 |
| 皮肤系统 | 5 种皮肤 + `loadSkins()/applySkin()/renderSkinsUI()` |
| 排行榜 | `saveScore()`（返回 `isNewRecord`） / `renderLeaderboardUI()`（本地 Top5 + 全球榜切换，动态切换表头） |
| Zone 系统 | `ZONE_THEMES`(5主题) + `ZONE_EFFECTS`(5效果) + `getZoneEffect()` 工厂 |
| 游戏循环 | `startGame()` / `startGameLoop()` / `endGame()` / `animate()` / `renderFrame()` |
| 启动序列 | 文件末尾：初始化各模块 + 注入回调 + 自动加载云端进度 + 处理 `?c=` 短码 + `animate()` |

## 核心数据模型

### state 索引系统（贯穿全游戏）
```
0 = 底墙 (bottom)   Y = -R
1 = 右墙 (right)    X = +R
2 = 顶墙 (top)      Y = +R
3 = 左墙 (left)     X = -R
```
玩家重力状态 `gravityState`、障碍物 `obs.state`、道具 `powerup.state` 三处共用此映射。

### 障碍物对象结构
```js
{
  mesh,              // Three.js Mesh
  state,             // 0-3 墙面索引
  localZ,            // 段内Z位置
  height,            // 碰撞高度
  type,              // 'box' | 'laser'
  isMoving,          // 是否移动
  moveDirection,     // ±1
  moveSpeed,         // 移动速度
  rotationSpeed,     // 旋转速度
  armingTimer,       // 激光蓄力计时器（0.45秒）
  armed,             // 激光是否已激活
  zoneEffect,        // Zone效果配置对象（通过 getZoneEffect() 获取）
  blinkTimer,        // Zone2 闪烁计时
  pulseTimer,        // Zone3 脉动计时
  swapTimer,         // Zone4 互换计时
  nearMissed,        // 是否已触发近身闪避
  _disabled          // Zone2 隐身时碰撞跳过标记
}
```

### 段（Segment）结构
```js
seg.userData = {
  obstacles: [],      // 障碍物数组
  powerups: [],       // 道具数组
  distance: number,   // 该段的世界Z距离
  isBranch: boolean,          // 是否为分支路径段
  branchSafeState: number     // 分支段安全侧墙面索引
}
```

## 种子随机系统

- `mulberry32(seed)` 生成确定性伪随机函数（`src/game/main-game.js`）
- `gameRng` 全局变量：默认 `Math.random`，`startGame()` 中替换为 `mulberry32(currentSeed)`
- **仅替换玩法相关**的 `Math.random()`：`spawnObstacles` / `spawnPowerups` 内部
- **不替换视觉特效**的 `Math.random()`：粒子/星空/震动/故障线条/音频噪声
- URL 格式支持两种：
  - 旧版种子直传：`?seed=BASE36&s=分数&c=连击`（如 `?seed=X7K2M9&s=1523&c=15`）
  - 新版云端短码：`?c=ABC123`（6 位短码，由 `ChallengeCloud.getChallenge()` 异步解析）

## 修改约束（重要）

### 必须遵守
1. **模块化架构**：前端代码拆分到 `src/` 目录下的 ES Module 文件；`index.html` 仅保留 HTML 结构与 CDN 引用，不内联 CSS/JS
2. **游戏主逻辑不拆分**：`src/game/main-game.js` 因共享变量多（50+ 个跨函数全局变量）保留为单文件，不宜进一步拆分
3. **对象池复用**：障碍/激光/道具使用对象池，从池中取出时必须重置 `scale`（`set(1,1,1)`)和 `visible`
4. **共享材质**：障碍物和激光共享 `obstacleMaterial` / `laserMaterial`，**不能修改材质的 opacity/transparent/color**，否则会影响所有同类对象。用 `mesh.scale` 模拟视觉变化
5. **Zone 效果对象**：必须通过 `getZoneEffect()` 工厂函数获取，不能直接引用 `ZONE_EFFECTS` 共享对象（会交叉污染）
6. **gameRng 一致性**：新增任何影响障碍/道具/玩法生成的随机调用，必须用 `gameRng()` 而非 `Math.random()`
7. **case 块作用域**：`switch` 的 `case` 中使用 `const`/`let` 必须用 `{}` 包裹
8. **循环依赖**：`APIClient` 与 `AuthManager` 之间通过 `setTokenGetter` / `setRefreshHandler` 依赖注入解决，不要直接互相 import
9. **游戏回调注入**：`AuthUI` 通过 `setGameCallbacks({ loadSkins, applySkin, renderSkinsUI, renderAchievementsUI })` 接收游戏函数，用可选链 `?.` 防护
10. **Three.js CDN 全局**：Three.js r128 通过 `<script>` 标签全局加载，代码中用 `/* global THREE */` 标注；EffectComposer 等后处理需特性检测（CDN 加载失败时降级为直接渲染）
11. **保留 id/class 命名**：不要修改现有 `id` / `class` 名称，避免破坏 `querySelector` 绑定
12. **refresh token 轮换**：`/auth/refresh` 每次调用都生成新 jti 并写回 `users.refresh_token_jti`，旧 refresh token 立即失效（单设备登录语义）。登出时 jti 置 NULL。不要在客户端长期缓存 refresh token 后假设它一直有效。

### 编码规范
- 变量命名：`camelCase`
- 常量命名：`UPPER_SNAKE_CASE`
- 注释语言：中文
- 注释风格：`// ============ 模块名 ============` 分隔各模块
- ES Module `import/export`，无 TypeScript，无 ESLint
- Vite 构建（`npm run dev` / `npm run build`），开发服务器已配置后端 API 代理

### localStorage Keys（共 8 个）
| Key | 用途 | 定义位置 |
|-----|------|----------|
| `g_tunnel_leaderboard` | 排行榜 Top5（含 `[挑战]` 标记） | `config.js` → `STORAGE_KEYS.LEADERBOARD` |
| `g_tunnel_achievements` | 成就解锁状态 | `config.js` → `STORAGE_KEYS.ACHIEVEMENTS` |
| `g_tunnel_cumulative_powerups` | 累计收集道具数 | `config.js` → `STORAGE_KEYS.POWERUPS` |
| `g_tunnel_credits` | 积分余额 | `config.js` → `STORAGE_KEYS.CREDITS` |
| `g_tunnel_unlocked_skins` | 已解锁皮肤列表 | `config.js` → `STORAGE_KEYS.SKINS` |
| `g_tunnel_current_skin` | 当前选中皮肤 | `config.js` → `STORAGE_KEYS.CURRENT_SKIN` |
| `g_tunnel_auth` | 认证信息（token + user） | `config.js` → `STORAGE_KEYS.AUTH` |
| `g_tunnel_pending_sync` | 待同步队列（离线时入队） | `config.js` → `STORAGE_KEYS.PENDING_SYNC` |

## 后端集成现状

### 前端云集成模块（**已完整实现**）

前端 `src/` 已接入全部后端 API，模块拆分如下：
- ✅ `APIClient`（`src/services/api-client.js`）：fetch 封装 + Bearer token + 401 自动刷新
- ✅ `AuthManager`（`src/services/auth.js`）：OTP 登录 / token 管理 / localStorage 持久化
- ✅ `CloudSync`（`src/services/cloud-sync.js`）：进度同步（防抖 500ms + 离线队列 + 合并策略）
- ✅ `ChallengeCloud`（`src/services/challenge-cloud.js`）：挑战短码 API
- ✅ `NetworkIndicator`（`src/services/network-indicator.js`）：在线状态 UI
- ✅ `AuthUI`（`src/ui/auth-ui.js`）：登录 modal 3 步流程 + 游戏回调注入
- ✅ `CONFIG.API_BASE_URL = 'http://127.0.0.1:8000'`（`src/core/config.js`）
- ✅ `g_tunnel_auth` / `g_tunnel_pending_sync` localStorage key
- ✅ 挑战短码（`?c=ABC123`）逻辑已实现
- ✅ Vite proxy 代理后端 API（`/auth` `/leaderboard` `/progress` `/challenges` `/health`）

后端不可用时自动降级为本地模式，分数入队待重试，联网自动同步。

### 后端 API 端点（FastAPI，默认 http://127.0.0.1:8000）

| 路径 | 方法 | 说明 |
|------|------|------|
| `POST /auth/send-otp` | POST | 发送邮箱验证码（开发模式固定 123456），返回 `is_new_user` 供前端切换注册/登录 UI |
| `POST /auth/verify` | POST | 验证验证码 → 登录/注册 → 返回 access/refresh token + `expires_in` + 用户信息 |
| `GET /auth/me` | GET | 当前用户（需 JWT，含 `created_at`） |
| `POST /auth/refresh` | POST | 刷新 access token + **轮换 refresh token**（旧 token 立即失效），校验 jti，限速 |
| `POST /auth/logout` | POST | 登出（需 JWT）：撤销服务端 refresh token jti，使所有 refresh token 失效 |
| `PUT /auth/profile` | PUT | 修改用户名 / 显示名（需 JWT），用户名冲突返回 409，限速 |
| `DELETE /auth/account?confirm=true` | DELETE | 注销账号（需 JWT + `confirm=true` 二次确认），CASCADE 清理关联数据，严格限速 |
| `POST /auth/login-password` | POST | 邮箱+密码登录（bcrypt 校验，防枚举统一返回"邮箱或密码错误"），返回 access/refresh token |
| `POST /auth/set-password` | POST | 首次设置密码（需 JWT，已设返回 409） |
| `PUT /auth/change-password` | PUT | 修改密码（需 JWT + 旧密码验证） |
| `POST /auth/reset-password` | POST | 邮箱验证码重置密码（无需 JWT，限速 3/hour） |
| `POST /auth/avatar` | POST | 上传头像（需 JWT，multipart/form-data，5MB 限制，Pillow 缩放 256×256） |
| `POST /auth/change-email/send-otp` | POST | 向新邮箱发送验证码（需 JWT，限速 3/hour） |
| `POST /auth/change-email/verify` | POST | 验证 OTP 完成邮箱变更（需 JWT） |
| `POST /leaderboard/submit` | POST | 提交分数（需 JWT，含防作弊校验） |
| `GET /leaderboard/top` | GET | 全球 Top 排行榜（支持难度 / 挑战筛选） |
| `GET /leaderboard/user/{user_id}` | GET | 用户历史分数 |
| `GET /progress/get` | GET | 拉取云端存档 |
| `PUT /progress/save` | PUT | 保存进度（last-write-wins + 并集合并） |
| `POST /challenges/create` | POST | 创建挑战（生成 6 位短码） |
| `GET /challenges/{code}` | GET | 获取挑战详情 |
| `POST /challenges/{code}/submit` | POST | 提交挑战成绩 |
| `GET /challenges/{code}/leaderboard` | GET | 挑战排行榜 |
| `GET /health` | GET | 健康检查（含 DB 连通性） |

### 外部依赖（CDN）
- Three.js r128：`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`
- Three.js 后期处理：EffectComposer / RenderPass / UnrealBloomPass / ShaderPass / CopyShader / LuminosityHighPassShader
- Google Fonts：Chakra Petch（标题/数字） / Sora（正文） / JetBrains Mono（等宽）
- Font Awesome 6.4.0

## 常见修改场景

> 以下涉及的代码均在 `src/game/main-game.js` 中（游戏主逻辑单文件），CSS 在 `src/styles/` 对应文件中。

### 新增障碍模式
在 `PATTERNS` 数组添加 `{ walls: [0,2], minDist: 1500, weight: 3 }`，`spawnObstacles` 会自动按距离过滤和加权选取。

### 调整难度曲线
修改 `DIFFICULTY_CURVE` 数组，调整各距离段的 `maxWallsBase` / `laserChance` / `movingChance` / `powerupChance` / `moveSpeedMin` / `moveSpeedMax`。

### 新增道具类型
1. 在 `spawnPowerups` 的 if-else 链中添加 type 判定
2. 在 `getPowerupFromPool` 中添加对应 Mesh 创建逻辑
3. 在 `checkCollisions` 道具碰撞段中添加效果逻辑
4. 在 `POWERUP_COLORS` / `POWERUP_LABELS` 中添加对应配色与文案
5. 在道具 UI 图标 HTML 中添加对应显示

### 新增 Zone 效果
1. 在 `ZONE_EFFECTS` 添加 `{ type: 'yourType', ...params }`
2. 在主循环 Zone 效果 switch 中添加 `case 'yourType':` 分支
3. 在 `getZoneEffect()` 中确认会返回浅拷贝（已自动处理 `{ ...effect }`）

### 新增成就
在 `achievements` 对象添加 `{ name: "名称", desc: "描述", unlocked: false }`，在合适位置添加解锁检查逻辑。

### 新增 CSS 样式
按功能选择对应的 CSS 文件：HUD → `hud.css`，菜单 → `menu.css`，皮肤/成就 → `components.css`，登录/网络 → `auth-modal.css`，响应式 → `responsive.css`。新文件需在 `main.css` 中 `@import`。

### 新增云端 API 调用
在 `src/services/` 对应模块中添加方法，使用 `APIClient.get/post/put`。如需 token，`APIClient` 已通过 `setTokenGetter` 自动注入。

## 已知注意事项

1. `maxWalls` 硬限制为 `Math.min(3, ...)` 配合三墙模式
2. 激光 `mesh.scale` 在蓄力期间会被修改，对象池取出时已重置 `scale(1,1,1)`
3. Zone3 脉动效果会修改 `mesh.scale`，同上
4. Zone4 互换会修改 `obs.state`，碰撞检测直接使用 `obs.state` 所以逻辑正确
5. `recentEvents` 数组限制最大 50 条，防止高密度障碍区内存增长
6. 障碍生成使用 PATTERNS 加权随机（无 `shuffle` 函数）
7. HUD 主分数显示原始距离（米），综合评分加成显示在 `#scoreBonus` 中
8. 菜单配乐依赖首次用户交互（click/touchstart）启动，符合浏览器自动播放策略
9. 分享按钮在受限环境（如无剪贴板权限）下会触发 500ms 超时兜底，显示"链接已生成（请手动复制）"
10. `HAPTIC_PATTERNS` 定义 jump/wallSwitch/collision/damage 四种振动模式，在相应交互点调用 `navigator.vibrate()`
11. **挑战模式支持两种 URL 格式**：旧版 `?seed=XXX&s=123&c=10` 种子直传 + 新版 `?c=ABC123` 云端短码
12. **EffectComposer 特性检测**：CDN 后处理脚本加载失败时降级为 `renderer.render()` 直接渲染（控制台 warning）
13. **循环依赖**：`APIClient` ↔ `AuthManager` 通过依赖注入解决（`setTokenGetter` / `setRefreshHandler`），不要改为直接 import
14. **账号注销是硬删除**：`DELETE /auth/account` 直接 `DELETE FROM users`，靠 FK CASCADE 清理 scores/player_progress/challenges。不可恢复，前端必须二次确认。
15. **前端提交分数字段名 `combo`**（非 `max_combo`）：后端 `LeaderboardSubmit` schema 要求 `combo` 字段，前端 `cloud-sync.js` / `challenge-cloud.js` 均用 `combo`。改 schema 时必须 grep 所有 API 调用点同步修改。
16. **`duration_sec` 必须是正整数**：后端 `ge=1` 校验，前端用 `Math.floor()` 取整且 `<1` 时不发送该字段。提交浮点数或 0 会触发 422。
17. **`current_skin` / `unlocked_skins` 是字符串**：后端要求 `str` / `List[str]`，前端直接读字符串（如 `'classic'`），**不要 `parseInt`**（会得到 NaN→0）。
18. **挑战分享短码字段名 `share_code`**：`ChallengeShareResponse` 返回 `share_code`（非 `code`），前端 `main-game.js` 分享按钮读 `challenge.share_code`。
19. **成就存储格式为纯布尔值**：localStorage 和后端均存 `{firstSteps: true}`（非 `{unlocked: true}`）。`cloud-sync.js` 的 `isUnlocked()` 辅助函数兼容两种格式，但新代码应使用纯布尔值。
20. **`safeGetItem` 语义**：localStorage 可用但 key 不存在时返回 `null`（不是 fallback）；fallback 仅在 localStorage 访问抛异常时使用。检查"未设置"应判 `=== null`，不是 `=== ''`。
21. **设置持久化**：音量/音乐/音效/难度通过 `safeGetItem`/`safeSetItem` 读写 localStorage，AudioManager 在构造时读取并应用。
22. **新纪录庆祝动效**：`saveScore()` 返回 `isNewRecord`，`endGame()` 据此触发金色徽章 + 全屏闪光 + 成就音效（`.new-record-badge` / `.game-over-flash`）。
23. **移动端安全区**：`viewport-fit=cover` + `env(safe-area-inset-*)` 适配刘海/全面屏，hud/toast/overlay/responsive CSS 均使用 `calc(基础值 + env(safe-area-inset-*))`。
24. **密码可选共存**：users.password_hash 列允许 NULL。未设密码用户只能用 OTP 登录；密码登录时若 password_hash 为 NULL 统一返回 401"邮箱或密码错误"（防枚举）。UserPublic schema 的 `has_password` 字段反映此状态。
25. **头像存储路径固定**：`/uploads/avatars/{user_id}.png`（Pillow 强制转 PNG + 256×256）。同名覆盖，无历史文件残留问题。FastAPI StaticFiles 挂载 `/uploads`，nginx 代理缓存 7 天。前端 `?v={timestamp}` 击穿缓存。
26. **avatar_data Docker 卷**：`docker-compose.yml` 中 backend 服务挂载 `avatar_data:/app/uploads`，重建容器不丢失头像。
27. **bcrypt 重新引入**：`pyproject.toml` 含 `bcrypt>=4.0` 与 `Pillow>=10.0`。`security.py` 的 `hash_password` / `verify_password` 函数；`services/avatar_service.py` 的 `process_and_save_avatar`。
