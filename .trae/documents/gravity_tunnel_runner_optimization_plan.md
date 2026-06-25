# Gravity Tunnel Runner 优化方案

## 摘要

针对你列出的 9 个修复点，本方案按“高-中-低”优先级制定实现计划。其中：

- **合理且建议立即做**：1（对象池 O(1)）、2（碰撞空间裁剪）、3（尾迹环形缓冲）、4（难度曲线配置化）、9（即时重试）。
- **合理但属于体验增强**：5（连续碰撞检测）、7（移动端震动反馈）、8（自适应画质）。
- **第 6 点与代码现状不符**：`triggerNearMiss()` 已经会计入 combo 并加分（见 [index.html#L2542-L2565](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2542-L2565)），本方案仅做小幅增强。

所有改动集中在单个文件 `index.html`。

---

## 当前状态分析

| 关注点 | 现状 | 位置 |
|--------|------|------|
| 对象池 | `obstaclePool.find(o => !o.parent)`、`laserPool.find(...)`、`powerupPools[type].find(...)` 均为 O(n) 线性扫描；对象被“回收”时仅 `remove` + `visible=false`，没有维护空闲索引。 | [L1762-L1792](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1762-L1792) |
| 碰撞检测 | `checkCollisions()` 遍历 `segments` 中所有 `obstacles` / `powerups`；内部靠 `Math.abs(worldZ - PLAYER_Z) < threshold` 早退。但在收集道具/撞毁障碍物时，循环内用 `filter` 修改数组，存在 O(n) 二次开销与迭代不稳定风险。 | [L2567-L2703](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2567-L2703) |
| 尾迹历史 | 每帧 `for (i=len-1; i>0; i--) trailHistory[i].copy(trailHistory[i-1])`，O(n) 整体平移。 | [L3219-L3226](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L3219-L3226) |
| 难度数值 | `maxWalls`、`powerupChance`、移动障碍概率、激光概率等直接散落在 `spawnObstacles` / `spawnPowerups` 里，调整困难。 | [L1815-L1911](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1815-L1911) |
| 碰撞判定 | 仅基于当前帧瞬时位置与固定阈值（`< 1.2`、`< 0.68` 等），无连续/扫描检测，高速时可能穿模。 | [L2622-L2644](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2622-L2644) |
| 连击/Near Miss | `triggerNearMiss()` 已经增加 combo 与分数，但视觉反馈只有文字缩放，缺少连击倍率提示。 | [L2542-L2565](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2542-L2565) |
| 移动端反馈 | 触摸切墙/跳跃无任何触觉反馈。 | [L2412-L2436](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2412-L2436) |
| 性能自适应 | 无 FPS 监控，Bloom + 500 粒子 + shader 墙始终全量运行。 | [L1412-L1420](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1412-L1420)、[L1239](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1239) |
| 死亡重试 | 当前流程：`endGame()` → 显示 `gameOverScreen` → 点击“再来一次” → `startCountdown()` 3 秒倒计时 → 开跑。 | [L2877-L2903](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2877-L2903)、[L2933-L2935](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2933-L2935) |

---

## 优化项与实现计划

### 🔴 高优先级

#### 1. 对象池改为 O(1) 空闲栈

**文件**：`index.html`

**改动位置**：
- 声明区：[L1752-L1760](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1752-L1760)
- 取用函数：[L1762-L1792](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1762-L1792)
- 回收点：
  - `spawnObstacles` 重置段时：[L1816-L1819](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1816-L1819)
  - `spawnPowerups` 重置段时：[L1875-L1878](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1875-L1878)
  - 道具被收集时：[L2576-L2578](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2576-L2578)
  - 障碍物被无敌/护盾/普通撞毁时：[L2649-L2651](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2649-L2651)、[L2670-L2672](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2670-L2672)、[L2681-L2683](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2681-L2683)
  - `startGame` 重置已有段时：[L2854-L2857](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2854-L2857)

**实现**：
- 为 `obstacle`、`laser`、每种 `powerup` 各维护一个空闲栈（数组）。
- `getXxxFromPool()` 改为 `freeList.pop()`，为空时再 `new` 并加入总池。
- 回收时调用 `returnXxxToPool(mesh)`：从父级移除、`visible=false`，并 `freeList.push(mesh)`。
- 保持 `obstaclePool` 等总池数组用于场景重置/调试，但取用时不再扫描。

**预期收益**：对象取用从 O(n) 降到 O(1)；长距离奔跑时生成卡顿消除。

---

#### 2. 碰撞检测只遍历当前段及相邻段

**文件**：`index.html`

**改动位置**：`checkCollisions()` [L2567-L2703](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2567-L2703)

**实现**：
1. 计算玩家当前所在段索引：根据 `PLAYER_Z` 与 `SEG_LEN` 找到覆盖 `PLAYER_Z` 的 segment。
2. 只遍历该段及其前后各 1 段（共最多 3 段）。
3. 移除循环内部的 `filter` 数组重建，改为：
   - 收集需要移除的索引；
   - 循环结束后用 `splice` 或“与末尾交换”移除，避免迭代中修改数组。
4. `nearMissed` 标记逻辑保留，但只对候选段内的障碍物生效。

**预期收益**：可视距离、密度提升时，碰撞开销与段数解耦；避免迭代中数组重分配的隐藏消耗。

---

#### 3. trailHistory 改为环形缓冲区

**文件**：`index.html`

**改动位置**：
- 初始化：[L2017-L2048](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2017-L2048)
- 每帧更新：[L3219-L3238](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L3219-L3238)

**实现**：
- 新增 `trailWriteIndex = 0`。
- 写入：`trailHistory[trailWriteIndex].copy(localPos)`，然后 `trailWriteIndex = (trailWriteIndex + 1) % trailHistory.length`。
- 读取 `trailMeshes[i]` 对应历史：`history[(trailWriteIndex - 1 - i * 2 + len) % len]`。
- 保留现有 `trailMeshes` 数量与透明度渐变。

**预期收益**：每帧 O(n) 拷贝转为 O(1) 写入；尾迹越长收益越明显。

---

#### 4. 难度曲线配置化

**文件**：`index.html`

**改动位置**：
- 新增配置表：建议在 `difficultySettings` 旁 [L1631-L1650](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1631-L1650)
- 使用点：`spawnObstacles()` / `spawnPowerups()` [L1815-L1911](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1815-L1911)

**实现**：
- 新增 `DIFFICULTY_CURVE` 数组，按 `distance` 分段，每段记录：
  - `maxWalls`（或最大同时阻挡墙面数）
  - `laserChance`
  - `movingObstacleChance`
  - `powerupChance`
  - `movingSpeedRange`
- 提供 `getDifficultyAt(distance)`：根据当前 `distance` 线性插值或取当前段配置。
- `spawnObstacles` / `spawnPowerups` 中所有硬编码数值替换为 `getDifficultyAt(distance)` 读取。
- 保留 `difficultySettings[currentDifficulty]` 的乘数用于整体难度缩放。

**预期收益**：后续做无限模式、A/B 测试、区域主题难度调整只需改一张表。

---

#### 9. 死亡后“空格/点击”即时重试（跳过倒计时）

**文件**：`index.html`

**改动位置**：
- `endGame()` [L2877-L2903](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2877-L2903)
- 按钮绑定 [L2933-L2935](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2933-L2935)

**实现**：
- 新增 `restartGame()`：直接调用 `startGame()` + `startGameLoop()`，不显示倒计时 overlay。
- `restartBtn` 点击事件改为调用 `restartGame()`。
- 在 `gameOverScreen` 显示期间监听 `keydown`：Space / Enter 直接触发 `restartGame()`。
- 为移动端在 `gameOverScreen` 面板添加 `touchend` 监听（短按触发重试，避免与滚动冲突）。
- 更新 Game Over UI 文案，提示“按空格/点击重试”。

**预期收益**：死亡到再跑的时间从“点击 + 3 秒倒计时”缩短到一次按键/点击，强化街机爽感。

---

### 🟡 中优先级

#### 5. 引入基于上一帧位置的连续碰撞检测

**文件**：`index.html`

**改动位置**：`checkCollisions()` [L2622-L2644](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2622-L2644)、动画循环玩家更新 [L3126-L3135](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L3126-L3135)

**实现**：
- 每帧记录上一帧的 `prevPlayerY`、`prevPlayerLocalOffset`。
- 普通障碍物：在 local 空间做 AABB 或线段扫描检测，比较“上一帧 → 当前帧”的线段是否与障碍物包围盒相交。
- 激光：检测玩家是否在两帧之间穿过激光平面，并且高度 `playerY < 0.68` 在区间内任一时刻成立。
- 保持现有阈值作为 AABB 半长，避免手感突变；扫描检测作为补充，防止高速穿模。

**预期收益**：高速下“看上去撞上但没死”或“穿模过去才死”的情况减少。

---

#### 6. Near Miss 连击体验增强

**文件**：`index.html`

**改动位置**：`triggerNearMiss()` [L2542-L2565](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2542-L2565)

**实现**：
- 当前代码已经执行 combo++ 与 +150 分，因此不新增逻辑。
- 增强反馈：
  - Near Miss 文字颜色随 combo 层级变化（白 → 蓝 → 紫 → 金）。
  - combo ≥ 5 时额外触发一次小型粒子爆发或屏幕微震，强化“贴脸闪过”的爽感。
- 在 `showCombo()` 附近为连击显示增加“Perfect Dodge”或“擦边！”前缀提示。

**预期收益**：让擦边行为在视觉和节奏上更有分量。

---

### 🟢 锦上添花

#### 7. 移动端震动反馈

**文件**：`index.html`

**改动位置**：`setGravity()` [L2360-L2385](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2360-L2385)、`jump()` [L2220-L2235](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2220-L2235)

**实现**：
- 在 `setGravity()` 成功切换墙壁后调用：
  ```js
  if (navigator.vibrate) navigator.vibrate(15);
  ```
- 在 `jump()` 成功后调用：
  ```js
  if (navigator.vibrate) navigator.vibrate([20, 10, 20]);
  ```
- 碰撞/护盾破坏可各加一次短震（20ms）。

**预期收益**：零成本提升移动端操作确认感。

---

#### 8. 性能自适应：优先降级 Bloom

**文件**：`index.html`

**改动位置**：
- Bloom 配置 [L1416-L1420](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L1416-L1420)
- 动画循环 [L2953-L2955](file:///c:/Users/xiezh/Desktop/Gravity_Tunnel_Runner/index.html#L2953-L2955)

**实现**：
- 在 `animate()` 中维护 `fpsHistory` 环形缓冲区，基于 `dt = clock.getDelta()` 计算瞬时 FPS。
- 每 2 秒计算一次平均 FPS。
- 降级阶梯（只降不升，避免画质抖动；或设置恢复阈值）：
  1. 平均 FPS < 45 持续 2 秒：降低 `bloomPass.strength` 到 0.35。
  2. 平均 FPS < 35 持续 2 秒：`composer.removePass(bloomPass)` 并改用 `renderer.render(scene, camera)`。
  3. 可选第二阶梯：降低 `particleSystem.maxParticles` 到 250（因你选择的降级策略优先 Bloom，粒子调整作为保留选项）。
- 在设置面板或 HUD 角落显示降级状态（可选）。

**预期收益**：低端移动设备帧率更稳，高端设备仍保留完整特效。

---

## 假设与决策

1. **即时重试跳过 3 秒倒计时**：按你的选择，重试直接调用 `startGame()` + `startGameLoop()`，不再显示 `countdownOverlay`。
2. **性能自适应优先降级 Bloom**：按你的选择，第一阶梯降低 Bloom 强度，第二阶梯完全关闭 Bloom；粒子数量暂不动，除非需要第三阶梯。
3. **连续碰撞检测为补充而非替换**：保留现有阈值判定，扫描检测仅用于解决高速穿模，避免手感剧变。
4. **难度曲线按距离分段**：与现有区域系统（每 500 米换区）保持一致，便于按区域调参。
5. **对象池总池数组保留**：用于兼容场景重置与调试，实际取用走空闲栈。

---

## 验证步骤

1. **对象池**：在 Chrome DevTools Performance 中录制 2000 米后的运行片段，确认 `getObstacleFromPool` / `getLaserFromPool` 不再出现在长任务中。
2. **碰撞裁剪**：手动打印 `checkCollisions` 每帧检查的障碍物数量，确认只检查 1~3 个 segment 的内容。
3. **尾迹环形缓冲**：确认 `trailMeshes` 正常跟随玩家，无抖动或断裂。
4. **难度曲线**：分别在 0m、500m、1500m 处暂停，检查生成的 `maxWalls`、`laserChance` 等符合配置表。
5. **连续碰撞**：在 `speed > 25` 时贴近障碍物边缘穿过，观察是否仍穿模。
6. **即时重试**：死亡后按空格/点击，确认 1 秒内进入可操控状态。
7. **自适应画质**：用 Chrome 6x CPU 降速模拟低端设备，观察 Bloom 强度是否自动降低/关闭，帧率是否回升。
8. **移动端震动**：在真机或 Chrome DevTools 传感器模拟中触发切墙/跳跃，确认 `navigator.vibrate` 调用成功。
