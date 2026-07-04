"""认证流程集成测试：发送验证码 -> 验证登录 -> /me -> 刷新 -> 登出 -> 修改资料 -> 注销。"""
import base64
import io

import pytest
from httpx import AsyncClient

from conftest import register_user


@pytest.mark.asyncio
async def test_verify_and_me(client: AsyncClient):
    token = await register_user(client, "alice", "alice@example.com")

    # /me
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "alice"
    assert me.json()["email"] == "alice@example.com"
    # created_at 应该存在
    assert me.json().get("created_at") is not None


@pytest.mark.asyncio
async def test_verify_old_user_login(client: AsyncClient):
    """同一邮箱再次验证应登录而非重复注册。"""
    t1 = await register_user(client, "bob", "bob@example.com")

    # 再次发送验证码 + 验证（不传 username，应保留老用户名）
    await client.post("/auth/send-otp", json={"email": "bob@example.com"})
    resp = await client.post("/auth/verify", json={
        "email": "bob@example.com",
        "code": "123456",
    })
    assert resp.status_code == 200
    assert resp.json()["user"]["username"] == "bob"


@pytest.mark.asyncio
async def test_verify_wrong_code(client: AsyncClient):
    """验证码错误应返回 401。"""
    # 先发送正确的验证码
    await client.post("/auth/send-otp", json={"email": "wrongcode@example.com"})
    # 用错误的验证码
    resp = await client.post("/auth/verify", json={
        "email": "wrongcode@example.com",
        "code": "000000",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    token = await register_user(client, "dave", "dave@example.com")
    # 重新验证获取 refresh_token
    await client.post("/auth/send-otp", json={"email": "dave@example.com"})
    resp = await client.post("/auth/verify", json={
        "email": "dave@example.com",
        "code": "123456",
    })
    refresh_token = resp.json()["refresh_token"]

    r = await client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 200
    assert r.json()["access_token"]
    # 新响应应包含轮换后的 refresh_token 和 expires_in
    assert r.json()["refresh_token"]
    assert r.json()["expires_in"] > 0


@pytest.mark.asyncio
async def test_me_without_token(client: AsyncClient):
    r = await client.get("/auth/me")
    assert r.status_code == 401


# ============ 新增测试 ============


@pytest.mark.asyncio
async def test_send_otp_returns_is_new_user(client: AsyncClient):
    """send-otp 应返回 is_new_user 字段，新号 true，老号 false。"""
    # 新号
    r1 = await client.post("/auth/send-otp", json={"email": "newuser@example.com"})
    assert r1.status_code == 200
    assert r1.json()["is_new_user"] is True

    # 注册
    await client.post("/auth/verify", json={
        "email": "newuser@example.com",
        "code": "123456",
        "username": "newbie",
    })

    # 老号
    r2 = await client.post("/auth/send-otp", json={"email": "newuser@example.com"})
    assert r2.status_code == 200
    assert r2.json()["is_new_user"] is False


@pytest.mark.asyncio
async def test_refresh_token_rotation(client: AsyncClient):
    """刷新后旧 refresh token 应失效（轮换）。"""
    await client.post("/auth/send-otp", json={"email": "rotator@example.com"})
    resp = await client.post("/auth/verify", json={
        "email": "rotator@example.com",
        "code": "123456",
        "username": "rotator",
    })
    old_refresh = resp.json()["refresh_token"]

    # 第一次刷新成功，返回新 refresh token
    r1 = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200
    new_refresh = r1.json()["refresh_token"]
    assert new_refresh != old_refresh

    # 旧 refresh token 应失效
    r2 = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert r2.status_code == 401

    # 新 refresh token 可继续使用
    r3 = await client.post("/auth/refresh", json={"refresh_token": new_refresh})
    assert r3.status_code == 200


@pytest.mark.asyncio
async def test_logout_invalidates_refresh(client: AsyncClient):
    """登出后 refresh token 应立即失效。"""
    token = await register_user(client, "logoutter", "logoutter@example.com")

    # 获取 refresh token
    await client.post("/auth/send-otp", json={"email": "logoutter@example.com"})
    resp = await client.post("/auth/verify", json={
        "email": "logoutter@example.com",
        "code": "123456",
    })
    refresh_token = resp.json()["refresh_token"]

    # 登出
    r = await client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200

    # refresh token 应失效
    r2 = await client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert r2.status_code == 401


@pytest.mark.asyncio
async def test_update_profile(client: AsyncClient):
    """修改用户名后 /auth/me 应返回新用户名。"""
    token = await register_user(client, "profiler1", "profiler1@example.com")

    r = await client.put(
        "/auth/profile",
        headers={"Authorization": f"Bearer {token}"},
        json={"username": "profiler_renamed", "display_name": "新昵称"},
    )
    assert r.status_code == 200
    assert r.json()["username"] == "profiler_renamed"
    assert r.json()["display_name"] == "新昵称"

    # /me 确认
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["username"] == "profiler_renamed"


@pytest.mark.asyncio
async def test_update_profile_name_conflict(client: AsyncClient):
    """用户名冲突应返回 409。"""
    t1 = await register_user(client, "unique1", "unique1@example.com")
    t2 = await register_user(client, "unique2", "unique2@example.com")

    # unique2 想改成 unique1，应冲突
    r = await client.put(
        "/auth/profile",
        headers={"Authorization": f"Bearer {t2}"},
        json={"username": "unique1"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_delete_account(client: AsyncClient):
    """注销账号后 /auth/me 和 /auth/refresh 都应 401。"""
    token = await register_user(client, "deleter", "deleter@example.com")

    # 获取 refresh token
    await client.post("/auth/send-otp", json={"email": "deleter@example.com"})
    verify_resp = await client.post("/auth/verify", json={
        "email": "deleter@example.com",
        "code": "123456",
    })
    refresh_token = verify_resp.json()["refresh_token"]

    # 注销（不带 confirm 应 400）
    r0 = await client.delete(
        "/auth/account",
        headers={"Authorization": f"Bearer {token}"},
        params={"confirm": "false"},
    )
    assert r0.status_code == 400

    # 正确注销
    r = await client.delete(
        "/auth/account",
        headers={"Authorization": f"Bearer {token}"},
        params={"confirm": "true"},
    )
    assert r.status_code == 200

    # /me 应 401
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 401

    # refresh 应 401
    r2 = await client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert r2.status_code == 401


# ============ 账号管理增强测试（密码 / 头像 / 邮箱变更） ============

# 最小 1x1 PNG（base64 解码后是合法 PNG 字节）
_TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="


def _tiny_png_bytes() -> bytes:
    return base64.b64decode(_TINY_PNG_B64)


@pytest.mark.asyncio
async def test_user_public_has_password(client: AsyncClient):
    """新注册用户 has_password 应为 False，设置密码后应为 True。"""
    token = await register_user(client, "haspwd", "haspwd@example.com")

    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["has_password"] is False

    # 设置密码
    r = await client.post(
        "/auth/set-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "MyPassword123"},
    )
    assert r.status_code == 200
    assert r.json()["has_password"] is True

    # /me 也应反映
    me2 = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me2.json()["has_password"] is True


@pytest.mark.asyncio
async def test_set_password(client: AsyncClient):
    """已登录用户首次设置密码。"""
    token = await register_user(client, "setpwd", "setpwd@example.com")

    r = await client.post(
        "/auth/set-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "SetPwd456"},
    )
    assert r.status_code == 200
    assert r.json()["has_password"] is True


@pytest.mark.asyncio
async def test_set_password_already_set(client: AsyncClient):
    """重复设置密码应返回 409。"""
    token = await register_user(client, "duppwd", "duppwd@example.com")
    await client.post(
        "/auth/set-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "FirstPwd123"},
    )

    r = await client.post(
        "/auth/set-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "SecondPwd456"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_login_password_success(client: AsyncClient):
    """设密码后用邮箱+密码登录成功。"""
    token = await register_user(client, "pwdlogin", "pwdlogin@example.com")
    # 设置密码
    set_resp = await client.post(
        "/auth/set-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "LoginPwd123"},
    )
    assert set_resp.status_code == 200

    # 用密码登录
    r = await client.post("/auth/login-password", json={
        "email": "pwdlogin@example.com",
        "password": "LoginPwd123",
    })
    assert r.status_code == 200
    assert r.json()["access_token"]
    assert r.json()["user"]["username"] == "pwdlogin"
    assert r.json()["user"]["has_password"] is True


async def _login_token(client: AsyncClient, email: str) -> str:
    """通过 OTP 登录获取 token（用于设置密码等需 JWT 的操作）。"""
    await client.post("/auth/send-otp", json={"email": email})
    resp = await client.post("/auth/verify", json={"email": email, "code": "123456"})
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_login_password_wrong(client: AsyncClient):
    """错误密码返回 401，提示"邮箱或密码错误"。"""
    token = await register_user(client, "wrongpwd", "wrongpwd@example.com")
    await client.post(
        "/auth/set-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "CorrectPwd123"},
    )

    r = await client.post("/auth/login-password", json={
        "email": "wrongpwd@example.com",
        "password": "WrongPwd456",
    })
    assert r.status_code == 401
    assert "邮箱或密码错误" in r.json()["detail"]


@pytest.mark.asyncio
async def test_login_password_no_password(client: AsyncClient):
    """未设密码时用密码登录返回 401（统一提示防枚举）。"""
    await register_user(client, "nopwd", "nopwd@example.com")

    r = await client.post("/auth/login-password", json={
        "email": "nopwd@example.com",
        "password": "AnyPassword1",
    })
    assert r.status_code == 401
    assert "邮箱或密码错误" in r.json()["detail"]


@pytest.mark.asyncio
async def test_change_password(client: AsyncClient):
    """修改密码（旧密码正确）。"""
    token = await register_user(client, "changepwd", "changepwd@example.com")
    await client.post(
        "/auth/set-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "OldPwd123"},
    )

    r = await client.put(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"old_password": "OldPwd123", "new_password": "NewPwd456"},
    )
    assert r.status_code == 200

    # 用新密码登录应成功
    login = await client.post("/auth/login-password", json={
        "email": "changepwd@example.com",
        "password": "NewPwd456",
    })
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_change_password_wrong_old(client: AsyncClient):
    """旧密码错误返回 401。"""
    token = await register_user(client, "wrongold", "wrongold@example.com")
    await client.post(
        "/auth/set-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"password": "RealPwd123"},
    )

    r = await client.put(
        "/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"old_password": "WrongPwd999", "new_password": "NewPwd456"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_reset_password(client: AsyncClient):
    """OTP 验证后重置密码（无需 JWT）。"""
    await register_user(client, "resetter", "resetter@example.com")

    # 发送 OTP
    await client.post("/auth/send-otp", json={"email": "resetter@example.com"})
    # 重置密码
    r = await client.post("/auth/reset-password", json={
        "email": "resetter@example.com",
        "code": "123456",
        "new_password": "ResetPwd123",
    })
    assert r.status_code == 200

    # 用新密码登录应成功
    login = await client.post("/auth/login-password", json={
        "email": "resetter@example.com",
        "password": "ResetPwd123",
    })
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_upload_avatar(client: AsyncClient):
    """上传头像后 avatar_url 应更新。"""
    token = await register_user(client, "avatarer", "avatarer@example.com")

    png_bytes = _tiny_png_bytes()
    r = await client.post(
        "/auth/avatar",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("avatar.png", png_bytes, "image/png")},
    )
    assert r.status_code == 200
    assert r.json()["avatar_url"]
    assert "/uploads/avatars/" in r.json()["avatar_url"]

    # /me 也应反映
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["avatar_url"]


@pytest.mark.asyncio
async def test_upload_avatar_too_large(client: AsyncClient):
    """超 5MB 返回 413。"""
    token = await register_user(client, "bigfile", "bigfile@example.com")

    # 6MB 假数据（content-type 合法，但大小超限）
    big_bytes = b"\x00" * (6 * 1024 * 1024)
    r = await client.post(
        "/auth/avatar",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("big.png", big_bytes, "image/png")},
    )
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_upload_avatar_bad_type(client: AsyncClient):
    """非图片类型返回 400。"""
    token = await register_user(client, "badtype", "badtype@example.com")

    r = await client.post(
        "/auth/avatar",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("file.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_change_email(client: AsyncClient):
    """OTP 验证后邮箱变更成功。"""
    token = await register_user(client, "emailchanger", "emailchanger@example.com")

    # 向新邮箱发送 OTP
    r1 = await client.post(
        "/auth/change-email/send-otp",
        headers={"Authorization": f"Bearer {token}"},
        json={"new_email": "newemail@example.com"},
    )
    assert r1.status_code == 200

    # 验证并变更
    r2 = await client.post(
        "/auth/change-email/verify",
        headers={"Authorization": f"Bearer {token}"},
        json={"new_email": "newemail@example.com", "code": "123456"},
    )
    assert r2.status_code == 200
    assert r2.json()["email"] == "newemail@example.com"


@pytest.mark.asyncio
async def test_change_email_occupied(client: AsyncClient):
    """新邮箱已被占用返回 409。"""
    # 先注册两个用户
    await register_user(client, "userA", "usera@example.com")
    token_b = await register_user(client, "userB", "userb@example.com")

    # userB 想把邮箱改成 usera 的邮箱
    r = await client.post(
        "/auth/change-email/send-otp",
        headers={"Authorization": f"Bearer {token_b}"},
        json={"new_email": "usera@example.com"},
    )
    assert r.status_code == 409
