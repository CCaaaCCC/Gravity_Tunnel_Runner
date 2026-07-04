"""头像处理服务。

接收上传的原始图片字节，使用 Pillow 统一缩放为 256×256 PNG 保存到本地文件系统。
存储路径由 settings.AVATAR_UPLOAD_DIR 控制，文件名固定为 {user_id}.png（覆盖旧头像）。
"""
from __future__ import annotations

import logging
import os
from io import BytesIO

from PIL import Image

from app.config import settings

logger = logging.getLogger(__name__)


def process_and_save_avatar(file_data: bytes, user_id: str) -> str:
    """处理上传的头像并保存。

    Args:
        file_data: 原始图片字节（已通过 Content-Type 和大小校验）
        user_id: 用户 ID（用作文件名）

    Returns:
        avatar_url 相对路径（如 /uploads/avatars/{user_id}.png）

    Raises:
        ValueError: 图片格式无效或无法解码
    """
    try:
        img = Image.open(BytesIO(file_data))
    except Exception as e:
        logger.warning("头像解码失败: %s", e)
        raise ValueError("图片格式无效") from e

    # 统一转换为 RGBA（支持透明通道），再缩放到目标尺寸
    img = img.convert("RGBA")
    img = img.resize(
        (settings.AVATAR_OUTPUT_SIZE, settings.AVATAR_OUTPUT_SIZE),
        Image.LANCZOS,
    )

    upload_dir = settings.AVATAR_UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, f"{user_id}.png")
    img.save(filepath, "PNG", optimize=True)
    logger.info("头像已保存: %s", filepath)
    return f"/uploads/avatars/{user_id}.png"
