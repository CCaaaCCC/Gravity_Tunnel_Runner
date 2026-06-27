# AI Context — Gravity Tunnel Runner

> 本文档供 AI 编程工具（Trae / Claude / Cursor 等）阅读，提供项目架构、代码导航和修改约束。

## 项目概述

3D 无限跑酷游戏，单文件架构，`index.html` 约 5100 行（HTML + CSS + JS 内联）。基于 Three.js r128，无构建工具、无 npm 依赖。

## 文件结构

```
index.html          # 全部代码（HTML结构 + CSS样式 + JS逻辑）
.gitignore          # 忽略 .trae/
.trae/documents/    # 开发方案文档（不参与运行）
```

## 代码架构导航

`index.html` 内部分为三大区域，按行号从上到下：

### 一、HTML + CSS（L1~L1054）
- `<head>`：meta、字体（Chakra Petch / Sora / JetBrains Mono）、Font Awesome
- `<style>`：全局样式、菜单面板、HUD、游戏结束面板、排行榜表格
- `<body>` HTML 结构：
  - `#hud`：游戏内 HUD（距离/速度/能量/综合评分加成）
  - `#startScreen`：主菜单（开始/难度/排行榜/皮肤 选项卡）
  - `#gameOverScreen`：结束面板（分数/成就/分享按钮/返回）
  - `#pauseScreen`：暂停面板
  - `#challengeBanner`：挑战模式横幅
  - `#comboMilestone`：连击里程碑弹窗
  - `#zoneFlash`：区域切换闪光

### 二、JS 核心模块（L1055~L5151）

| 行号范围 | 模块 | 说明 |
|----------|------|------|
| L1063~L1078 | URL种子检测 | 读取 `?seed=&s=&c=` 参数，初始化挑战模式 |
| L1079~L2613 | AudioManager | Web Audio 合成器：菜单氛围乐 + 5 区域×3 情绪分层配乐 + 16 种音效 + 双层立体风噪 |
| L2614~L2705 | ParticleSystem | 粒子特效（碰撞爆炸/收集闪光/连击爆发） |
| L2706~L2737 | ScreenShake | 屏幕震动 |
| L2738~L2783 | SpeedLines | 速度线效果 |
| L2784~L2810 | 基础场景 + Bloom | Three.js Scene/Camera/Renderer + UnrealBloomPass |
| L2845~L3008 | 星空粒子 | 三层视差星空/星云背景 |
| L3009~L3019 | 隧道参数 | `R=4`(半径), `SEG_LEN=10`(段长), `NUM_SEGMENTS=16`(段数) |
| L3020~L3080 | 难度系统 | `difficultySettings`(3档乘数) + `DIFFICULTY_CURVE`(6段距离曲线) + `getDifficultyAt()` |
| L3083~L3107 | PATTERNS | 17种预设障碍模式数组 |
| L3108~L3111 | 种子随机 | `mulberry32()` + `gameRng` + `currentSeed` |
| L3112~L3171 | 动态难度 | `recentEvents[]` + `dynamicDifficultyMod` |
| L3190~L3294 | 对象池与共享几何体 | 障碍/激光/道具的 Mesh 复用池 |
| L3181~L3189 | shuffle | Fisher-Yates 洗牌（用 `gameRng`） |
| L3295~L3458 | 段创建与生成 | `createSegment()` / `spawnObstacles()` / `spawnPowerups()` |
| L3459~L3557 | 玩家角色 | 立方体 Mesh + 光晕 + 护盾 Mesh |
| L3558~L3582 | 霓虹尾迹 | 玩家身后拖尾效果（环形缓冲） |
| L3595~L3694 | 皮肤系统 | 5种皮肤配置 + `loadSkins()/saveSkins()/applySkin()` |
| L3695~L3934 | 游戏机制状态变量 | 跳跃/能量/Buff/连击/成就等全局变量 |
| L3802~L3853 | 连击里程碑 | `COMBO_MILESTONES` + `showCombo()` + `triggerComboMilestone()` |
| L3935~L3997 | 重力旋转控制 | `gravityState` 切换动画 |
| L4027~L4178 | 排行榜 | `saveScore()/renderLeaderboardUI()`，localStorage Top5 |
| L4237~L4401 | 碰撞检测 | `checkCollisions()`：道具收集 + 障碍碰撞 + 近身闪避 |
| L4402~L4428 | Zone系统 | `ZONE_THEMES`(5主题) + `ZONE_EFFECTS`(5效果) + `getZoneEffect()` 工厂函数 |
| L4416~L4460 | Zone切换 | `updateZoneTheme()` + `triggerZoneChange()` |
| L4461~L4468 | 评分系统 | `getCompositeScore()`：距离 × 连击倍率 × 难度系数 + 道具分 |
| L4469~L4767 | 游戏循环 | `startCountdown()` / `startGame()` / `startGameLoop()` / `endGame()` / `restartGame()` / `returnToMenu()` |
| L4697~L4767 | 按钮事件 | 开始/重启/暂停/菜单/分享/难度/标签页 按钮绑定 |
| L4768~L5145 | 主循环体 | 每帧更新：移动/碰撞/Zone效果/激光蓄力/动态难度/连击衰减/渲染 |

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

- `mulberry32(seed)` 生成确定性伪随机函数
- `gameRng` 全局变量：默认 `Math.random`，`startGame()` 时替换为 `mulberry32(currentSeed)`
- **仅替换玩法相关**的 `Math.random()`：`shuffle` / `spawnObstacles` / `spawnPowerups` 内部
- **不替换视觉特效**的 `Math.random()`：粒子/星空/震动/故障线条/音频噪声
- URL 格式：`?seed=BASE36&s=分数&c=连击`，如 `?seed=X7K2M9&s=1523&c=15`

## 修改约束（重要）

### 必须遵守
1. **单文件架构**：所有代码在 `index.html` 中，不拆分文件
2. **对象池复用**：障碍/激光/道具使用对象池，从池中取出时必须重置 `scale`（`set(1,1,1)`)和 `visible`
3. **共享材质**：障碍物和激光共享 `obstacleMaterial` / `laserMaterial`，**不能修改材质的 opacity/transparent/color**，否则会影响所有同类对象。用 `mesh.scale` 模拟视觉变化
4. **Zone 效果对象**：必须通过 `getZoneEffect()` 工厂函数获取，不能直接引用 `ZONE_EFFECTS` 共享对象（会交叉污染）
5. **gameRng 一致性**：新增任何影响障碍/道具/玩法生成的随机调用，必须用 `gameRng()` 而非 `Math.random()`
6. **case 块作用域**：`switch` 的 `case` 中使用 `const`/`let` 必须用 `{}` 包裹

### 编码规范
- 变量命名：`camelCase`
- 常量命名：`UPPER_SNAKE_CASE`
- 注释语言：中文
- 注释风格：`// ============ 模块名 ============` 分隔各模块
- 无 TypeScript，无 ESLint，无构建步骤

### localStorage Keys
| Key | 用途 |
|-----|------|
| `g_tunnel_leaderboard` | 排行榜 Top5（含 challenge 标记） |
| `g_tunnel_achievements` | 成就解锁状态 |
| `g_tunnel_cumulative_powerups` | 累计收集道具数 |
| `g_tunnel_credits` | 积分余额 |
| `g_tunnel_unlocked_skins` | 已解锁皮肤列表 |
| `g_tunnel_current_skin` | 当前选中皮肤 |

### 外部依赖（CDN）
- Three.js r128：`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`
- Three.js 后期处理：EffectComposer / RenderPass / UnrealBloomPass / ShaderPass / CopyShader / LuminosityHighPassShader
- Google Fonts：Chakra Petch（标题/数字） / Sora（正文） / JetBrains Mono（等宽）
- Font Awesome 6.4.0

## 常见修改场景

### 新增障碍模式
在 `PATTERNS` 数组（L3084）添加 `{ walls: [0,2], minDist: 1500, weight: 3 }`，`spawnObstacles` 会自动按距离过滤和加权选取。

### 调整难度曲线
修改 `DIFFICULTY_CURVE` 数组（L3043），调整各距离段的 `maxWallsBase` / `laserChance` / `movingChance` / `powerupChance` / `moveSpeedMin` / `moveSpeedMax`。

### 新增道具类型
1. 在 `spawnPowerups`（L3401）的 if-else 链中添加 type 判定
2. 在 `getPowerupFromPool` 中添加对应 Mesh 创建逻辑
3. 在 `checkCollisions` 道具碰撞段中添加效果逻辑
4. 在道具 UI 图标 HTML 中添加对应显示

### 新增 Zone 效果
1. 在 `ZONE_EFFECTS`（L4402）添加 `{ type: 'yourType', ...params }`
2. 在主循环 Zone 效果 switch（约 L4990）中添加 `case 'yourType':` 分支
3. 在 `getZoneEffect()` 中确认会返回浅拷贝（已自动处理）

### 新增成就
在 `achievements` 对象（约 L3749）添加 `{ name: "名称", desc: "描述", unlocked: false }`，在合适位置添加解锁检查逻辑。

## 已知注意事项

1. `maxWalls` 原为 `Math.min(2, ...)` 硬限制，现已改为 `Math.min(3, ...)` 配合三墙模式
2. 激光 `mesh.scale` 在蓄力期间会被修改，对象池取出时已重置 `scale(1,1,1)`
3. Zone3 脉动效果会修改 `mesh.scale`，同上
4. Zone4 互换会修改 `obs.state`，碰撞检测直接使用 `obs.state` 所以逻辑正确
5. `recentEvents` 数组限制最大 50 条，防止高密度障碍区内存增长
6. `shuffle` 函数目前无调用方（spawnObstacles 改用 PATTERNS），保留为通用工具
7. HUD 主分数显示原始距离（米），综合评分加成显示在 `#scoreBonus` 中
8. 菜单配乐依赖首次用户交互（click/touchstart）启动，符合浏览器自动播放策略；`returnToMenu()` 会主动重启菜单配乐
9. 分享按钮在受限环境（如无剪贴板权限）下会触发 500ms 超时兜底，显示"链接已生成（请手动复制）"
