"""云存档进度 Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from pydantic import BaseModel, Field


class PlayerProgress(BaseModel):
    """玩家进度（云端存档）。"""
    achievements: Dict[str, bool] = Field(default_factory=dict)
    cumulative_powerups: int = Field(0, ge=0)
    credits: int = Field(0, ge=0)
    unlocked_skins: List[str] = Field(default_factory=list)
    current_skin: str = "classic"


class ProgressGetResponse(PlayerProgress):
    updated_at: datetime


class ProgressSaveRequest(PlayerProgress):
    """保存请求体。updated_at 为客户端本地时间戳，用于冲突检测。"""
    updated_at: datetime


class ProgressSaveResponse(PlayerProgress):
    """保存响应：返回合并后的最新进度。"""
    updated_at: datetime
    synced_at: datetime
    merged: bool = False  # 是否发生了合并（客户端进度与服务端有差异）
