"""Add password_hash column to users for optional password login.

Revision ID: 0004_password_hash
Revises: 0003_email_auth
Create Date: 2026-07-04

新增字段用于可选的邮箱+密码登录（与 OTP 共存）：
- 用户在个人中心主动设置密码后写入 bcrypt 哈希
- 未设置密码的用户该字段为 NULL，仍可使用 OTP 登录
- 密码找回通过邮箱 OTP 验证后重置，复用现有 otp_codes 基础设施
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0004_password_hash"
down_revision: Union[str, Sequence[str], None] = "0003_email_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL "
        "AFTER refresh_token_jti"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE users DROP COLUMN password_hash"
    )
