"""aiomysql 连接池 + asyncpg 兼容包装层。

应用启动时通过 lifespan 创建连接池，FastAPI 路由通过 Depends 获取连接。
MySQLConn 模拟 asyncpg.Connection 的 fetchrow/fetch/fetchval/execute 接口，
使路由层改动最小化。
"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator
from urllib.parse import urlparse

import aiomysql
from fastapi import FastAPI

from app.config import settings

logger = logging.getLogger(__name__)

_pool: aiomysql.Pool | None = None


class MySQLConn:
    """asyncpg 兼容层：模拟 asyncpg.Connection 的接口。

    差异处理：
    - 占位符：路由层 SQL 中用 %s（aiomysql 格式）
    - JSON 字段：asyncpg 自动反序列化 JSONB → dict/list；aiomysql 返回 str → 包装层自动 json.loads
    - 事务：execute 后自动 commit
    """

    # 需要自动反序列化的 JSON 字段（基于表结构）
    _JSON_FIELDS = {"achievements", "unlocked_skins"}

    def __init__(self, conn: aiomysql.Connection):
        self._conn = conn

    async def fetchrow(self, query, *args):
        async with self._conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(query, args or ())
            row = await cur.fetchone()
            # 读操作也提交以释放事务持有的元数据锁（autocommit=False 时
            # SELECT 会隐式开启事务，不提交会导致 DDL/TRUNCATE 等被阻塞）
            await self._conn.commit()
            return self._decode_row(row) if row else None

    async def fetch(self, query, *args):
        async with self._conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(query, args or ())
            rows = await cur.fetchall()
            await self._conn.commit()
            return [self._decode_row(r) for r in rows]

    async def fetchval(self, query, *args):
        async with self._conn.cursor() as cur:
            await cur.execute(query, args or ())
            row = await cur.fetchone()
            await self._conn.commit()
            return row[0] if row else None

    async def execute(self, query, *args):
        async with self._conn.cursor() as cur:
            await cur.execute(query, args or ())
            await self._conn.commit()
            return cur.rowcount

    @classmethod
    def _decode_row(cls, row):
        """DictCursor 返回的 dict 中，JSON 字段自动反序列化。"""
        if row is None:
            return None
        decoded = dict(row)
        for k in list(decoded.keys()):
            if k in cls._JSON_FIELDS and isinstance(decoded[k], str):
                try:
                    decoded[k] = json.loads(decoded[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return decoded


async def init_pool(app: FastAPI) -> None:
    """在 FastAPI lifespan 中调用，初始化连接池。"""
    global _pool
    parsed = urlparse(settings.DATABASE_URL)
    _pool = await aiomysql.create_pool(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=parsed.username or "root",
        password=parsed.password or "",
        db=parsed.path.lstrip("/"),
        minsize=2,
        maxsize=10,
        autocommit=False,
    )
    app.state.pool = _pool
    logger.info("DB pool initialized")


async def close_pool() -> None:
    """在 FastAPI shutdown 中调用，关闭连接池。"""
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None
        logger.info("DB pool closed")


def get_pool() -> aiomysql.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialized")
    return _pool


@asynccontextmanager
async def acquire_conn() -> AsyncIterator[MySQLConn]:
    """便捷工具：在非路由代码中获取连接。"""
    pool = get_pool()
    async with pool.acquire() as raw_conn:
        yield MySQLConn(raw_conn)
