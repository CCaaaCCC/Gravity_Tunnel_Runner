"""挑战模式 API 集成测试。"""
import pytest
from httpx import AsyncClient

from conftest import register_user


async def _create_challenge(client: AsyncClient, token: str, seed: int = 1719660000000):
    resp = await client.post("/challenges/create", json={
        "seed": seed,
        "title": "Test Challenge",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_create_and_get_challenge(client: AsyncClient):
    token = await register_user(client, "alice", "alice@example.com")
    created = await _create_challenge(client, token)

    assert len(created["share_code"]) == 6
    assert created["seed"] == 1719660000000

    resp = await client.get(f"/challenges/{created['share_code']}")
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["seed"] == 1719660000000
    assert detail["creator_username"] == "alice"
    assert detail["participant_count"] == 0


@pytest.mark.asyncio
async def test_challenge_not_found(client: AsyncClient):
    resp = await client.get("/challenges/NOTREAL")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_submit_and_leaderboard(client: AsyncClient):
    creator_token = await register_user(client, "creator", "creator@example.com")
    created = await _create_challenge(client, creator_token)

    # 第二个用户提交成绩
    p2_token = await register_user(client, "player2", "player2@example.com")
    resp = await client.post(
        f"/challenges/{created['share_code']}/submit",
        json={
            "score": 2000,
            "combo": 10,
            "distance": 1500,
            "duration_sec": 90,
        },
        headers={"Authorization": f"Bearer {p2_token}"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["rank"] == 1
    assert data["is_best"] is True
    assert data["total_participants"] == 1

    # 第三个用户提交更高分
    p3_token = await register_user(client, "player3", "player3@example.com")
    resp = await client.post(
        f"/challenges/{created['share_code']}/submit",
        json={
            "score": 3000,
            "combo": 15,
            "distance": 2000,
            "duration_sec": 120,
        },
        headers={"Authorization": f"Bearer {p3_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["rank"] == 1

    # p2 再次提交更低分 → 不应覆盖最佳
    resp = await client.post(
        f"/challenges/{created['share_code']}/submit",
        json={
            "score": 500,
            "combo": 2,
            "distance": 400,
            "duration_sec": 30,
        },
        headers={"Authorization": f"Bearer {p2_token}"},
    )
    assert resp.json()["is_best"] is False

    # 排行榜：p3(3000) 第一，p2(2000) 第二
    lb = await client.get(f"/challenges/{created['share_code']}/leaderboard")
    assert lb.status_code == 200
    entries = lb.json()
    assert len(entries) == 2
    assert entries[0]["score"] == 3000
    assert entries[0]["username"] == "player3"
    assert entries[1]["score"] == 2000


@pytest.mark.asyncio
async def test_case_insensitive_code(client: AsyncClient):
    token = await register_user(client, "caseuser", "caseuser@example.com")
    created = await _create_challenge(client, token)
    code = created["share_code"]

    # 小写访问应等同大写
    resp = await client.get(f"/challenges/{code.lower()}")
    assert resp.status_code == 200
    assert resp.json()["share_code"] == code


@pytest.mark.asyncio
async def test_challenge_submit_requires_auth(client: AsyncClient):
    resp = await client.post("/challenges/ABCDEF/submit", json={
        "score": 100, "combo": 1, "distance": 100,
    })
    assert resp.status_code == 401
