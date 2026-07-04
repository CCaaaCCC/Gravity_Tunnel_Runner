"""Add refresh_token_jti column to users for server-side token revocation.

Revision ID: 0002_refresh_token_jti
Revises: 0001_mysql_initial
Create Date: 2026-07-04

新增字段用于服务端撤销 refresh token：
- 签发 refresh token 时生成 jti (UUID) 写入 payload 和此字段
- 刷新时校验 payload jti 与 DB jti 一致，刷新后轮换新 jti
- 登出时置 NULL，使所有旧 refresh token 立即失效
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0002_refresh_token_jti"
down_revision: Union[str, Sequence[str], None] = "0001_mysql_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN refresh_token_jti CHAR(36) NULL"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE users DROP COLUMN refresh_token_jti"
    )
