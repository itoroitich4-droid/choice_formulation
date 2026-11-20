"""Verify Supabase Auth access tokens (JWTs). The database, not this module, decides what a user may do."""
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from .config import Settings, get_settings

bearer = HTTPBearer(auto_error=False)
_jwks_clients: dict[str, PyJWKClient] = {}


@dataclass
class Claims:
    sub: str
    email: str | None
    raw: dict


def _decode(token: str, s: Settings) -> dict:
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "")
    opts = {"audience": s.jwt_audience, "options": {"require": ["exp", "sub"]}}
    if alg == "HS256":
        if not s.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 token received but SUPABASE_JWT_SECRET is not configured")
        return jwt.decode(token, s.supabase_jwt_secret, algorithms=["HS256"], **opts)
    if alg in ("ES256", "RS256"):
        if not s.supabase_url:
            raise jwt.InvalidTokenError("SUPABASE_URL is not configured")
        url = s.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
        client = _jwks_clients.setdefault(url, PyJWKClient(url, cache_keys=True, lifespan=3600))
        key = client.get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=[alg], **opts)
    raise jwt.InvalidTokenError(f"Unsupported token algorithm {alg!r}")


def current_claims(
    cred: HTTPAuthorizationCredentials | None = Depends(bearer),
    s: Settings = Depends(get_settings),
) -> Claims:
    if cred is None:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    try:
        raw = _decode(cred.credentials, s)
    except jwt.PyJWTError as exc:
        raise HTTPException(401, f"Invalid or expired sign-in: {exc}", headers={"WWW-Authenticate": "Bearer"})
    return Claims(sub=raw["sub"], email=raw.get("email"), raw=raw)
