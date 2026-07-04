"""Alembic environment.

Reads DATABASE_URL from .env so migrations run against the
configured MySQL instance. Uses offline mode (raw SQL emission)
since we don't depend on SQLAlchemy ORM models.
"""
import os
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv

# 加载 backend/.env
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 从环境变量覆盖 sqlalchemy.url
db_url = os.getenv("DATABASE_URL")
if db_url:
    # mysql:// → mysql+pymysql:// for alembic sync execution
    sync_url = db_url.replace("mysql://", "mysql+pymysql://")
    config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = None


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import create_engine, pool

    connectable = create_engine(
        config.get_main_option("sqlalchemy.url"),
        future=True,
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
