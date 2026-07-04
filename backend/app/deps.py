"""FastAPI 依赖注入。

- get_db_conn：从连接池获取一个连接（请求级）
- get_current_user：从 Authorization 头解析 JWT，返回 users 表行
"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status
from typing_extensions import Annotated

from app.db import MySQLConn, get_pool
from app.security import JWTError, verify_access_token


async def get_db_conn() -> MySQLConn:
    pool = get_pool()
    async with pool.acquire() as raw_conn:
        yield MySQLConn(raw_conn)


DbConn = Annotated[MySQLConn, Depends(get_db_conn)]


async def get_current_user(
    conn: DbConn,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    """从 Bearer token 解析当前用户。未授权抛 401。"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少认证信息",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    try:
        user_id = verify_access_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token 无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )

    row = await conn.fetchrow(
        "SELECT id, username, email, display_name, avatar_url, password_hash, created_at "
        "FROM users WHERE id = %s",
        user_id,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return row


CurrentUser = Annotated[dict, Depends(get_current_user)]
