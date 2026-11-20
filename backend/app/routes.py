import csv
import io
import json
from datetime import date, timedelta
from typing import Any

import psycopg.errors as pe
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from psycopg.types.json import Jsonb

from . import calc
from .db import Ctx, audit, request_ctx
from .optimizer import Candidate, optimize
from .schemas import (BatchIn, CalcIn, FormulationIn, IngredientIn, MemberIn, MemberPatch, OptimizeIn,
                      ProductIn, RecipeBody, ReviewIn)

router = APIRouter(prefix="/api")


def _dump_targets(t: dict) -> dict:
    return {k: (v if isinstance(v, dict) else v.model_dump()) for k, v in (t or {}).items()}


def _j(v: Any) -> Jsonb:
    return Jsonb(v)


# ------------------------------------------------------------------ session
@router.get("/me")
def me(ctx: Ctx = Depends(request_ctx)):
    return {"user_id": ctx.user_id, "email": ctx.email, "role": ctx.role,
            "nutrients": [{"key": k, "label": l, "unit": u} for k, l, u in calc.NUTRIENTS]}


# ------------------------------------------------------------------ ingredients
@router.get("/ingredients")
def list_ingredients(include_archived: bool = True, ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute("select * from public.ingredients where (%s or active) order by lower(name)", [include_archived])
    return ctx.cur.fetchall()


@router.post("/ingredients", status_code=201)
def create_ingredient(body: IngredientIn, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist")
    ctx.cur.execute(
        "insert into public.ingredients (name, category, cost_per_kg, pack, source, nutrients) "
        "values (%s,%s,%s,%s,%s,%s) returning *",
        [body.name, body.category, body.cost_per_kg, body.pack, body.source, _j(body.nutrients)])
    row = ctx.cur.fetchone()
    audit(ctx, "ingredient_created", name=row["name"])
    return row


@router.put("/ingredients/{iid}")
def update_ingredient(iid: str, body: IngredientIn, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist")
    ctx.cur.execute(
        "update public.ingredients set name=%s, category=%s, cost_per_kg=%s, pack=%s, source=%s, nutrients=%s "
        "where id=%s returning *",
        [body.name, body.category, body.cost_per_kg, body.pack, body.source, _j(body.nutrients), iid])
    row = ctx.cur.fetchone()
    if not row:
        raise HTTPException(404, "Ingredient not found")
    audit(ctx, "ingredient_updated", name=row["name"])
    return row


@router.post("/ingredients/{iid}/active")
def set_ingredient_active(iid: str, active: bool, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist")
    ctx.cur.execute("update public.ingredients set active=%s where id=%s returning *", [active, iid])
    row = ctx.cur.fetchone()
    if not row:
        raise HTTPException(404, "Ingredient not found")
    audit(ctx, "ingredient_restored" if active else "ingredient_archived", name=row["name"])
    return row


# ------------------------------------------------------------------ products
@router.get("/products")
def list_products(ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute("""
      select p.*, lv.version as latest_version, lv.status as latest_status
      from public.products p
      left join lateral (select version, status from public.formulations f
                         where f.product_id = p.id order by version desc limit 1) lv on true
      order by lower(p.name)""")
    return ctx.cur.fetchall()


@router.post("/products", status_code=201)
def create_product(body: ProductIn, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist", "formulator")
    ctx.cur.execute(
        "insert into public.products (name, kind, animal, pack, description, targets) values (%s,%s,%s,%s,%s,%s) returning *",
        [body.name.strip(), body.kind, body.animal, body.pack, body.description, _j(_dump_targets(body.targets))])
    row = ctx.cur.fetchone()
    audit(ctx, "product_created", name=row["name"])
    return row


@router.put("/products/{pid}")
def update_product(pid: str, body: ProductIn, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist")
    ctx.cur.execute(
        "update public.products set name=%s, kind=%s, animal=%s, pack=%s, description=%s, targets=%s where id=%s returning *",
        [body.name.strip(), body.kind, body.animal, body.pack, body.description, _j(_dump_targets(body.targets)), pid])
    row = ctx.cur.fetchone()
    if not row:
        raise HTTPException(404, "Product not found")
    audit(ctx, "product_updated", name=row["name"])
    return row


@router.post("/products/{pid}/active")
def set_product_active(pid: str, active: bool, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist")
    ctx.cur.execute("update public.products set active=%s where id=%s returning *", [active, pid])
    row = ctx.cur.fetchone()
    if not row:
        raise HTTPException(404, "Product not found")
    audit(ctx, "product_restored" if active else "product_archived", name=row["name"])
    return row


# ------------------------------------------------------------------ recipe resolution
def _approved_premix(ctx: Ctx, product_id: str):
    ctx.cur.execute("select * from public.formulations where product_id=%s and status='approved' order by version desc limit 1",
                    [product_id])
    return ctx.cur.fetchone()


def resolve_lines(ctx: Ctx, kind: str, lines, allow_inactive: bool = False, strict: bool = True) -> list[dict]:
    """Attach server-side snapshots (current price / analysis) to recipe lines. Clients never supply them."""
    out = []
    for l in lines:
        base = {"ref_type": l.ref_type, "ref_id": l.ref_id, "quantity_kg": l.quantity_kg,
                "min_pct": l.min_pct, "max_pct": l.max_pct}
        snap, name, inactive = None, None, False
        try:
            if l.ref_type == "ingredient":
                ctx.cur.execute("select * from public.ingredients where id=%s", [l.ref_id])
                ing = ctx.cur.fetchone()
                if ing and (ing["active"] or allow_inactive):
                    name, inactive = ing["name"], not ing["active"]
                    snap = {"cost_per_kg": float(ing["cost_per_kg"]) if ing["cost_per_kg"] is not None else None,
                            "nutrients": ing["nutrients"]}
            else:
                if kind != "finished_feed":
                    raise HTTPException(422, "Premixes can only be used in finished-feed recipes")
                ctx.cur.execute("select name, active from public.products where id=%s and kind='premix'", [l.ref_id])
                p = ctx.cur.fetchone()
                f = _approved_premix(ctx, l.ref_id) if p else None
                if p and f and (p["active"] or allow_inactive):
                    name, inactive = p["name"], not p["active"]
                    s = f["summary"] or {}
                    snap = {"cost_per_kg": s.get("cost_per_kg"), "nutrients": s.get("nutrients") or {},
                            "premix_version": f["version"]}
        except pe.InvalidTextRepresentation:
            raise HTTPException(422, "Invalid ingredient reference")
        if snap is None and strict:
            raise HTTPException(422, "A recipe line refers to an ingredient or approved premix that is not available")
        out.append({**base, "name": name or "Unavailable item", "snapshot": snap, "inactive": inactive})
    return out


def _summary(lines: list[dict], batch: float, targets: dict) -> dict:
    return calc.summarize(lines, batch, targets)


def _store_lines(lines: list[dict]) -> list[dict]:
    return [{k: v for k, v in l.items() if k != "inactive"} for l in lines]


@router.post("/calculate")
def calculate(body: CalcIn, ctx: Ctx = Depends(request_ctx)):
    lines = resolve_lines(ctx, body.kind, [l for l in body.lines if l.ref_id], allow_inactive=True, strict=False)
    return _summary(lines, body.batch_size_kg, _dump_targets(body.targets))


@router.post("/optimize")
def run_optimizer(body: OptimizeIn, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist", "formulator")
    limits = {(l.ref_type, l.ref_id): (l.min_pct, l.max_pct) for l in body.lines
              if l.ref_id and (l.min_pct is not None or l.max_pct is not None)}
    listed = {(l.ref_type, l.ref_id) for l in body.lines if l.ref_id}
    ctx.cur.execute("select id, name, cost_per_kg, nutrients from public.ingredients where active")
    cands = [Candidate("ingredient", str(r["id"]), r["name"],
                       float(r["cost_per_kg"]) if r["cost_per_kg"] is not None else None, r["nutrients"])
             for r in ctx.cur.fetchall()]
    if body.kind == "finished_feed":
        ctx.cur.execute("""select p.id, p.name, f.summary from public.products p
                           join lateral (select summary from public.formulations f
                                         where f.product_id=p.id and f.status='approved'
                                         order by version desc limit 1) f on true
                           where p.kind='premix' and p.active""")
        for r in ctx.cur.fetchall():
            s = r["summary"] or {}
            cands.append(Candidate("premix", str(r["id"]), r["name"], s.get("cost_per_kg"), s.get("nutrients") or {}))
    if body.only_listed:
        if not listed:
            raise HTTPException(422, "Add the ingredients to consider, or untick 'only use listed ingredients'")
        cands = [c for c in cands if (c.ref_type, c.ref_id) in listed]
    return optimize(cands, body.batch_size_kg, _dump_targets(body.targets), limits)


# ------------------------------------------------------------------ formulations
_LIST_COLS = ("id, product_id, version, kind, animal, batch_size_kg, status, created_at, created_by_email, "
              "submitted_at, reviewed_at, reviewed_by_email, review_note, summary, superseded_by_version, "
              "targets, lines, "
              "(select name from public.products p where p.id = product_id) as product_name")


def _refresh_summary(row: dict | None) -> dict | None:
    """Recompute derived values from the immutable ingredient snapshots on reads."""
    if row and row.get("lines") is not None and row.get("batch_size_kg") is not None:
        row["summary"] = _summary(row["lines"], float(row["batch_size_kg"]), row.get("targets") or {})
    return row


@router.get("/formulations")
def list_formulations(status: str | None = None, product_id: str | None = None, ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute(
        f"select {_LIST_COLS} from public.formulations where (%s::text is null or status=%s) "
        "and (%s::uuid is null or product_id=%s::uuid) order by created_at desc",
        [status, status, product_id, product_id])
    return [_refresh_summary(row) for row in ctx.cur.fetchall()]


@router.get("/formulations/{fid}")
def get_formulation(fid: str, ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute(f"select {_LIST_COLS}, notes, submitted_by_email from public.formulations where id=%s", [fid])
    row = ctx.cur.fetchone()
    if not row:
        raise HTTPException(404, "Recipe version not found")
    return _refresh_summary(row)


def _product(ctx: Ctx, pid: str) -> dict:
    ctx.cur.execute("select * from public.products where id=%s", [pid])
    p = ctx.cur.fetchone()
    if not p:
        raise HTTPException(404, "Product not found")
    return p


def _next_version(ctx: Ctx, pid: str) -> int:
    ctx.cur.execute("select coalesce(max(version),0)+1 as v from public.formulations where product_id=%s", [pid])
    return ctx.cur.fetchone()["v"]


def _insert_draft(ctx: Ctx, product: dict, body: RecipeBody, allow_inactive: bool = False, notes_prefix: str = "") -> dict:
    kind = product["kind"]
    targets = _dump_targets(body.targets)
    lines = resolve_lines(ctx, kind, [l for l in body.lines if l.quantity_kg > 0], allow_inactive=allow_inactive)
    if not lines:
        raise HTTPException(422, "Add at least one ingredient and quantity")
    summary = _summary(lines, body.batch_size_kg, targets)
    version = _next_version(ctx, product["id"])
    ctx.cur.execute(
        "insert into public.formulations (product_id, version, kind, animal, batch_size_kg, notes, targets, lines, summary) "
        "values (%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id",
        [product["id"], version, kind, body.animal, body.batch_size_kg, (notes_prefix + (body.notes or "")).strip() or None,
         _j(targets), _j(_store_lines(lines)), _j(summary)])
    fid = ctx.cur.fetchone()["id"]
    audit(ctx, "formulation_version_created", name=product["name"], version=version)
    return get_formulation(str(fid), ctx)


@router.post("/formulations", status_code=201)
def create_formulation(body: FormulationIn, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist", "formulator")
    product = _product(ctx, body.product_id)
    if not product["active"]:
        raise HTTPException(422, "This product is archived")
    return _insert_draft(ctx, product, body)


@router.put("/formulations/{fid}")
def update_draft(fid: str, body: RecipeBody, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist", "formulator")
    cur_row = get_formulation(fid, ctx)
    if cur_row["status"] != "draft":
        raise HTTPException(409, "Only draft versions can be edited. Create a new version instead.")
    targets = _dump_targets(body.targets)
    lines = resolve_lines(ctx, cur_row["kind"], [l for l in body.lines if l.quantity_kg > 0])
    if not lines:
        raise HTTPException(422, "Add at least one ingredient and quantity")
    summary = _summary(lines, body.batch_size_kg, targets)
    ctx.cur.execute(
        "update public.formulations set animal=%s, batch_size_kg=%s, notes=%s, targets=%s, lines=%s, summary=%s "
        "where id=%s and status='draft' returning id",
        [body.animal, body.batch_size_kg, body.notes, _j(targets), _j(_store_lines(lines)), _j(summary), fid])
    if not ctx.cur.fetchone():
        raise HTTPException(403, "You cannot edit this draft")
    audit(ctx, "formulation_draft_updated", name=cur_row["product_name"], version=cur_row["version"])
    return get_formulation(fid, ctx)


@router.post("/formulations/{fid}/submit")
def submit(fid: str, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist", "formulator")
    row = get_formulation(fid, ctx)
    if row["status"] != "draft":
        raise HTTPException(409, "Only drafts can be submitted")
    # Refresh prices and analyses so the reviewer sees what the data says today.
    stored = [calc_line for calc_line in row["lines"]]
    from .schemas import LineIn
    lines = resolve_lines(ctx, row["kind"], [LineIn(ref_type=l["ref_type"], ref_id=l["ref_id"], quantity_kg=l["quantity_kg"],
                                                    min_pct=l.get("min_pct"), max_pct=l.get("max_pct")) for l in stored])
    summary = _summary(lines, float(row["batch_size_kg"]), row["targets"])
    ctx.cur.execute("update public.formulations set status='pending', lines=%s, summary=%s where id=%s returning id",
                    [_j(_store_lines(lines)), _j(summary), fid])
    if not ctx.cur.fetchone():
        raise HTTPException(403, "You cannot submit this draft")
    audit(ctx, "formulation_submitted", name=row["product_name"], version=row["version"])
    return get_formulation(fid, ctx)


def _review(fid: str, approve: bool, body: ReviewIn, ctx: Ctx):
    ctx.require_role("admin", "nutritionist")
    row = get_formulation(fid, ctx)
    if row["status"] != "pending":
        raise HTTPException(409, "Only recipes awaiting approval can be reviewed")
    note = (body.note or "").strip() or None
    if not approve and not note:
        raise HTTPException(422, "Enter a reason so the formulator knows what to change")
    flags = (row["summary"] or {}).get("warnings") or []
    if approve and flags and not note:
        raise HTTPException(422, "This recipe has review flags (missing values, target misses or batch mismatch). "
                                 "A nutritionist review note is required to approve it.")
    ctx.cur.execute("update public.formulations set status=%s, review_note=%s where id=%s and status='pending' returning id",
                    ["approved" if approve else "rejected", note, fid])
    if not ctx.cur.fetchone():
        raise HTTPException(409, "This recipe is no longer awaiting approval")
    audit(ctx, "formulation_approved" if approve else "formulation_returned",
          name=row["product_name"], version=row["version"], flags=len(flags))
    return get_formulation(fid, ctx)


@router.post("/formulations/{fid}/approve")
def approve(fid: str, body: ReviewIn, ctx: Ctx = Depends(request_ctx)):
    return _review(fid, True, body, ctx)


@router.post("/formulations/{fid}/return")
def return_for_changes(fid: str, body: ReviewIn, ctx: Ctx = Depends(request_ctx)):
    return _review(fid, False, body, ctx)


@router.post("/formulations/{fid}/revise", status_code=201)
def revise(fid: str, ctx: Ctx = Depends(request_ctx)):
    """Copy any version into a new draft (the next version number); the old version stays unchanged."""
    ctx.require_role("admin", "nutritionist", "formulator")
    row = get_formulation(fid, ctx)
    product = _product(ctx, row["product_id"])
    from .schemas import LineIn, Range
    body = RecipeBody(
        animal=row["animal"], batch_size_kg=float(row["batch_size_kg"]), notes=None,
        targets={k: Range(**v) for k, v in (row["targets"] or {}).items()},
        lines=[LineIn(ref_type=l["ref_type"], ref_id=l["ref_id"], quantity_kg=l["quantity_kg"],
                      min_pct=l.get("min_pct"), max_pct=l.get("max_pct")) for l in row["lines"]])
    return _insert_draft(ctx, product, body, allow_inactive=True, notes_prefix=f"Revision of v{row['version']}. ")


# ------------------------------------------------------------------ batches
@router.get("/batches")
def list_batches(ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute("select * from public.batches order by produced_on desc, created_at desc")
    return ctx.cur.fetchall()


@router.get("/batches/{bid}")
def get_batch(bid: str, ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute("select * from public.batches where id=%s", [bid])
    row = ctx.cur.fetchone()
    if not row:
        raise HTTPException(404, "Batch not found")
    return row


@router.post("/batches", status_code=201)
def create_batch(body: BatchIn, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist", "formulator")
    f = get_formulation(body.formulation_id, ctx)
    if f["status"] != "approved":
        raise HTTPException(409, "Production batches can only be made from an approved recipe version")
    ctx.cur.execute("select name, active from public.products where id=%s", [f["product_id"]])
    p = ctx.cur.fetchone()
    if not p["active"]:
        raise HTTPException(409, "This product is archived")
    # Premix lines must still point at an approved premix.
    notes = []
    for l in f["lines"]:
        if l["ref_type"] == "premix" and not _approved_premix(ctx, l["ref_id"]):
            notes.append(l["name"])
    if notes:
        raise HTTPException(409, "Premix no longer approved: " + ", ".join(notes))
    n = body.batch_count
    scaled = [{"ref_type": l["ref_type"], "ref_id": l["ref_id"], "name": l["name"],
               "quantity_kg": round(l["quantity_kg"] * n, 4)} for l in f["lines"]]
    ctx.cur.execute(
        "insert into public.batches (formulation_id, product_id, product_name, version, batch_count, total_kg, lot, "
        "produced_on, prepared_by, lines) values (%s,%s,%s,%s,%s,%s,%s,coalesce(%s, current_date),%s,%s) returning *",
        [f["id"], f["product_id"], p["name"], f["version"], n, round(float(f["batch_size_kg"]) * n, 4),
         (body.lot or "").strip() or None, body.produced_on, (body.prepared_by or ctx.email), _j(scaled)])
    row = ctx.cur.fetchone()
    audit(ctx, "production_batch_created", name=p["name"], version=f["version"], lot=row["lot"])
    return row


# ------------------------------------------------------------------ reports
def _csv(rows: list[list], filename: str) -> Response:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return Response("﻿" + buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _gaps(ctx: Ctx) -> list[dict]:
    ctx.cur.execute("select id, name, cost_per_kg, nutrients from public.ingredients where active order by lower(name)")
    out = []
    for r in ctx.cur.fetchall():
        miss = []
        if r["cost_per_kg"] is None:
            miss.append("price")
        nm = [calc.LABELS[k].lower() for k in calc.NUTRIENT_KEYS if k not in calc.DERIVED_NUTRIENTS and (r["nutrients"] or {}).get(k) is None]
        if nm:
            miss.append("all nutrient values" if len(nm) == len(calc.NUTRIENT_KEYS) else ", ".join(nm))
        if miss:
            out.append({"id": str(r["id"]), "name": r["name"], "missing": miss})
    return out


@router.get("/reports/summary")
def report_summary(ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute("select status, count(*) n from public.formulations group by status")
    by = {r["status"]: r["n"] for r in ctx.cur.fetchall()}
    ctx.cur.execute("select coalesce(sum(total_kg),0) kg from public.batches where created_at >= now() - interval '30 days'")
    kg = float(ctx.cur.fetchone()["kg"])
    ctx.cur.execute("select count(*) n from public.products where active and kind <> 'material'")
    products = ctx.cur.fetchone()["n"]
    return {"approved": by.get("approved", 0), "pending": by.get("pending", 0), "draft": by.get("draft", 0),
            "kg_30d": kg, "gaps": len(_gaps(ctx)), "products": products}


def _recipe_report(ctx: Ctx) -> list[dict]:
    ctx.cur.execute("""
      select p.id, p.name, p.kind, f.version, f.status, f.batch_size_kg, f.summary, f.targets, f.lines
      from public.products p
      left join lateral (select * from public.formulations x where x.product_id=p.id order by version desc limit 1) f on true
      where p.active order by lower(p.name)""")
    rows = ctx.cur.fetchall()
    for row in rows:
        if row["version"] is not None and row["lines"] is not None:
            row["summary"] = _summary(row["lines"], float(row["batch_size_kg"]), row["targets"] or {})
    return rows


@router.get("/reports/recipes")
def report_recipes(format: str = "json", ctx: Ctx = Depends(request_ctx)):
    rows = _recipe_report(ctx)
    if format == "csv":
        head = ["Product", "Type", "Version", "Status", "Batch size kg", "Cost per kg"] + [f"{l} ({u})" for _, l, u in calc.NUTRIENTS] + ["Flags"]
        body = [[r["name"], r["kind"], r["version"] or "", r["status"] or "No recipe", r["batch_size_kg"] or "",
                 (r["summary"] or {}).get("cost_per_kg", "")] +
                [((r["summary"] or {}).get("nutrients") or {}).get(k, "") for k in calc.NUTRIENT_KEYS] +
                [" | ".join((r["summary"] or {}).get("warnings", []))] for r in rows]
        return _csv([head] + body, f"recipe-report-{date.today()}.csv")
    return rows


@router.get("/reports/batches")
def report_batches(date_from: date | None = Query(None, alias="from"), date_to: date | None = Query(None, alias="to"),
                   format: str = "json", ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute("select id, produced_on, lot, product_name, version, batch_count, total_kg, prepared_by from public.batches "
                    "where (%s::date is null or produced_on >= %s::date) and (%s::date is null or produced_on <= %s::date) "
                    "order by produced_on desc, created_at desc", [date_from, date_from, date_to, date_to])
    rows = ctx.cur.fetchall()
    if format == "csv":
        return _csv([["Date", "Lot / reference", "Product", "Recipe version", "Batches", "Total kg", "Prepared by"]] +
                    [[r["produced_on"], r["lot"] or "", r["product_name"], r["version"], r["batch_count"], r["total_kg"],
                      r["prepared_by"] or ""] for r in rows], f"batch-report-{date.today()}.csv")
    return rows


@router.get("/reports/gaps")
def report_gaps(ctx: Ctx = Depends(request_ctx)):
    return _gaps(ctx)


# ------------------------------------------------------------------ history, backup, team
@router.get("/events")
def events(limit: int = Query(100, le=500), ctx: Ctx = Depends(request_ctx)):
    ctx.cur.execute("select id, at, actor_email, event, details from public.audit_events order by id desc limit %s", [limit])
    return ctx.cur.fetchall()


@router.get("/backup")
def backup(ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin", "nutritionist")
    data = {}
    for t in ("products", "ingredients", "formulations", "batches", "audit_events"):
        ctx.cur.execute(f"select * from public.{t} order by 1")
        data[t] = ctx.cur.fetchall()
    payload = json.dumps({"application": "Choice Nutrition Feed Workspace", "exported_at": date.today().isoformat(),
                          "data": data}, default=str, indent=1)
    audit(ctx, "backup_exported")
    return Response(payload, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="choice-nutrition-backup-{date.today()}.json"'})


@router.get("/members")
def list_members(ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin")
    ctx.cur.execute("select * from public.company_members order by created_at")
    return ctx.cur.fetchall()


@router.post("/members", status_code=201)
def add_member(body: MemberIn, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin")
    ctx.cur.execute("insert into public.company_members (user_id, email, role, active) values (%s,%s,%s,%s) "
                    "on conflict (user_id) do update set role=excluded.role, active=excluded.active, "
                    "email=coalesce(excluded.email, public.company_members.email) returning *",
                    [body.user_id, body.email, body.role, body.active])
    row = ctx.cur.fetchone()
    audit(ctx, "member_saved", name=row["email"], role=row["role"])
    return row


@router.patch("/members/{uid}")
def patch_member(uid: str, body: MemberPatch, ctx: Ctx = Depends(request_ctx)):
    ctx.require_role("admin")
    if uid == ctx.user_id and (body.active is False or (body.role and body.role != "admin")):
        raise HTTPException(422, "You cannot remove your own administrator access")
    ctx.cur.execute("update public.company_members set role=coalesce(%s, role), active=coalesce(%s, active) "
                    "where user_id=%s returning *", [body.role, body.active, uid])
    row = ctx.cur.fetchone()
    if not row:
        raise HTTPException(404, "Member not found")
    audit(ctx, "member_updated", name=row["email"], role=row["role"], active=row["active"])
    return row
