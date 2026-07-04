"""进度同步 API 集成测试。"""
import pytest
from httpx import AsyncClient

from conftest import register_user


@pytest.mark.asyncio
async def test_get_default_progress(client: AsyncClient):
    token = await register_user(client, "alice", "alice@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/progress/get", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["cumulative_powerups"] == 0
    assert data["credits"] == 0
    assert data["unlocked_skins"] == []
    assert data["current_skin"] == "classic"
    assert "updated_at" in data


@pytest.mark.asyncio
async def test_save_and_get(client: AsyncClient):
    token = await register_user(client, "bob", "bob@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    save_resp = await client.put("/progress/save", json={
        "achievements": {"firstSteps": True, "collector": True},
        "cumulative_powerups": 50,
        "credits": 1000,
        "unlocked_skins": ["classic", "pulse"],
        "current_skin": "pulse",
        "updated_at": "2026-06-29T00:00:00Z",
    }, headers=headers)
    assert save_resp.status_code == 200, save_resp.text
    data = save_resp.json()
    assert data["cumulative_powerups"] == 50
    assert data["credits"] == 1000
    assert "pulse" in data["unlocked_skins"]
    assert data["current_skin"] == "pulse"

    get_resp = await client.get("/progress/get", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["credits"] == 1000


@pytest.mark.asyncio
async def test_merge_takes_max(client: AsyncClient):
    token = await register_user(client, "carol", "carol@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    # 第一次保存：credits=500, powerups=10
    await client.put("/progress/save", json={
        "achievements": {"firstSteps": True},
        "cumulative_powerups": 10,
        "credits": 500,
        "unlocked_skins": ["classic"],
        "current_skin": "classic",
        "updated_at": "2026-06-29T00:00:00Z",
    }, headers=headers)

    # 第二次保存：credits=300（更小）, powerups=20（更大）
    # 期望：credits=500（保留较大）, powerups=20（取较大）
    resp = await client.put("/progress/save", json={
        "achievements": {"collector": True},  # 与 firstSteps 取并集
        "cumulative_powerups": 20,
        "credits": 300,
        "unlocked_skins": ["pulse"],  # 与 classic 取并集
        "current_skin": "pulse",
        "updated_at": "2026-06-29T01:00:00Z",
    }, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["credits"] == 500  # 取较大
    assert data["cumulative_powerups"] == 20  # 取较大
    assert data["achievements"] == {"firstSteps": True, "collector": True}  # 并集
    assert set(data["unlocked_skins"]) == {"classic", "pulse"}  # 并集
    assert data["current_skin"] == "pulse"  # 客户端时间戳更新
    assert data["merged"] is True


@pytest.mark.asyncio
async def test_progress_requires_auth(client: AsyncClient):
    resp = await client.get("/progress/get")
    assert resp.status_code == 401
