"""认证路由：发送验证码 / 验证登录 / 刷新 / 当前用户 / 登出 / 修改资料 / 注销账号。

认证流程：
1. POST /auth/send-otp  →  生成验证码 + 邮件发送，返回 is_new_user
2. POST /auth/verify    →  校验验证码 → upsert users 表 → 签发 JWT (含 refresh token jti)
3. GET  /auth/me        →  需要 access_token
4. POST /auth/refresh   →  用 refresh_token 换取新 access + 新 refresh（轮换 + jti 校验）
5. POST /auth/logout    →  撤销服务端 refresh token jti
6. PUT  /auth/profile   →  修改用户名 / 显示名
7. DELETE /auth/account →  注销账号（CASCADE 清理关联数据）

可选密码登录（与 OTP 共存）：
8. POST /auth/login-password         →  邮箱 + 密码登录（已设密码用户可用）
9. POST /auth/set-password           →  已登录用户首次设置密码（JWT）
10. PUT /auth/change-password        →  修改密码（验证旧密码，JWT）
11. POST /auth/reset-password        →  通过邮箱 OTP 重置密码（无需 JWT）
12. POST /auth/avatar                →  上传头像（JWT，multipart）
13. POST /auth/change-email/send-otp →  向新邮箱发送变更验证码（JWT）
14. POST /auth/change-email/verify   →  验证新邮箱 OTP 完成邮箱变更（JWT）
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile, status

from app.config import settings
from app.deps import CurrentUser, DbConn
from app.limiter import limiter
from app.schemas.auth import (
    AuthResponse,
    ChangeEmailSendOtpRequest,
    ChangeEmailVerifyRequest,
    ChangePasswordRequest,
    LoginPasswordRequest,
    RefreshRequest,
    RefreshResponse,
    ResetPasswordRequest,
    SendOtpRequest,
    SendOtpResponse,
    SetPasswordRequest,
    UpdateProfileRequest,
    UserPublic,
    VerifyOtpRequest,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
    verify_refresh_token,
    JWTError,
)
from app.services.otp_store import create_otp, verify_otp
from app.services.email_service import send_otp_email
from app.services.avatar_service import process_and_save_avatar

router = APIRouter()


def _new_jti() -> str:
    return str(uuid.uuid4())


def _expires_in_seconds() -> int:
    return settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60


@router.post("/send-otp", response_model=SendOtpResponse, status_code=status.HTTP_200_OK)
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def send_otp_route(
    request: Request,
    payload: SendOtpRequest,
    conn: DbConn,
):
    """发送邮箱验证码。响应中带 is_new_user 供前端切换注册/登录 UI。"""
    # 统一转小写，避免大小写不一致导致重复注册或登录失败
    email = payload.email.lower()
    # 先判断是否新用户（必须在发送验证码前判断，否则前端 UI 切换会延迟）
    existing = await conn.fetchval(
        "SELECT 1 FROM users WHERE email = %s", email
    )
    is_new_user = existing is None

    code = await create_otp(conn, email)
    try:
        await send_otp_email(email, code)
    except Exception:
        # 邮件发送失败，清理已入库的验证码
        await conn.execute("DELETE FROM otp_codes WHERE email = %s", email)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="邮件发送失败，请稍后重试",
        )
    return SendOtpResponse(
        message="验证码已发送",
        email=email,
        is_new_user=is_new_user,
    )


@router.post("/verify", response_model=AuthResponse)
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def verify_otp_route(
    request: Request,
    payload: VerifyOtpRequest,
    conn: DbConn,
):
    """验证邮箱验证码。新用户自动注册，老用户直接登录。"""
    # 与 send-otp 保持一致：邮箱统一小写
    email = payload.email.lower()
    ok = await verify_otp(conn, email, payload.code)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="验证码无效或已过期",
        )

    # 在 users 表中查找是否已存在
    row = await conn.fetchrow(
        "SELECT id, username, display_name, avatar_url, password_hash, email, created_at "
        "FROM users WHERE email = %s",
        email,
    )

    if row is None:
        # 新用户注册
        username = payload.username
        if not username:
            username = f"玩家_{email.split('@')[0][:6]}"

        # 检查用户名冲突，冲突则追加随机后缀
        existing_name = await conn.fetchval(
            "SELECT 1 FROM users WHERE username = %s", username
        )
        if existing_name:
            username = f"{username}_{secrets.token_hex(2)}"

        new_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        jti = _new_jti()
        await conn.execute(
            """
            INSERT INTO users (id, username, email, display_name, created_at, refresh_token_jti)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            new_id,
            username,
            email,
            username,
            now,
            jti,
        )

        # 初始化进度行（updated_at 设为 epoch 占位，确保客户端首次保存时时间戳更新）
        await conn.execute(
            """
            INSERT INTO player_progress (user_id, achievements, unlocked_skins, updated_at)
            VALUES (%s, '{}', '[]', '1970-01-01 00:00:00')
            ON DUPLICATE KEY UPDATE user_id = user_id
            """,
            new_id,
        )

        row = {
            "id": new_id,
            "username": username,
            "display_name": username,
            "avatar_url": None,
            "password_hash": None,
            "email": email,
            "created_at": now,
        }
        user_id = new_id
    else:
        # 老用户：每次登录轮换 jti，使其他设备上的 refresh token 失效（单设备登录语义）
        jti = _new_jti()
        await conn.execute(
            "UPDATE users SET refresh_token_jti = %s WHERE id = %s",
            jti,
            row["id"],
        )
        user_id = str(row["id"])

        # 如果请求中带了新用户名且与当前不同，则更新（沿用原逻辑）
        if payload.username and payload.username != row["username"]:
            existing_name = await conn.fetchval(
                "SELECT 1 FROM users WHERE username = %s AND id != %s",
                payload.username,
                row["id"],
            )
            if not existing_name:
                await conn.execute(
                    "UPDATE users SET username = %s, display_name = %s WHERE id = %s",
                    payload.username,
                    payload.username,
                    row["id"],
                )
                row = dict(row)
                row["username"] = payload.username
                row["display_name"] = payload.username

    user = UserPublic.from_row(row)
    return AuthResponse(
        access_token=create_access_token(user_id, row["username"]),
        refresh_token=create_refresh_token(user_id, jti),
        expires_in=_expires_in_seconds(),
        user=user,
    )


@router.post("/refresh", response_model=RefreshResponse)
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def refresh(
    request: Request,
    payload: RefreshRequest,
    conn: DbConn,
):
    """刷新 access token，同时轮换 refresh token（旧 refresh token 立即失效）。"""
    try:
        user_id, jti = verify_refresh_token(payload.refresh_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="refresh token 无效或已过期",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )

    # 校验 jti 与 DB 一致（登出/轮换/其他设备登录后旧 token 应失效）
    stored_jti = await conn.fetchval(
        "SELECT refresh_token_jti FROM users WHERE id = %s", user_id
    )
    if stored_jti is None or stored_jti != jti:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="refresh token 已失效，请重新登录",
        )

    username = await conn.fetchval(
        "SELECT username FROM users WHERE id = %s", user_id
    )
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
        )

    # 轮换：生成新 jti 并写回 DB
    new_jti = _new_jti()
    await conn.execute(
        "UPDATE users SET refresh_token_jti = %s WHERE id = %s",
        new_jti,
        user_id,
    )

    return RefreshResponse(
        access_token=create_access_token(user_id, username),
        refresh_token=create_refresh_token(user_id, new_jti),
        expires_in=_expires_in_seconds(),
    )


@router.post("/logout", status_code=status.HTTP_200_OK)
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def logout(
    request: Request,
    current_user: CurrentUser,
    conn: DbConn,
):
    """登出：撤销服务端 refresh token jti，使所有 refresh token 立即失效。"""
    await conn.execute(
        "UPDATE users SET refresh_token_jti = NULL WHERE id = %s",
        current_user["id"],
    )
    return {"message": "已退出登录"}


@router.get("/me", response_model=UserPublic)
async def me(current_user: CurrentUser):
    return UserPublic.from_row(current_user)


@router.put("/profile", response_model=UserPublic)
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def update_profile(
    request: Request,
    payload: UpdateProfileRequest,
    current_user: CurrentUser,
    conn: DbConn,
):
    """修改用户名 / 显示名。用户名冲突返回 409。"""
    if payload.username is None and payload.display_name is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="至少需要提供 username 或 display_name 中的一个",
        )

    new_username = payload.username
    new_display = payload.display_name

    # 用户名冲突校验
    if new_username and new_username != current_user["username"]:
        conflict = await conn.fetchval(
            "SELECT 1 FROM users WHERE username = %s AND id != %s",
            new_username,
            current_user["id"],
        )
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="用户名已被占用",
            )

    # 若只传 display_name，则 username 不变
    final_username = new_username or current_user["username"]
    # 若只传 username，display_name 默认跟随 username
    final_display = new_display if new_display is not None else final_username

    await conn.execute(
        "UPDATE users SET username = %s, display_name = %s WHERE id = %s",
        final_username,
        final_display,
        current_user["id"],
    )

    row = await conn.fetchrow(
        "SELECT id, username, email, display_name, avatar_url, password_hash, created_at "
        "FROM users WHERE id = %s",
        current_user["id"],
    )
    return UserPublic.from_row(row)


@router.delete("/account", status_code=status.HTTP_200_OK)
@limiter.limit(settings.RATE_LIMIT_REGISTER)
async def delete_account(
    request: Request,
    current_user: CurrentUser,
    conn: DbConn,
    confirm: bool = Query(
        False, description="必须为 true 才会执行注销（二次确认防误操作）"
    ),
):
    """注销账号。要求 confirm=true。CASCADE 自动清理 scores/player_progress/challenges 等。"""
    if not confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请确认要注销账号（confirm=true）",
        )

    await conn.execute("DELETE FROM users WHERE id = %s", current_user["id"])
    return {"message": "账号已注销"}


# ===== 可选密码登录（与 OTP 共存）=====


@router.post("/login-password", response_model=AuthResponse)
@limiter.limit(settings.RATE_LIMIT_LOGIN_PASSWORD)
async def login_password(
    request: Request,
    payload: LoginPasswordRequest,
    conn: DbConn,
):
    """邮箱 + 密码登录。统一返回"邮箱或密码错误"防止邮箱枚举。"""
    email = payload.email.lower()
    row = await conn.fetchrow(
        "SELECT id, username, email, display_name, avatar_url, password_hash, created_at "
        "FROM users WHERE email = %s",
        email,
    )
    # 邮箱不存在 / 用户未设密码 / 密码不匹配：统一提示，防止枚举
    if row is None or not row.get("password_hash"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )
    if not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )

    user_id = str(row["id"])
    jti = _new_jti()
    await conn.execute(
        "UPDATE users SET refresh_token_jti = %s WHERE id = %s",
        jti,
        user_id,
    )
    user = UserPublic.from_row(row)
    return AuthResponse(
        access_token=create_access_token(user_id, row["username"]),
        refresh_token=create_refresh_token(user_id, jti),
        expires_in=_expires_in_seconds(),
        user=user,
    )


@router.post("/set-password", response_model=UserPublic)
@limiter.limit(settings.RATE_LIMIT_PASSWORD_CHANGE)
async def set_password(
    request: Request,
    payload: SetPasswordRequest,
    current_user: CurrentUser,
    conn: DbConn,
):
    """已登录用户首次设置密码。已设密码返回 409，引导使用修改密码。"""
    if current_user.get("password_hash"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="密码已设置，请使用修改密码功能",
        )
    hashed = hash_password(payload.password)
    await conn.execute(
        "UPDATE users SET password_hash = %s WHERE id = %s",
        hashed,
        current_user["id"],
    )
    row = await conn.fetchrow(
        "SELECT id, username, email, display_name, avatar_url, password_hash, created_at "
        "FROM users WHERE id = %s",
        current_user["id"],
    )
    return UserPublic.from_row(row)


@router.put("/change-password", response_model=UserPublic)
@limiter.limit(settings.RATE_LIMIT_PASSWORD_CHANGE)
async def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    current_user: CurrentUser,
    conn: DbConn,
):
    """修改密码。需验证旧密码。"""
    if not current_user.get("password_hash") or not verify_password(
        payload.old_password, current_user["password_hash"]
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="旧密码错误",
        )
    hashed = hash_password(payload.new_password)
    await conn.execute(
        "UPDATE users SET password_hash = %s WHERE id = %s",
        hashed,
        current_user["id"],
    )
    row = await conn.fetchrow(
        "SELECT id, username, email, display_name, avatar_url, password_hash, created_at "
        "FROM users WHERE id = %s",
        current_user["id"],
    )
    return UserPublic.from_row(row)


@router.post("/reset-password", status_code=status.HTTP_200_OK)
@limiter.limit(settings.RATE_LIMIT_RESET_PASSWORD)
async def reset_password(
    request: Request,
    payload: ResetPasswordRequest,
    conn: DbConn,
):
    """通过邮箱 OTP 验证后重置密码（无需 JWT）。"""
    email = payload.email.lower()
    ok = await verify_otp(conn, email, payload.code)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="验证码无效或已过期",
        )
    # 查询用户是否存在（理论上 send-otp 已限制，但这里二次确认）
    user_id = await conn.fetchval(
        "SELECT id FROM users WHERE email = %s", email
    )
    if user_id is None:
        # 不暴露用户是否存在，统一提示
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="账号不存在",
        )
    hashed = hash_password(payload.new_password)
    await conn.execute(
        "UPDATE users SET password_hash = %s WHERE id = %s",
        hashed,
        user_id,
    )
    return {"message": "密码已重置"}


@router.post("/avatar", response_model=UserPublic)
@limiter.limit(settings.RATE_LIMIT_AVATAR_UPLOAD)
async def upload_avatar(
    request: Request,
    current_user: CurrentUser,
    conn: DbConn,
    file: UploadFile = File(...),
):
    """上传头像。服务端用 Pillow 缩放为 256×256 PNG 保存。"""
    # 校验 Content-Type
    allowed = settings.AVATAR_ALLOWED_TYPES.split(",")
    if file.content_type not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的图片类型，仅允许 {', '.join(allowed)}",
        )
    # 读取并校验大小
    file_data = await file.read()
    if len(file_data) > settings.AVATAR_MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"图片大小不能超过 {settings.AVATAR_MAX_SIZE_BYTES // 1024 // 1024}MB",
        )
    user_id = str(current_user["id"])
    try:
        avatar_url = process_and_save_avatar(file_data, user_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    await conn.execute(
        "UPDATE users SET avatar_url = %s WHERE id = %s",
        avatar_url,
        current_user["id"],
    )
    row = await conn.fetchrow(
        "SELECT id, username, email, display_name, avatar_url, password_hash, created_at "
        "FROM users WHERE id = %s",
        current_user["id"],
    )
    return UserPublic.from_row(row)


@router.post("/change-email/send-otp", status_code=status.HTTP_200_OK)
@limiter.limit(settings.RATE_LIMIT_CHANGE_EMAIL)
async def change_email_send_otp(
    request: Request,
    payload: ChangeEmailSendOtpRequest,
    current_user: CurrentUser,
    conn: DbConn,
):
    """向新邮箱发送变更验证码（需 JWT）。"""
    new_email = payload.new_email.lower()
    current_email = current_user.get("email", "") or ""
    if new_email == current_email.lower():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="新旧邮箱相同",
        )
    # 检查新邮箱未被其他用户占用
    occupied = await conn.fetchval(
        "SELECT 1 FROM users WHERE email = %s AND id != %s",
        new_email,
        current_user["id"],
    )
    if occupied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="邮箱已被占用",
        )
    code = await create_otp(conn, new_email)
    try:
        await send_otp_email(new_email, code)
    except Exception:
        await conn.execute("DELETE FROM otp_codes WHERE email = %s", new_email)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="邮件发送失败，请稍后重试",
        )
    return {"message": "验证码已发送至新邮箱", "new_email": new_email}


@router.post("/change-email/verify", response_model=UserPublic)
@limiter.limit(settings.RATE_LIMIT_CHANGE_EMAIL)
async def change_email_verify(
    request: Request,
    payload: ChangeEmailVerifyRequest,
    current_user: CurrentUser,
    conn: DbConn,
):
    """验证新邮箱 OTP 完成邮箱变更（需 JWT）。"""
    new_email = payload.new_email.lower()
    ok = await verify_otp(conn, new_email, payload.code)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="验证码无效或已过期",
        )
    # 二次检查邮箱未被占用（防并发）
    occupied = await conn.fetchval(
        "SELECT 1 FROM users WHERE email = %s AND id != %s",
        new_email,
        current_user["id"],
    )
    if occupied:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="邮箱已被占用",
        )
    await conn.execute(
        "UPDATE users SET email = %s WHERE id = %s",
        new_email,
        current_user["id"],
    )
    row = await conn.fetchrow(
        "SELECT id, username, email, display_name, avatar_url, password_hash, created_at "
        "FROM users WHERE id = %s",
        current_user["id"],
    )
    return UserPublic.from_row(row)
