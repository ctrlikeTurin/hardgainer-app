"""Supabase JWT verification.

Email verification is enforced by Supabase itself: with "Confirm email" enabled
(Authentication > Providers > Email), no session/token is issued until the user
clicks the link, so any valid token here belongs to a verified user.
"""

from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


def _decode(token: str) -> dict:
    if settings.supabase_jwt_secret:
        return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
    if not settings.supabase_url:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Auth is not configured")
    key = _jwks_client().get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=["ES256", "RS256"], audience="authenticated")


def require_auth(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> AuthUser:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Invalid or expired session", headers={"WWW-Authenticate": "Bearer"}
    )
    if creds is None:
        raise unauthorized
    try:
        claims = _decode(creds.credentials)
    except jwt.PyJWTError:
        raise unauthorized
    if claims.get("role") != "authenticated" or not claims.get("sub"):
        raise unauthorized
    return AuthUser(id=claims["sub"], email=claims.get("email"))
