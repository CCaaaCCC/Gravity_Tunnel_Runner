"""6 位 base36 短码生成器。

base36 字符集：[0-9A-Z]（去除易混淆字符 0/O/1/I 后为 32 字符，但本实现用标准 36 字符）。
6 位 base36 ≈ 21 亿组合，碰撞时重试生成。
"""
from __future__ import annotations

import secrets

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
BASE = len(ALPHABET)  # 36
CODE_LENGTH = 6
MAX_ATTEMPTS = 10


def _generate_one() -> str:
    # secrets.token_bytes 生成密码学安全随机数
    n = int.from_bytes(secrets.token_bytes(8), "big")
    chars = []
    for _ in range(CODE_LENGTH):
        n, r = divmod(n, BASE)
        chars.append(ALPHABET[r])
    return "".join(chars)


async def generate_unique_code(is_used) -> str:
    """生成不重复的 6 位短码。

    Args:
        is_used: async callable(code) -> bool，返回 True 表示该码已被占用
    Returns:
        未占用的短码
    Raises:
        RuntimeError: 重试 MAX_ATTEMPTS 次后仍碰撞
    """
    for _ in range(MAX_ATTEMPTS):
        code = _generate_one()
        if not await is_used(code):
            return code
    raise RuntimeError("无法生成唯一短码，请重试")


def normalize_code(code: str) -> str:
    """规范化用户输入的短码：大写 + 去除空白。"""
    return code.strip().upper()
