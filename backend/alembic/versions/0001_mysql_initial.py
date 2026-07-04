"""MySQL initial schema: otp_codes, users, scores, player_progress, challenges, challenge_participations

Revision ID: 0001_mysql_initial
Revises:
Create Date: 2026-07-03
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0001_mysql_initial"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---------- otp_codes ----------
    op.execute(
        """
        CREATE TABLE otp_codes (
            phone       VARCHAR(20) PRIMARY KEY,
            code        CHAR(6) NOT NULL,
            expires_at  DATETIME NOT NULL,
            attempts    INT NOT NULL DEFAULT 0
        )
        """
    )

    # ---------- users ----------
    op.execute(
        """
        CREATE TABLE users (
            id            CHAR(36) PRIMARY KEY,
            username      VARCHAR(20) UNIQUE NOT NULL,
            phone         VARCHAR(20) UNIQUE,
            display_name  VARCHAR(50),
            avatar_url    VARCHAR(500),
            created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.create_index("idx_users_phone", "users", ["phone"])

    # ---------- scores ----------
    op.execute(
        """
        CREATE TABLE scores (
            id           CHAR(36) PRIMARY KEY,
            user_id      CHAR(36) NOT NULL,
            score        INT NOT NULL,
            combo        INT NOT NULL,
            difficulty   VARCHAR(10) NOT NULL,
            distance     FLOAT NOT NULL,
            zone_reached INT NOT NULL,
            is_challenge  BOOLEAN NOT NULL DEFAULT FALSE,
            seed         BIGINT,
            duration_sec INT,
            created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            CHECK (score >= 0 AND score < 1000000),
            CHECK (difficulty IN ('easy','normal','hard'))
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_scores_difficulty_created ON scores (difficulty, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_scores_score_desc ON scores (difficulty, is_challenge, score DESC)"
    )
    op.create_index("idx_scores_user", "scores", ["user_id", "created_at"])

    # ---------- player_progress ----------
    op.execute(
        """
        CREATE TABLE player_progress (
            user_id              CHAR(36) PRIMARY KEY,
            achievements         JSON NOT NULL,
            cumulative_powerups  INT NOT NULL DEFAULT 0,
            credits              INT NOT NULL DEFAULT 0,
            unlocked_skins       JSON NOT NULL,
            current_skin         VARCHAR(50) NOT NULL DEFAULT 'classic',
            updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )

    # ---------- challenges ----------
    op.execute(
        """
        CREATE TABLE challenges (
            id                CHAR(36) PRIMARY KEY,
            creator_id        CHAR(36) NOT NULL,
            seed              BIGINT NOT NULL,
            share_code        VARCHAR(10) UNIQUE NOT NULL,
            title             VARCHAR(50),
            difficulty_target VARCHAR(10),
            created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
            CHECK (difficulty_target IS NULL OR difficulty_target IN ('easy','normal','hard'))
        )
        """
    )
    op.create_index("idx_challenges_share_code", "challenges", ["share_code"])
    op.execute(
        "CREATE INDEX idx_challenges_creator ON challenges (creator_id, created_at DESC)"
    )

    # ---------- challenge_participations ----------
    op.execute(
        """
        CREATE TABLE challenge_participations (
            id            CHAR(36) PRIMARY KEY,
            challenge_id  CHAR(36) NOT NULL,
            user_id       CHAR(36) NOT NULL,
            score         INT NOT NULL,
            combo         INT NOT NULL,
            distance      FLOAT NOT NULL,
            duration_sec  INT,
            completed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(challenge_id, user_id),
            FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_participations_challenge ON challenge_participations (challenge_id, score DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS challenge_participations")
    op.execute("DROP TABLE IF EXISTS challenges")
    op.execute("DROP TABLE IF EXISTS player_progress")
    op.execute("DROP TABLE IF EXISTS scores")
    op.execute("DROP TABLE IF EXISTS users")
    op.execute("DROP TABLE IF EXISTS otp_codes")
