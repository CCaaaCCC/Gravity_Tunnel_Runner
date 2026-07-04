"""Replace phone-based OTP with email-based OTP.

Revision ID: 0003_email_auth
Revises: 0002_refresh_token_jti
Create Date: 2026-07-04

认证方式从手机号+短信改为邮箱+验证码邮件：
- otp_codes 表：phone VARCHAR(20) PK → email VARCHAR(255) PK（瞬态数据，TRUNCATE 后重建）
- users 表：新增 email 列（UNIQUE NULL），保留 phone 列（向后兼容，代码不再使用）
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003_email_auth"
down_revision: Union[str, Sequence[str], None] = "0002_refresh_token_jti"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # otp_codes 是瞬态表（验证码 5 分钟过期），直接清空后重建
    op.execute("TRUNCATE TABLE otp_codes")
    op.execute(
        "ALTER TABLE otp_codes "
        "DROP PRIMARY KEY, DROP COLUMN phone, "
        "ADD COLUMN email VARCHAR(255) NOT NULL FIRST, "
        "ADD PRIMARY KEY (email)"
    )
    # users 表保留 phone 列（向后兼容），新增 email 列
    op.execute(
        "ALTER TABLE users ADD COLUMN email VARCHAR(255) UNIQUE NULL AFTER phone"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN email")
    op.execute("TRUNCATE TABLE otp_codes")
    op.execute(
        "ALTER TABLE otp_codes "
        "DROP PRIMARY KEY, DROP COLUMN email, "
        "ADD COLUMN phone VARCHAR(20) NOT NULL FIRST, "
        "ADD PRIMARY KEY (phone)"
    )
