"""pytest 配置：测试夹具。

测试使用真实 MySQL 数据库（需在 .env 中配置 DATABASE_URL）。
为避免污染数据，测试会在每条用例前后清理 users 表。
OTP 验证码在开发模式下固定为 123456（OTP_DEV_FIXED_CODE），不需要真实邮件。
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient

# 让 backend/ 目录可被 import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 加载 backend/.env
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# 测试环境强制 dev 模式：跳过真实 SMTP 发送 + 使用固定验证码 123456
# 必须在 import app.main 之前设置，因为 pydantic-settings 在 import 时读取 env
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""
os.environ["OTP_DEV_FIXED_CODE"] = "123456"

from app.main import app


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def client():
    """共享 ASGI 测试客户端，触发 lifespan 以初始化 DB 连接池。"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        async with app.router.lifespan_context(app):
            yield c


async def register_user(
    client: AsyncClient,
    username: str,
    email: str,
    _code: str = "123456",
) -> str:
    """辅助函数：通过 OTP 流程注册/登录用户，返回 access_token。

    开发模式下 OTP_DEV_FIXED_CODE=123456，验证码固定，不需要真实邮件。
    """
    # 先发送验证码（开发模式仅写入数据库，不发邮件）
    await client.post("/auth/send-otp", json={"email": email})
    # 再验证
    resp = await client.post("/auth/verify", json={
        "email": email,
        "code": _code,
        "username": username,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest_asyncio.fixture(autouse=True)
async def _clean_users(client: AsyncClient):
    """每条测试前后清理 users 表（级联清理其他表）+ 重置速率限制器。

    依赖 client fixture 以确保 DB 连接池已初始化。
    """
    from app.db import acquire_conn
    from app.limiter import limiter

    # 测试需 DB 已就绪；若未配置 DATABASE_URL 则跳过
    if not os.getenv("DATABASE_URL"):
        pytest.skip("DATABASE_URL 未配置，跳过集成测试")

    # 重置 slowapi 内存限速器，避免测试间相互影响（所有测试来自同一 IP）
    storage = limiter._storage
    # MemoryStorage 内部用 dict 存储计数，直接清空
    if hasattr(storage, "events"):
        storage.events.clear()
    if hasattr(storage, "expirations"):
        storage.expirations.clear()
    if hasattr(storage, "storage"):
        try:
            storage.storage.clear()
        except (AttributeError, TypeError):
            pass

    async with acquire_conn() as conn:
        await conn.execute("SET FOREIGN_KEY_CHECKS=0")
        await conn.execute("TRUNCATE TABLE users")
        await conn.execute("TRUNCATE TABLE otp_codes")
        await conn.execute("TRUNCATE TABLE scores")
        await conn.execute("TRUNCATE TABLE player_progress")
        await conn.execute("TRUNCATE TABLE challenge_participations")
        await conn.execute("TRUNCATE TABLE challenges")
        await conn.execute("SET FOREIGN_KEY_CHECKS=1")

    yield

    async with acquire_conn() as conn:
        await conn.execute("SET FOREIGN_KEY_CHECKS=0")
        await conn.execute("TRUNCATE TABLE users")
        await conn.execute("TRUNCATE TABLE otp_codes")
        await conn.execute("TRUNCATE TABLE scores")
        await conn.execute("TRUNCATE TABLE player_progress")
        await conn.execute("TRUNCATE TABLE challenge_participations")
        await conn.execute("TRUNCATE TABLE challenges")
        await conn.execute("SET FOREIGN_KEY_CHECKS=1")
