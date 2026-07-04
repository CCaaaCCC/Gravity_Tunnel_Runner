"""应用配置：从 .env 读取，提供类型安全的 Settings 单例。"""
from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database (MySQL)
    DATABASE_URL: str

    # 邮箱 SMTP（QQ 邮箱）
    SMTP_HOST: str = "smtp.qq.com"
    SMTP_PORT: int = 465
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_FROM_NAME: str = "重力隧道"
    SMTP_USE_TLS: bool = True

    # OTP 配置
    OTP_EXPIRE_MINUTES: int = 5
    OTP_MAX_ATTEMPTS: int = 5
    # 开发模式：固定验证码（为空则随机生成 + 真实发邮件）
    OTP_DEV_FIXED_CODE: str = ""

    # JWT
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # CORS（逗号分隔的字符串列表）
    CORS_ORIGINS: str = "file://,http://localhost,http://127.0.0.1"

    # 速率限制（slowapi 格式：count/period）
    RATE_LIMIT_REGISTER: str = "5/hour"
    RATE_LIMIT_LOGIN: str = "10/minute"
    RATE_LIMIT_SUBMIT_SCORE: str = "30/minute"
    RATE_LIMIT_PROGRESS_SAVE: str = "10/minute"
    RATE_LIMIT_CHALLENGE_CREATE: str = "20/hour"
    RATE_LIMIT_LOGIN_PASSWORD: str = "10/minute"
    RATE_LIMIT_AVATAR_UPLOAD: str = "5/minute"
    RATE_LIMIT_PASSWORD_CHANGE: str = "5/minute"
    RATE_LIMIT_RESET_PASSWORD: str = "3/hour"
    RATE_LIMIT_CHANGE_EMAIL: str = "3/hour"

    # 头像上传
    AVATAR_UPLOAD_DIR: str = "uploads/avatars"
    AVATAR_MAX_SIZE_BYTES: int = 5_242_880  # 5MB
    AVATAR_ALLOWED_TYPES: str = "image/jpeg,image/png,image/webp"
    AVATAR_OUTPUT_SIZE: int = 256

    # 密码规则
    PASSWORD_MIN_LENGTH: int = 8
    PASSWORD_MAX_LENGTH: int = 64

    # 应用
    APP_ENV: str = "development"
    LOG_LEVEL: str = "INFO"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        # 统一 mysql:// 前缀
        if v.startswith("mysql+mysqlconnector://"):
            v = "mysql://" + v[len("mysql+mysqlconnector://"):]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
