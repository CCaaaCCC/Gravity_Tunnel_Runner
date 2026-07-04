"""JWT 编解码 + 密码哈希。

- JWT：python-jose，HS256
- 两类 token：access（短期，用于 API 调用）、refresh（长期，仅用于换取新 access）
- 密码哈希：bcrypt（可选密码登录，与 OTP 共存）
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.config import settings

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"


def _create_token(
    subject: str,
    token_type: str,
    expires_delta: timedelta,
    extra: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id: str, username: str) -> str:
    return _create_token(
        user_id,
        TOKEN_TYPE_ACCESS,
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        extra={"username": username},
    )


def create_refresh_token(user_id: str, jti: str) -> str:
    """签发 refresh token，绑定 jti（服务端撤销用）。"""
    return _create_token(
        user_id,
        TOKEN_TYPE_REFRESH,
        timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        extra={"jti": jti},
    )


def decode_token(token: str) -> dict[str, Any]:
    """解码并校验签名 + 过期时间。失败抛 JWTError。"""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


def verify_access_token(token: str) -> str:
    """仅校验 access token，返回 user_id。失败抛 JWTError 或 ValueError。"""
    payload = decode_token(token)
    if payload.get("type") != TOKEN_TYPE_ACCESS:
        raise ValueError("not an access token")
    user_id = payload.get("sub")
    if not user_id:
        raise ValueError("missing subject")
    return user_id


def verify_refresh_token(token: str) -> tuple[str, str]:
    """校验 refresh token，返回 (user_id, jti)。

    调用方需自行比对 DB 中的 refresh_token_jti 字段以完成撤销校验。
    """
    payload = decode_token(token)
    if payload.get("type") != TOKEN_TYPE_REFRESH:
        raise ValueError("not a refresh token")
    user_id = payload.get("sub")
    jti = payload.get("jti")
    if not user_id:
        raise ValueError("missing subject")
    if not jti:
        raise ValueError("missing jti")
    return user_id, jti


def hash_password(password: str) -> str:
    """使用 bcrypt 哈希密码，返回字符串形式哈希（含盐）。"""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str | None) -> bool:
    """校验密码与 bcrypt 哈希是否匹配。空哈希直接返回 False。"""
    if not hashed:
        return False
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


__all__ = [
    "JWTError",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "verify_access_token",
    "verify_refresh_token",
    "hash_password",
    "verify_password",
]
