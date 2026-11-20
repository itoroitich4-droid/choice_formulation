from contextlib import asynccontextmanager

import psycopg.errors as pe
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import close_pool, get_pool
from .routes import router

@asynccontextmanager
async def lifespan(_: FastAPI):
    get_pool()
    yield
    close_pool()


app = FastAPI(title="Choice Nutrition feed formulation API", version="1.0.0", lifespan=lifespan)
s = get_settings()
app.add_middleware(CORSMiddleware, allow_origins=s.cors_list, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.get("/health")
def health():
    with get_pool().connection() as conn:
        conn.execute("select 1")
    return {"status": "ok"}


def _msg(exc) -> str:
    d = getattr(exc, "diag", None)
    return (d.message_primary if d and d.message_primary else str(exc)).strip()


@app.exception_handler(pe.InsufficientPrivilege)
async def _priv(_: Request, exc):
    return JSONResponse({"detail": _msg(exc) if "violates row-level" not in _msg(exc) else "Your role does not allow this action"}, 403)


@app.exception_handler(pe.UniqueViolation)
async def _uniq(_: Request, exc):
    return JSONResponse({"detail": "A record with that name (or version) already exists"}, 409)


@app.exception_handler(pe.CheckViolation)
async def _check(_: Request, exc):
    return JSONResponse({"detail": _msg(exc)}, 422)


@app.exception_handler(pe.RaiseException)
async def _raise(_: Request, exc):
    return JSONResponse({"detail": _msg(exc)}, 409)


@app.exception_handler(pe.ForeignKeyViolation)
async def _fk(_: Request, exc):
    return JSONResponse({"detail": "Referenced record not found"}, 422)


@app.exception_handler(pe.InvalidTextRepresentation)
async def _bad(_: Request, exc):
    return JSONResponse({"detail": "Invalid identifier"}, 422)
