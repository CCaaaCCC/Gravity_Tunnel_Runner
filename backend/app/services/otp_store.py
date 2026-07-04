"""验证码存储与校验。

存储方式：MySQL otp_codes 表（支持多实例部署）。
验证码生命周期：生成 → 存储 → 校验 → 删除。
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import MySQLConn


async def create_otp(conn: MySQLConn, email: str) -> str:
    """生成验证码并存入数据库，返回明文验证码。

    Args:
        conn: 数据库连接
        email: 邮箱
    Returns:
        6 位数字验证码
    """
    if settings.OTP_DEV_FIXED_CODE:
        code = settings.OTP_DEV_FIXED_CODE
    else:
        code = f"{secrets.randbelow(1000000):06d}"

    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.OTP_EXPIRE_MINUTES
    )

    # upsert：同邮箱只保留最新一条
    await conn.execute(
        """
        INSERT INTO otp_codes (email, code, expires_at, attempts)
        VALUES (%s, %s, %s, 0)
        ON DUPLICATE KEY UPDATE
            code = VALUES(code),
            expires_at = VALUES(expires_at),
            attempts = 0
        """,
        email,
        code,
        expires_at,
    )
    return code


async def verify_otp(conn: MySQLConn, email: str, code: str) -> bool:
    """校验验证码。成功返回 True，失败返回 False。

    校验逻辑：
    1. 查询 otp_codes 表
    2. 检查是否过期
    3. 检查尝试次数是否超限
    4. 增加尝试计数
    5. 比对验证码
    6. 成功则删除记录
    """
    row = await conn.fetchrow(
        "SELECT code, expires_at, attempts FROM otp_codes WHERE email = %s",
        email,
    )
    if row is None:
        return False

    now = datetime.now(timezone.utc)

    # 检查过期
    expires_at = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now:
        await conn.execute("DELETE FROM otp_codes WHERE email = %s", email)
        return False

    # 检查尝试次数
    if row["attempts"] >= settings.OTP_MAX_ATTEMPTS:
        await conn.execute("DELETE FROM otp_codes WHERE email = %s", email)
        return False

    # 增加尝试计数
    await conn.execute(
        "UPDATE otp_codes SET attempts = attempts + 1 WHERE email = %s",
        email,
    )

    if row["code"] != code:
        return False

    # 验证成功，删除记录
    await conn.execute("DELETE FROM otp_codes WHERE email = %s", email)
    return True
