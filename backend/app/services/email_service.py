"""邮箱验证码发送服务。

使用 aiosmtplib 异步发送验证码邮件（不阻塞 FastAPI 事件循环）。
开发模式（SMTP_USER 为空）跳过实际发送，仅记录日志。
"""
from __future__ import annotations

import logging
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger(__name__)


async def send_otp_email(to_email: str, code: str) -> None:
    """发送验证码邮件。

    Args:
        to_email: 收件邮箱
        code: 6 位验证码

    开发模式（SMTP_USER 为空）跳过实际发送。
    """
    if not settings.SMTP_USER:
        logger.info("[DEV MODE] 邮件发送跳过: to=%s, code=%s", to_email, code)
        return

    from aiosmtplib import SMTP

    sender = settings.SMTP_FROM or settings.SMTP_USER
    msg = EmailMessage()
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{sender}>"
    msg["To"] = to_email
    # 验证码不放入 Subject：邮件标题常被通知栏预览 / 服务商缓存，泄露面更大
    msg["Subject"] = "您的重力隧道登录验证码"
    msg.set_content(
        f"您的重力隧道验证码是：{code}\n"
        f"{settings.OTP_EXPIRE_MINUTES} 分钟内有效，请勿告知他人。\n"
    )

    smtp = SMTP(
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        use_tls=settings.SMTP_USE_TLS,
    )
    try:
        await smtp.connect()
        await smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        await smtp.send_message(msg)
        logger.info("验证码邮件已发送至 %s", to_email)
    except Exception as e:
        logger.error("邮件发送失败: %s", e)
        raise RuntimeError(f"邮件发送失败: {e}")
    finally:
        try:
            await smtp.quit()
        except Exception:
            pass
