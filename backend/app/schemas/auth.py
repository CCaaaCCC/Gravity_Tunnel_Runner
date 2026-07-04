"""认证相关 Pydantic 模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class SendOtpRequest(BaseModel):
    """发送邮箱验证码。"""
    email: EmailStr = Field(
        ...,
        description="邮箱地址，如 player@example.com",
    )


class SendOtpResponse(BaseModel):
    """发送验证码响应。"""
    message: str
    email: str
    is_new_user: bool = Field(
        ..., description="该邮箱是否为新用户（前端据此切换注册/登录 UI）"
    )


class VerifyOtpRequest(BaseModel):
    """验证邮箱验证码并登录/注册。"""
    email: EmailStr = Field(
        ...,
        description="邮箱地址",
    )
    code: str = Field(
        ...,
        min_length=6,
        max_length=6,
        pattern=r"^\d{6}$",
        description="6 位数字验证码",
    )
    username: Optional[str] = Field(
        None,
        min_length=3,
        max_length=20,
        pattern=r"^[A-Za-z0-9_\u4e00-\u9fa5]+$",
        description="用户名（首次注册时设置，已注册用户可省略）",
    )


class RefreshRequest(BaseModel):
    refresh_token: str


class UpdateProfileRequest(BaseModel):
    """修改用户资料。"""
    username: Optional[str] = Field(
        None,
        min_length=3,
        max_length=20,
        pattern=r"^[A-Za-z0-9_\u4e00-\u9fa5]+$",
        description="新用户名（唯一，冲突返回 409）",
    )
    display_name: Optional[str] = Field(
        None,
        max_length=50,
        description="显示名（不唯一）",
    )


class LoginPasswordRequest(BaseModel):
    """邮箱 + 密码登录（与 OTP 共存的可选登录方式）。"""
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=64)


class SetPasswordRequest(BaseModel):
    """已登录用户首次设置密码（之前未设密码时可用）。"""
    password: str = Field(..., min_length=8, max_length=64)


class ChangePasswordRequest(BaseModel):
    """已设密码用户修改密码（需验证旧密码）。"""
    old_password: str = Field(..., min_length=8, max_length=64)
    new_password: str = Field(..., min_length=8, max_length=64)


class ResetPasswordRequest(BaseModel):
    """忘记密码时通过邮箱 OTP 验证后重置（无需 JWT）。"""
    email: EmailStr
    code: str = Field(
        ...,
        min_length=6,
        max_length=6,
        pattern=r"^\d{6}$",
        description="6 位数字验证码",
    )
    new_password: str = Field(..., min_length=8, max_length=64)


class ChangeEmailSendOtpRequest(BaseModel):
    """向新邮箱发送变更验证码（需 JWT）。"""
    new_email: EmailStr


class ChangeEmailVerifyRequest(BaseModel):
    """验证新邮箱 OTP 并完成邮箱变更（需 JWT）。"""
    new_email: EmailStr
    code: str = Field(
        ...,
        min_length=6,
        max_length=6,
        pattern=r"^\d{6}$",
        description="6 位数字验证码",
    )


class UserPublic(BaseModel):
    id: UUID
    username: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    has_password: bool = False
    created_at: Optional[datetime] = None

    @classmethod
    def from_row(cls, row) -> "UserPublic":
        return cls(
            id=row["id"],
            username=row["username"],
            email=row.get("email"),
            display_name=row.get("display_name") or row["username"],
            avatar_url=row.get("avatar_url"),
            has_password=bool(row.get("password_hash")),
            created_at=row.get("created_at"),
        )


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(..., description="access token 有效期（秒）")
    user: UserPublic


class RefreshResponse(BaseModel):
    access_token: str
    refresh_token: str = Field(..., description="轮换后的新 refresh token")
    token_type: str = "bearer"
    expires_in: int = Field(..., description="access token 有效期（秒）")
