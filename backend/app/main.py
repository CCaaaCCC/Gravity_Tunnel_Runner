"""FastAPI 应用入口。

- lifespan：初始化 / 关闭 DB 连接池
- 中间件：CORS、slowapi 速率限制
- 健康检查：GET /health
- 路由挂载：/auth /leaderboard /progress /challenges
- 静态文件：/uploads（用户头像）
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.db import close_pool, init_pool
from app.limiter import limiter

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s %(levelname)-5.5s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool(app)
    routes = [r.path for r in app.routes if hasattr(r, "path")]
    logger.info("Registered routes: %s", routes)
    try:
        yield
    finally:
        await close_pool()


app = FastAPI(
    title="Gravity Tunnel Runner API",
    description="云端排行榜、用户账号、云存档同步、挑战模式",
    version="0.1.0",
    lifespan=lifespan,
)

# 中间件
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Process-Time"],
)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    """健康检查：返回服务状态与 DB 连通性。"""
    db_ok = False
    try:
        from app.db import acquire_conn
        async with acquire_conn() as conn:
            await conn.fetchval("SELECT 1")
            db_ok = True
    except Exception as e:
        logger.warning("DB health check failed: %s", e)
    return {"status": "ok" if db_ok else "degraded", "db": "ok" if db_ok else "unreachable"}


# 路由挂载（按 Phase 逐步启用）
def _mount_routers() -> None:
    router_modules = [
        ("auth", "auth", "/auth"),
        ("leaderboard", "leaderboard", "/leaderboard"),
        ("progress", "progress", "/progress"),
        ("challenge", "challenges", "/challenges"),
    ]
    for module_name, tag, prefix in router_modules:
        try:
            module = __import__(f"app.routers.{module_name}", fromlist=[module_name])
            app.include_router(module.router, prefix=prefix, tags=[tag])
        except ImportError as e:
            # 静默吞掉会导致路由缺失却无人知晓，启动时打印警告便于排查
            logger.warning("Failed to mount router %s: %s", module_name, e, exc_info=True)


_mount_routers()

# 静态文件挂载：用户头像等上传文件
# Docker 容器内通过命名卷 avatar_data 持久化到 /app/uploads
os.makedirs(settings.AVATAR_UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
