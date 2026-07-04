"""slowapi 限速器单例。

路由中通过 `from app.limiter import limiter` 引用，再用 `@limiter.limit("5/hour")`
装饰。被装饰的路由函数必须接受 `request: Request` 作为参数（slowapi 要求）。
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=[])
