# 重力隧道 · Gravity Tunnel Runner

## 简介

重力隧道是一款基于 Three.js 的 3D 无限跑酷游戏。玩家在四面墙构成的隧道中前进，通过切换重力方向（吸附到不同墙面）和跳跃来躲避障碍物、收集道具，挑战更远的距离和更高的连击。
在线体验 → http://47.80.57.231/

## 特性

### 核心玩法
- **重力切换**：在四面墙（底/右/顶/左）之间即时切换，躲避不同方位的障碍
- **跳跃机制**：在当前墙面上跳跃越过低矮障碍
- **能量系统**：碰撞消耗能量，能量耗尽即结束，需通过道具补充
- **连击系统**：无敌状态下连续撞击障碍积累连击，10/20/30 触发里程碑奖励

### 障碍与道具
- **预设关卡片段**：17 种手作障碍模式（PATTERNS）按距离分级加权随机抽取，替代纯随机生成，保证节奏感
- **激光障碍**：横跨墙面的激光束，出现时有 0.45 秒蓄力预警（从极小缩放到全尺寸），蓄力期间不造成伤害
- **移动障碍**：部分障碍物会在墙面上左右移动
- **5 种道具**：能量（35%）、无敌（20%）、护盾（20%）、磁铁（15%）、加速（10%）
- **风险-收益设计**：高价值道具（无敌/加速）刻意生成在障碍物附近，玩家需在贴障躲避和放弃道具间抉择
- **分支路径**：2000 米后出现分支模式（双墙堵+安全侧高价值道具），模拟路径选择

### 区域系统（Zone）
每 800 米（`REGION_LENGTH`）切换一个区域主题，除换色外还拥有招牌机制：
| Zone | 名称（代码内） | 墙面色调 | 招牌机制 |
|------|------|--------|---------|
| 1 | 第一区域: 太空站 Alpha | 白色 | 无（教学区） |
| 2 | 第二区域: 星云穿越 | 浅紫 | 障碍周期性隐身（blink，2s 间隔） |
| 3 | 第三区域: 恒星轨道 | 浅橙 | 障碍尺寸周期性脉动（pulse，1.5s / 振幅 0.3） |
| 4 | 第四区域: 深空航线 | 浅绿 | 对面墙壁障碍互换（swap，3s 间隔） |
| 5 | 极限挑战: 银河之心 | 金色 | 障碍移动速度 ×1.4 |

### 动态难度（Rubber-banding）
追踪最近 10 秒的闪避成功率，每 2 秒微调难度系数（0.7~1.3）：高手会遇到更密集的障碍，新手也能撑更久。

### 可分享链接（挑战模式）
- 每局游戏生成随机种子，地图序列完全由种子决定
- 游戏结束后可点击「分享此地图」复制链接
- 他人打开链接进入挑战模式，游玩完全相同的地图
- 挑战模式分数与普通模式共用本地排行榜，以 `[挑战]` 标记区分
- 结束时显示与原始记录的对比
- URL 格式：`?seed=BASE36&s=分数&c=连击`（如 `?seed=X7K2M9&s=1523&c=15`）

### 云端功能（前后端已完整集成）

> **现状**：前端 `src/` 已接入全部后端 API，包括登录注册、云存档同步、全球排行榜、挑战短码。后端不可用时自动降级为本地模式。

- **用户账号**：邮箱注册 / 登录（验证码），JWT 鉴权（access + refresh token 轮换），服务端登出 / 修改用户名 / 注销账号，跨设备身份统一
- **云端排行榜**：全球 Top，按难度 / 挑战模式筛选，菜单内可切换本地榜 / 全球榜
- **云存档同步**：成就、皮肤、积分跨设备同步（last-write-wins + 并集合并），防抖 500ms
- **挑战短码**：已登录用户分享地图时生成 6 位短码（`?c=ABC123`），服务端托管挑战与排行榜
- **离线降级**：网络不可用时退回本地存储，分数入队待重试，联网自动同步
- **防作弊**：服务端校验分数合理性（范围、难度反推、速率限制）
- **网络状态指示器**：左下角实时显示在线 / 离线 / 同步中状态

### 账号管理
- **登录方式**：邮箱验证码 或 邮箱+密码（密码可选，bcrypt 哈希）
- **密码管理**：首次设置 / 修改（验证旧密码）/ 邮箱验证码重置
- **头像上传**：JWT 鉴权，支持 JPEG/PNG/WebP，最大 5MB，Pillow 自动缩放为 256×256 PNG，存储于 `uploads/avatars/{user_id}.png`（avatar_data Docker 卷持久化）
- **邮箱变更**：双邮箱验证（向新邮箱发送 OTP），24h 限速 3 次
- **个人资料**：用户名（3-20 字符，中英文/数字/下划线）、显示名、头像
- **安全**：refresh token 轮换 + JTI 撤销、密码登录防枚举（统一"邮箱或密码错误"）、速率限制

### 其他系统
- **成就系统**：10 个成就（初出茅庐、连击大师、速度恶魔、生存专家、不死鸟、终极收藏家、速度之王、区域探索者、连击传奇等）
- **皮肤系统**：5 种皮肤（经典霓蓝 0 / 脉冲幽紫 250 / 熔岩红橙 750 / 黑客矩阵 1500 / 黄金传说 3000 积分解锁）
- **排行榜**：本地 Top 5 记录（`g_tunnel_leaderboard`，含挑战模式标记）
- **音频系统**：自实现 Web Audio 合成器，菜单氛围乐 + 5 区域差异化配乐（ambient/cruise/intense 三层情绪交叉淡化）+ 16 种合成器音效 + 双层立体风噪
- **设置持久化**：音量、音乐、音效、难度偏好通过 localStorage 跨会话保存
- **新纪录庆祝动效**：破纪录时金色徽章 + 全屏闪光 + 成就解锁音效
- **移动端适配**：viewport-fit=cover + env(safe-area-inset-*) 刘海/全面屏安全区适配，44px 最小触控目标
- **性能自适应**：FPS 采样自动调节 Bloom 特效等级
- **Bloom 后处理**：UnrealBloomPass 泛光效果

## 操作方式

### PC 端
- `←` / `→` / `↓`：切换墙壁（底/右/顶/左）
- `空格` / `↑`：跳跃
- `P` / `Esc`：暂停

### 移动端
- 滑动屏幕切换墙壁
- 向上滑动跳跃

## 技术栈

- **渲染**：Three.js r128（CDN 全局加载，含 EffectComposer / UnrealBloomPass）
- **音频**：Web Audio API（自实现 AudioManager，无外部音频文件）
- **前端存储**：localStorage（排行榜 / 成就 / 皮肤 / 积分 / 认证 / 待同步队列，共 8 个 key）
- **后端**：FastAPI（Python 3.11+）+ aiomysql + MySQL 8.0
- **认证**：JWT (HS256) + 邮箱验证码（SMTP，开发模式固定 123456）+ 可选密码（bcrypt）
- **样式**：CSS3 + Google Fonts (Chakra Petch / Sora / JetBrains Mono) + Font Awesome
- **构建工具**：Vite 5.4（ES Module 开发 + 生产构建）
- **架构**：前端 Vite + ES Module 项目（`src/` 目录按功能拆分）+ 后端 `backend/` 目录（FastAPI 项目）

## 如何运行

### 前端（Vite 开发服务器）

1. 安装依赖：`npm install`
2. 启动开发服务器：`npm run dev`（默认 http://localhost:8080）
3. 通过菜单选择难度（简单/普通/困难），点击开始
4. 游戏结束后可分享地图链接（`?c=ABC123` 短码格式）或查看排行榜
5. 纯本地模式也可游玩，云端功能在菜单右上角登录后自动启用
6. 生产构建：`npm run build`（输出到 `dist/`），预览构建：`npm run preview`

> Vite 开发服务器已配置代理：`/auth` `/leaderboard` `/progress` `/challenges` `/health` 自动转发到后端 `http://127.0.0.1:8000`，避免 CORS 问题。

### 后端（启用云端功能需启动后端）

1. **准备 MySQL 数据库**：
   ```sql
   CREATE DATABASE gravity_tunnel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
2. **配置环境变量**：
   ```bash
   cd backend
   cp .env.example .env
   # 编辑 .env，填入 DATABASE_URL / JWT_SECRET
   # 开发阶段：留空 SMS_xxx 会默认固定验证码 123456，不需要短信服务商
   ```
3. **安装依赖并运行 migration**：
   ```bash
   python -m venv .venv
   # Windows: .venv\Scripts\activate
   # macOS/Linux: source .venv/bin/activate
   pip install -e ".[dev]"
   alembic upgrade head      # 创建数据库表
   uvicorn app.main:app --reload   # 启动后端，默认 http://127.0.0.1:8000
   ```
4. **验证**：访问 http://127.0.0.1:8000/docs 查看 Swagger UI，http://127.0.0.1:8000/health 检查健康
5. **运行测试**：`pytest -v`（需先配置 `.env` 中的 DATABASE_URL）

> 后端默认监听 `http://127.0.0.1:8000`。前端已完整接入所有后端 API（登录 / 云存档 / 全球榜 / 挑战短码），后端离线时自动降级为本地模式。

## 项目结构

```
Gravity_Tunnel_Runner/
├── index.html              # HTML 入口（结构 + CDN 引用，264 行）
├── package.json            # Vite 项目配置
├── vite.config.js          # Vite 配置（proxy + 分块策略）
├── README.md               # 本文档
├── AI_CONTEXT.md           # AI 编程上下文与代码约束
├── .gitignore
├── src/                    # 前端源码（ES Module）
│   ├── main.js             # 应用入口，导入 game/main-game.js
│   ├── styles/             # CSS 模块（11 个文件，由 main.css @import 聚合）
│   │   ├── main.css        #   样式入口，按序引入下方 10 个文件
│   │   ├── variables.css   #   CSS 变量（颜色/字体/间距）
│   │   ├── base.css        #   基础重置 + body/scrollbar
│   │   ├── overlay.css     #   遮罩面板 + panel-top-bar
│   │   ├── buttons.css     #   按钮基类 + 变体
│   │   ├── hud.css         #   游戏内 HUD（距离/速度/能量/连击）
│   │   ├── menu.css        #   主菜单 tabs / 难度选择 / 按键说明
│   │   ├── components.css  #   皮肤网格 / 成就列表 / 排行榜表格
│   │   ├── toast.css       #   Toast 通知系统
│   │   ├── auth-modal.css  #   登录 modal / 网络状态指示器 / 用户菜单
│   │   └── responsive.css  #   响应式断点（375/768/1440/1920px + reduced-motion）
│   ├── core/               # 核心工具模块
│   │   ├── config.js       #   CONFIG / REGION_CONFIG / COLORS 常量
│   │   ├── storage.js      #   localStorage 安全访问封装
│   │   └── utils.js        #   showToast / hexToCss 通用工具
│   ├── services/           # 云端服务模块
│   │   ├── api-client.js   #   APIClient（fetch 封装 + 401 自动刷新）
│   │   ├── auth.js         #   AuthManager（OTP + 密码登录 / token 管理 / 头像 / 邮箱变更）
│   │   ├── cloud-sync.js   #   CloudSync（进度同步 + 防抖 + 离线队列）
│   │   ├── challenge-cloud.js # ChallengeCloud（挑战短码 API）
│   │   └── network-indicator.js # NetworkIndicator（在线状态 UI）
│   ├── ui/                 # UI 控制模块
│   │   └── auth-ui.js      #   AuthUI（登录 modal 3 步流程 + 游戏回调注入）
│   └── game/
│       └── main-game.js    # 游戏主逻辑（Three.js 场景/物理/碰撞/生成/循环，5340+ 行）
├── .trae/documents/        # 开发方案文档（不参与运行）
└── backend/                # FastAPI 后端
    ├── pyproject.toml      # 依赖与项目元信息
    ├── .env.example        # 环境变量模板
    ├── alembic.ini
    ├── _libs/              # vendored 运行时依赖（无虚拟环境时使用）
    ├── alembic/            # 数据库 migration
    │   ├── env.py
    │   └── versions/
    │       ├── 0001_mysql_initial.py
    │       ├── 0002_refresh_token_jti.py   # refresh token 服务端撤销（jti）
    │       ├── 0003_email_auth.py          # 手机号 → 邮箱认证迁移
    │       └── 0004_password_hash.py       # 用户表新增 password_hash 列（可选密码）
    ├── app/
    │   ├── main.py         # FastAPI 入口（lifespan + CORS + 路由挂载）
    │   ├── config.py       # 配置加载（.env）
    │   ├── db.py           # aiomysql 连接池 + MySQLConn 兼容包装层
    │   ├── security.py     # JWT（access + refresh token 编解码）+ bcrypt 密码哈希
    │   ├── deps.py         # 依赖注入（当前用户、DB 连接）
    │   ├── limiter.py      # slowapi 速率限制
    │   ├── schemas/        # Pydantic 模型（auth/leaderboard/progress/challenge）
    │   ├── routers/        # 路由（auth/leaderboard/progress/challenge）
    │   └── services/       # 业务逻辑（anti_cheat / share_code / email_service / otp_store / avatar_service 头像处理）
    └── tests/              # pytest 集成测试
```

## 开发者

- JellyfishCloud

## 许可

本项目采用 MIT 许可协议。
