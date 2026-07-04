"""进度同步路由：拉取 / 保存。

冲突策略：
- 标量字段（cumulative_powerups, credits）：取 max(client, server)，避免回退
- 集合字段（achievements, unlocked_skins）：并集合并，已解锁内容永不被覆盖
- current_skin：若 client.updated_at >= server.updated_at 则采用客户端值
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Request, status

from app.config import settings
from app.deps import CurrentUser, DbConn
from app.limiter import limiter
from app.schemas.progress import (
    ProgressGetResponse,
    ProgressSaveRequest,
    ProgressSaveResponse,
)

router = APIRouter()


def _row_to_progress(row) -> Dict[str, Any]:
    return {
        "achievements": row["achievements"] if isinstance(row["achievements"], dict) else {},
        "cumulative_powerups": row["cumulative_powerups"],
        "credits": row["credits"],
        "unlocked_skins": row["unlocked_skins"] if isinstance(row["unlocked_skins"], list) else [],
        "current_skin": row["current_skin"],
        "updated_at": row["updated_at"],
    }


def _merge_achievements(client: Dict[str, bool], server: Dict[str, bool]) -> Dict[str, bool]:
    """并集：任一端为 True 即保留 True。"""
    merged = dict(server)
    for k, v in client.items():
        if v or merged.get(k):
            merged[k] = True
    return merged


def _merge_skins(client: List[str], server: List[str]) -> List[str]:
    """并集去重，保留顺序（server 在前，client 新增在后）。"""
    seen = set(server)
    merged = list(server)
    for s in client:
        if s not in seen:
            merged.append(s)
            seen.add(s)
    return merged


@router.get("/get", response_model=ProgressGetResponse)
async def get_progress(current_user: CurrentUser, conn: DbConn):
    """拉取云端进度。若用户无进度行（理论上注册时已创建），返回默认值。"""
    row = await conn.fetchrow(
        """
        SELECT achievements, cumulative_powerups, credits, unlocked_skins,
               current_skin, updated_at
        FROM player_progress
        WHERE user_id = %s
        """,
        current_user["id"],
    )
    if row is None:
        # 兜底：注册时应已创建，但若缺失则补建（updated_at 占位为 epoch）
        await conn.execute(
            """
            INSERT INTO player_progress (user_id, achievements, unlocked_skins, updated_at)
            VALUES (%s, '{}', '[]', '1970-01-01 00:00:00')
            ON DUPLICATE KEY UPDATE user_id = user_id
            """,
            current_user["id"],
        )
        now = datetime.now(timezone.utc)
        return ProgressGetResponse(updated_at=now)

    p = _row_to_progress(row)
    return ProgressGetResponse(**p)


@router.put("/save", response_model=ProgressSaveResponse)
@limiter.limit(settings.RATE_LIMIT_PROGRESS_SAVE)
async def save_progress(
    request: Request,
    payload: ProgressSaveRequest,
    current_user: CurrentUser,
    conn: DbConn,
):
    """保存进度。服务端合并后返回最新结果。"""
    row = await conn.fetchrow(
        """
        SELECT achievements, cumulative_powerups, credits, unlocked_skins,
               current_skin, updated_at
        FROM player_progress
        WHERE user_id = %s
        """,
        current_user["id"],
    )

    merged = False
    # 统一将客户端时间戳转为 UTC naive，用于存储与比较（MySQL DATETIME 无时区）
    client_ts = payload.updated_at
    if client_ts.tzinfo is not None:
        client_ts = client_ts.astimezone(timezone.utc).replace(tzinfo=None)

    if row is None:
        # 直接写入客户端值
        merged_ach = payload.achievements
        merged_pups = payload.cumulative_powerups
        merged_credits = payload.credits
        merged_skins = payload.unlocked_skins
        merged_skin = payload.current_skin
        merged_ts = client_ts
        await conn.execute(
            """
            INSERT INTO player_progress
                (user_id, achievements, cumulative_powerups, credits,
                 unlocked_skins, current_skin, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                achievements = VALUES(achievements),
                cumulative_powerups = VALUES(cumulative_powerups),
                credits = VALUES(credits),
                unlocked_skins = VALUES(unlocked_skins),
                current_skin = VALUES(current_skin),
                updated_at = VALUES(updated_at)
            """,
            current_user["id"],
            json.dumps(merged_ach),
            merged_pups,
            merged_credits,
            json.dumps(merged_skins),
            merged_skin,
            merged_ts,
        )
    else:
        server = _row_to_progress(row)
        merged_ach = _merge_achievements(payload.achievements, server["achievements"])
        merged_pups = max(payload.cumulative_powerups, server["cumulative_powerups"])
        merged_credits = max(payload.credits, server["credits"])
        merged_skins = _merge_skins(payload.unlocked_skins, server["unlocked_skins"])
        # current_skin：若客户端时间戳更新则采用客户端值
        # 统一转 UTC naive 再比较，避免 tz-aware vs tz-naive 崩溃
        server_ts = server["updated_at"]
        if server_ts.tzinfo is not None:
            server_ts = server_ts.astimezone(timezone.utc).replace(tzinfo=None)
        client_newer = client_ts >= server_ts
        merged_skin = payload.current_skin if client_newer else server["current_skin"]
        # 合并后的 updated_at 取客户端与服务端的较大值
        merged_ts = max(client_ts, server_ts)

        merged = (
            merged_ach != server["achievements"]
            or merged_pups != server["cumulative_powerups"]
            or merged_credits != server["credits"]
            or merged_skins != server["unlocked_skins"]
            or merged_skin != server["current_skin"]
        )

        if merged:
            await conn.execute(
                """
                UPDATE player_progress SET
                    achievements = %s,
                    cumulative_powerups = %s,
                    credits = %s,
                    unlocked_skins = %s,
                    current_skin = %s,
                    updated_at = %s
                WHERE user_id = %s
                """,
                json.dumps(merged_ach),
                merged_pups,
                merged_credits,
                json.dumps(merged_skins),
                merged_skin,
                merged_ts,
                current_user["id"],
            )

    # 读取回写后的最新行
    new_row = await conn.fetchrow(
        """
        SELECT achievements, cumulative_powerups, credits, unlocked_skins,
               current_skin, updated_at
        FROM player_progress
        WHERE user_id = %s
        """,
        current_user["id"],
    )
    p = _row_to_progress(new_row)
    return ProgressSaveResponse(
        **p,
        synced_at=datetime.now(timezone.utc),
        merged=merged,
    )
