"""挑战模式路由：创建 / 详情 / 提交成绩 / 排行榜。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.config import settings
from app.deps import CurrentUser, DbConn
from app.limiter import limiter
from app.schemas.challenge import (
    ChallengeCreateRequest,
    ChallengeCreateResponse,
    ChallengeDetail,
    ChallengeLeaderboardEntry,
    ChallengeSubmitRequest,
    ChallengeSubmitResponse,
)
from app.services.anti_cheat import AntiCheatError, validate_score
from app.services.share_code import generate_unique_code, normalize_code

router = APIRouter()


@router.post("/create", response_model=ChallengeCreateResponse)
@limiter.limit(settings.RATE_LIMIT_CHALLENGE_CREATE)
async def create_challenge(
    request: Request,
    payload: ChallengeCreateRequest,
    current_user: CurrentUser,
    conn: DbConn,
):
    """创建挑战，生成 6 位短码。"""
    async def _is_used(code: str) -> bool:
        return bool(await conn.fetchval(
            "SELECT 1 FROM challenges WHERE share_code = %s", code
        ))

    share_code = await generate_unique_code(_is_used)

    challenge_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await conn.execute(
        """
        INSERT INTO challenges (id, creator_id, seed, share_code, title, difficulty_target, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        challenge_id,
        current_user["id"],
        payload.seed,
        share_code,
        payload.title,
        payload.difficulty_target,
        now,
    )
    return ChallengeCreateResponse(
        challenge_id=challenge_id,
        share_code=share_code,
        seed=payload.seed,
        created_at=now,
    )


@router.get("/{code}", response_model=ChallengeDetail)
async def get_challenge(code: str, conn: DbConn):
    """获取挑战详情。code 不区分大小写。"""
    share_code = normalize_code(code)
    row = await conn.fetchrow(
        """
        SELECT c.id, c.share_code, c.seed, c.title, c.difficulty_target,
               c.created_at, u.username AS creator_username,
               (SELECT COUNT(*) FROM challenge_participations cp
                WHERE cp.challenge_id = c.id) AS participant_count
        FROM challenges c
        JOIN users u ON u.id = c.creator_id
        WHERE c.share_code = %s
        """,
        share_code,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="挑战不存在或已过期",
        )
    return ChallengeDetail(
        challenge_id=str(row["id"]),
        share_code=row["share_code"],
        seed=row["seed"],
        title=row["title"],
        creator_username=row["creator_username"],
        difficulty_target=row["difficulty_target"],
        created_at=row["created_at"],
        participant_count=row["participant_count"],
    )


@router.post("/{code}/submit", response_model=ChallengeSubmitResponse)
@limiter.limit(settings.RATE_LIMIT_SUBMIT_SCORE)
async def submit_challenge_score(
    request: Request,
    code: str,
    payload: ChallengeSubmitRequest,
    current_user: CurrentUser,
    conn: DbConn,
):
    """提交挑战成绩。每用户每挑战仅保留最佳记录（UPSERT）。"""
    share_code = normalize_code(code)
    challenge = await conn.fetchrow(
        "SELECT id, difficulty_target, seed FROM challenges WHERE share_code = %s",
        share_code,
    )
    if challenge is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="挑战不存在或已过期",
        )

    # 简单防作弊：用挑战本身的难度与种子做反推（避免硬编码绕过真实校验）
    try:
        from app.schemas.leaderboard import ScoreSubmit
        validate_score(ScoreSubmit(
            score=payload.score,
            combo=payload.combo,
            difficulty=challenge["difficulty_target"] or "normal",
            distance=payload.distance,
            zone_reached=payload.zone_reached,
            is_challenge=True,
            seed=challenge["seed"],
            duration_sec=payload.duration_sec,
        ))
    except AntiCheatError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="分数校验未通过",
        )

    # 查询当前最佳记录
    existing = await conn.fetchrow(
        """
        SELECT score FROM challenge_participations
        WHERE challenge_id = %s AND user_id = %s
        """,
        challenge["id"],
        current_user["id"],
    )

    is_best = existing is None or payload.score > existing["score"]

    if existing is None:
        participation_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        await conn.execute(
            """
            INSERT INTO challenge_participations
                (id, challenge_id, user_id, score, combo, distance, duration_sec, completed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            participation_id,
            challenge["id"],
            current_user["id"],
            payload.score,
            payload.combo,
            payload.distance,
            payload.duration_sec,
            now,
        )
    elif is_best:
        await conn.execute(
            """
            UPDATE challenge_participations SET
                score = %s, combo = %s, distance = %s, duration_sec = %s,
                completed_at = NOW()
            WHERE challenge_id = %s AND user_id = %s
            """,
            payload.score,
            payload.combo,
            payload.distance,
            payload.duration_sec,
            challenge["id"],
            current_user["id"],
        )

    # 计算排名
    rank = await conn.fetchval(
        """
        SELECT COUNT(*) + 1 FROM challenge_participations
        WHERE challenge_id = %s AND score > %s
        """,
        challenge["id"],
        payload.score if is_best else existing["score"],
    )
    total = await conn.fetchval(
        "SELECT COUNT(*) FROM challenge_participations WHERE challenge_id = %s",
        challenge["id"],
    )

    return ChallengeSubmitResponse(
        rank=rank,
        is_best=is_best,
        total_participants=total,
    )


@router.get("/{code}/leaderboard", response_model=List[ChallengeLeaderboardEntry])
async def challenge_leaderboard(
    code: str,
    conn: DbConn,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """获取挑战排行榜。"""
    share_code = normalize_code(code)
    rows = await conn.fetch(
        """
        SELECT cp.score, cp.combo, cp.distance, cp.completed_at, u.username
        FROM challenge_participations cp
        JOIN users u ON u.id = cp.user_id
        JOIN challenges c ON c.id = cp.challenge_id
        WHERE c.share_code = %s
        ORDER BY cp.score DESC, cp.completed_at ASC
        LIMIT %s OFFSET %s
        """,
        share_code,
        limit,
        offset,
    )
    return [
        ChallengeLeaderboardEntry(
            rank=offset + i + 1,
            username=r["username"],
            score=r["score"],
            combo=r["combo"],
            distance=r["distance"],
            completed_at=r["completed_at"],
        )
        for i, r in enumerate(rows)
    ]
