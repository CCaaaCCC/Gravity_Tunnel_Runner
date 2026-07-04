"""防作弊校验：基于客户端提交的字段做合理性检查。

不做种子重放验证（成本远高于收益），仅做粗略上界校验。
失败时由调用方决定如何处理（通常返回 422）。
"""
from __future__ import annotations

from app.schemas.leaderboard import ScoreSubmit

# 难度系数：来自游戏 getCompositeScore() 的 diffBonus
DIFF_BONUS = {"easy": 1.0, "normal": 1.2, "hard": 1.5}

# 最大连击倍率（comboMult = min(3.0, 1.0 + combo * 0.1)）
MAX_COMBO_MULT = 3.0

# 道具分上界（粗略）：cumulative_powerups 未知，按 distance 估算
POWERUP_BONUS_PER_METER = 1.0  # 极宽松上界

# 最大可能速度（米/秒）：游戏中速度约 6~12 起步，最高约 30
MAX_SPEED_MPS = 60.0


class AntiCheatError(ValueError):
    """分数校验未通过。"""


def validate_score(payload: ScoreSubmit) -> None:
    """校验分数合理性。失败抛 AntiCheatError。

    校验项：
    1. 难度系数反推：score ≤ distance * MAX_COMBO_MULT * diffBonus + powerup_bonus
    2. 时长合理性：distance / duration_sec ≤ MAX_SPEED_MPS（duration 可空）
    3. 挑战模式必须有 seed
    """
    diff_bonus = DIFF_BONUS.get(payload.difficulty, 1.5)
    # 道具分粗略上界：distance * 1.0（极宽松）
    powerup_upper = payload.distance * POWERUP_BONUS_PER_METER
    score_upper = (
        payload.distance * MAX_COMBO_MULT * diff_bonus + powerup_upper + 100
    )
    if payload.score > score_upper:
        raise AntiCheatError("分数超出合理上界")

    if payload.duration_sec is not None and payload.duration_sec > 0:
        avg_speed = payload.distance / payload.duration_sec
        if avg_speed > MAX_SPEED_MPS:
            raise AntiCheatError("平均速度超出物理上限")

    if payload.is_challenge and payload.seed is None:
        raise AntiCheatError("挑战模式必须提供 seed")
