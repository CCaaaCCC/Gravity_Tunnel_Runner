"""挑战模式 Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ChallengeCreateRequest(BaseModel):
    """创建挑战。seed 为 mulberry32 的种子整数（游戏中 currentSeed = Date.now()）。"""
    seed: int = Field(..., ge=0, lt=2**53)
    title: Optional[str] = Field(None, max_length=50)
    difficulty_target: Optional[str] = Field(None, pattern=r"^(easy|normal|hard)$")


class ChallengeCreateResponse(BaseModel):
    challenge_id: str
    share_code: str
    challenge_url: Optional[str] = None
    seed: int
    created_at: datetime


class ChallengeDetail(BaseModel):
    challenge_id: str
    share_code: str
    seed: int
    title: Optional[str] = None
    creator_username: str
    difficulty_target: Optional[str] = None
    created_at: datetime
    participant_count: int


class ChallengeSubmitRequest(BaseModel):
    score: int = Field(..., ge=0, lt=1_000_000)
    combo: int = Field(..., ge=0, le=100)
    distance: float = Field(..., ge=0, le=100_000)
    zone_reached: int = Field(0, ge=0, le=10)
    duration_sec: Optional[int] = Field(None, ge=1, le=3600)


class ChallengeSubmitResponse(BaseModel):
    rank: int
    is_best: bool
    total_participants: int


class ChallengeLeaderboardEntry(BaseModel):
    rank: int
    username: str
    score: int
    combo: int
    distance: float
    completed_at: datetime
