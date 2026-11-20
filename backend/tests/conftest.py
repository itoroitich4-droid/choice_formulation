import os
import time
import uuid

import jwt
import psycopg
import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres@localhost:5433/postgres")
SECRET = "test-secret-test-secret-test-secret-123456"
os.environ["DATABASE_URL"] = TEST_DB
os.environ["SUPABASE_JWT_SECRET"] = SECRET

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def token(sub: str, email: str, exp_in: int = 3600) -> str:
    return jwt.encode({"sub": sub, "email": email, "aud": "authenticated", "role": "authenticated",
                       "exp": int(time.time()) + exp_in}, SECRET, algorithm="HS256")


@pytest.fixture()
def admin_db():
    with psycopg.connect(TEST_DB, autocommit=True) as c:
        c.execute("truncate public.batches, public.formulations, public.audit_events, public.ingredients, "
                  "public.products, public.company_members restart identity cascade")
        c.execute("truncate auth.users cascade")
        yield c


@pytest.fixture()
def users(admin_db):
    out = {}
    for role in ("admin", "nutritionist", "formulator", "formulator2", "viewer", "outsider"):
        uid = str(uuid.uuid4())
        email = f"{role}@choice.test"
        admin_db.execute("insert into auth.users (id, email) values (%s,%s)", [uid, email])
        if role != "outsider":
            admin_db.execute("insert into public.company_members (user_id, email, role) values (%s,%s,%s)",
                             [uid, email, role.rstrip("2")])
        out[role] = {"id": uid, "email": email, "h": {"Authorization": f"Bearer {token(uid, email)}"}}
    return out


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c
