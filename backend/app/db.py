"""Database access. Every request runs inside one transaction as the signed-in user, so PostgreSQL
row-level security and the integrity triggers apply exactly as they would for a direct Supabase client."""
import json
from dataclasses import dataclass
from typing import Iterator

import psycopg
from fastapi import Depends, HTTPException
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .auth import Claims, current_claims
from .config import get_settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        s = get_settings()
        # prepare_threshold=None keeps this compatible with Supabase's transaction-mode pooler.
        _pool = ConnectionPool(
            s.database_url, min_size=1, max_size=s.db_pool_max, open=True,
            kwargs={"row_factory": dict_row, "prepare_threshold": None, "autocommit": False},
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@dataclass
class Ctx:
    cur: psycopg.Cursor
    user_id: str
    email: str | None
    role: str | None

    def require_role(self, *roles: str) -> None:
        if self.role not in roles:
            raise HTTPException(403, "Your role does not allow this action")

    @property
    def can_write(self) -> bool:
        return self.role in ("admin", "nutritionist", "formulator")


def request_ctx(claims: Claims = Depends(current_claims)) -> Iterator[Ctx]:
    with get_pool().connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.execute("select set_config('request.jwt.claims', %s, true)", [json.dumps(claims.raw)])
                cur.execute("select set_config('request.jwt.claim.sub', %s, true)", [claims.sub])
                cur.execute("set local role authenticated")
                cur.execute("select public.member_role() as r")
                role = cur.fetchone()["r"]
                if role is None:
                    raise HTTPException(403, "This account is not an active member of the Choice Nutrition workspace")
                yield Ctx(cur, claims.sub, claims.email, role)


def audit(ctx: Ctx, event: str, **details) -> None:
    ctx.cur.execute(
        "insert into public.audit_events (event, details) values (%s, %s::jsonb)",
        [event, json.dumps(details, default=str)],
    )
