"""排行榜 Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ScoreSubmit(BaseModel):
    """分数提交请求体。"""
    score: int = Field(..., ge=0, lt=1_000_000)
    combo: int = Field(..., ge=0, le=100)
    difficulty: str = Field(..., pattern=r"^(easy|normal|hard)$")
    distance: float = Field(..., ge=0, le=100_000)
    zone_reached: int = Field(..., ge=0, le=10)
    is_challenge: bool = False
    seed: Optional[int] = None
    duration_sec: Optional[int] = Field(None, ge=1, le=3600)


class ScoreSubmitResponse(BaseModel):
    rank: int
    is_personal_best: bool
    total_in_difficulty: int


class LeaderboardEntry(BaseModel):
    rank: int
    username: str
    score: int
    combo: int
    difficulty: str
    is_challenge: bool = False
    created_at: datetime


class UserScoreEntry(BaseModel):
    score: int
    combo: int
    difficulty: str
    distance: float
    is_challenge: bool = False
    created_at: datetime
