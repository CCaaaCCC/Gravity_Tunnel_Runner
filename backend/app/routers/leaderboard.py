"""排行榜路由：提交分数 / 全球 Top / 用户历史。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.config import settings
from app.deps import CurrentUser, DbConn
from app.limiter import limiter
from app.schemas.leaderboard import (
    LeaderboardEntry,
    ScoreSubmit,
    ScoreSubmitResponse,
    UserScoreEntry,
)
from app.services.anti_cheat import AntiCheatError, validate_score

router = APIRouter()


@router.post("/submit", response_model=ScoreSubmitResponse)
@limiter.limit(settings.RATE_LIMIT_SUBMIT_SCORE)
async def submit_score(
    request: Request,
    payload: ScoreSubmit,
    current_user: CurrentUser,
    conn: DbConn,
):
    """提交分数。需 JWT。校验合理性后写入 scores 表。"""
    try:
        validate_score(payload)
    except AntiCheatError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="分数校验未通过",
        )

    score_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await conn.execute(
        """
        INSERT INTO scores
            (id, user_id, score, combo, difficulty, distance, zone_reached,
             is_challenge, seed, duration_sec, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        score_id,
        current_user["id"],
        payload.score,
        payload.combo,
        payload.difficulty,
        payload.distance,
        payload.zone_reached,
        payload.is_challenge,
        payload.seed,
        payload.duration_sec,
        now,
    )

    # 计算该难度下的排名 + 是否个人最佳
    rank = await conn.fetchval(
        """
        SELECT COUNT(*) + 1 FROM scores
        WHERE difficulty = %s AND is_challenge = %s AND score > %s
        """,
        payload.difficulty,
        payload.is_challenge,
        payload.score,
    )

    personal_best = await conn.fetchval(
        """
        SELECT COUNT(*) = 0 FROM scores
        WHERE user_id = %s AND difficulty = %s AND is_challenge = %s AND score > %s
        """,
        current_user["id"],
        payload.difficulty,
        payload.is_challenge,
        payload.score,
    )

    total_in_diff = await conn.fetchval(
        "SELECT COUNT(*) FROM scores WHERE difficulty = %s AND is_challenge = %s",
        payload.difficulty,
        payload.is_challenge,
    )

    return ScoreSubmitResponse(
        rank=rank,
        is_personal_best=bool(personal_best),
        total_in_difficulty=total_in_diff,
    )


@router.get("/top", response_model=List[LeaderboardEntry])
async def top_leaderboard(
    conn: DbConn,
    difficulty: Optional[str] = Query(None, pattern=r"^(easy|normal|hard)$"),
    is_challenge: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """全球 Top 排行榜。可选按难度 / 挑战模式筛选。"""
    conditions = []
    params: list = []
    if difficulty is not None:
        conditions.append("s.difficulty = %s")
        params.append(difficulty)
    if is_challenge is not None:
        conditions.append("s.is_challenge = %s")
        params.append(is_challenge)

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.extend([limit, offset])

    rows = await conn.fetch(
        f"""
        SELECT s.score, s.combo, s.difficulty, s.is_challenge, s.created_at,
               u.username
        FROM scores s
        JOIN users u ON u.id = s.user_id
        {where_clause}
        ORDER BY s.score DESC, s.created_at ASC
        LIMIT %s OFFSET %s
        """,
        *params,
    )
    return [
        LeaderboardEntry(
            rank=offset + i + 1,
            username=r["username"],
            score=r["score"],
            combo=r["combo"],
            difficulty=r["difficulty"],
            is_challenge=r["is_challenge"],
            created_at=r["created_at"],
        )
        for i, r in enumerate(rows)
    ]


@router.get("/user/{user_id}", response_model=List[UserScoreEntry])
async def user_scores(
    user_id: uuid.UUID,
    current_user: CurrentUser,
    conn: DbConn,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """获取指定用户的历史分数记录。需登录鉴权，防止匿名爬取。"""
    rows = await conn.fetch(
        """
        SELECT score, combo, difficulty, distance, is_challenge, created_at
        FROM scores
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
        """,
        str(user_id),
        limit,
        offset,
    )
    return [
        UserScoreEntry(
            score=r["score"],
            combo=r["combo"],
            difficulty=r["difficulty"],
            distance=r["distance"],
            is_challenge=r["is_challenge"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
