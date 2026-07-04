"""排行榜 API 集成测试。"""
import pytest
from httpx import AsyncClient

from conftest import register_user


@pytest.mark.asyncio
async def test_submit_score(client: AsyncClient):
    token = await register_user(client, "alice", "alice@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/leaderboard/submit", json={
        "score": 1500,
        "combo": 10,
        "difficulty": "normal",
        "distance": 1200.0,
        "zone_reached": 2,
        "duration_sec": 60,
    }, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["rank"] == 1
    assert data["is_personal_best"] is True
    assert data["total_in_difficulty"] == 1


@pytest.mark.asyncio
async def test_submit_score_anticheat(client: AsyncClient):
    token = await register_user(client, "bob", "bob@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    # 分数远超合理上界（distance=100 但 score=999999）
    resp = await client.post("/leaderboard/submit", json={
        "score": 999999,
        "combo": 5,
        "difficulty": "easy",
        "distance": 100.0,
        "zone_reached": 0,
        "duration_sec": 30,
    }, headers=headers)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_top_leaderboard(client: AsyncClient):
    # 两个用户各提交一分数
    t1 = await register_user(client, "alice", "alice2@example.com")
    t2 = await register_user(client, "bob", "bob2@example.com")

    await client.post("/leaderboard/submit", json={
        "score": 1000, "combo": 5, "difficulty": "normal",
        "distance": 800, "zone_reached": 1, "duration_sec": 60,
    }, headers={"Authorization": f"Bearer {t1}"})

    await client.post("/leaderboard/submit", json={
        "score": 2000, "combo": 10, "difficulty": "normal",
        "distance": 1500, "zone_reached": 2, "duration_sec": 90,
    }, headers={"Authorization": f"Bearer {t2}"})

    resp = await client.get("/leaderboard/top", params={"difficulty": "normal"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["score"] == 2000  # 高分排前
    assert data[0]["username"] == "bob"
    assert data[1]["score"] == 1000


@pytest.mark.asyncio
async def test_user_scores(client: AsyncClient):
    token = await register_user(client, "carol", "carol@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    for i in range(3):
        await client.post("/leaderboard/submit", json={
            "score": 500 + i * 100, "combo": 1, "difficulty": "easy",
            "distance": 400, "zone_reached": 0, "duration_sec": 30,
        }, headers=headers)

    resp = await client.get("/leaderboard/user/me", headers=headers)
    # "me" 不是 UUID，应 422
    assert resp.status_code == 422

    # 取真实 user_id
    me = await client.get("/auth/me", headers=headers)
    user_id = me.json()["id"]

    # 需登录鉴权：不带 token 应 401
    resp_no_auth = await client.get(f"/leaderboard/user/{user_id}")
    assert resp_no_auth.status_code == 401

    resp = await client.get(f"/leaderboard/user/{user_id}", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_submit_requires_auth(client: AsyncClient):
    resp = await client.post("/leaderboard/submit", json={
        "score": 100, "combo": 1, "difficulty": "easy",
        "distance": 100, "zone_reached": 0, "duration_sec": 10,
    })
    assert resp.status_code == 401
