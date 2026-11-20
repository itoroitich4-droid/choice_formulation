import pytest

N = {"protein": 8, "me": 3.3, "fibre": 3, "calcium": 0.1, "phosphorus": 0.3, "lysine": 0.3, "methionine": 0.2}


def ing(client, h, name, cost, protein, me, **kw):
    body = {"name": name, "cost_per_kg": cost, "nutrients": {"protein": protein, "me": me,
            "fibre": 2, "calcium": 0.1, "phosphorus": 0.2, "lysine": 0.4, "methionine": 0.2}, **kw}
    r = client.post("/api/ingredients", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def product(client, h, name, kind="premix"):
    r = client.post("/api/products", json={"name": name, "kind": kind, "animal": "Test"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


TARGETS = {"protein": {"min": 14}, "me": {"min": 2.8}}


def recipe(pid, lines, batch=100, targets=TARGETS):
    return {"product_id": pid, "animal": "Test", "batch_size_kg": batch, "targets": targets,
            "lines": [{"ref_type": "ingredient", "ref_id": i, "quantity_kg": q} for i, q in lines]}


# ---------------------------------------------------------------- auth
def test_requires_sign_in(client, users):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_non_member_is_refused(client, users):
    assert client.get("/api/ingredients", headers=users["outsider"]["h"]).status_code == 403


def test_me_reports_role(client, users):
    r = client.get("/api/me", headers=users["nutritionist"]["h"]).json()
    assert r["role"] == "nutritionist" and len(r["nutrients"]) == 31


# ---------------------------------------------------------------- roles
def test_role_permissions(client, users):
    a, n, f, v = (users[k]["h"] for k in ("admin", "nutritionist", "formulator", "viewer"))
    assert client.post("/api/ingredients", json={"name": "X"}, headers=f).status_code == 403
    assert client.post("/api/ingredients", json={"name": "X"}, headers=v).status_code == 403
    iid = ing(client, n, "Maize", 40, 8, 3300)
    assert client.put(f"/api/ingredients/{iid}", json={"name": "Maize2"}, headers=f).status_code == 403
    assert client.post(f"/api/ingredients/{iid}/active?active=false", headers=f).status_code == 403
    assert client.post("/api/products", json={"name": "P", "kind": "premix"}, headers=v).status_code == 403
    pid = product(client, f, "Formulator product")          # formulators may add products
    assert client.put(f"/api/products/{pid}", json={"name": "Renamed", "kind": "premix"}, headers=f).status_code == 403
    assert client.get("/api/members", headers=n).status_code == 403
    assert client.get("/api/members", headers=a).status_code == 200
    assert len(client.get("/api/ingredients", headers=v).json()) == 1       # viewers can read


# ---------------------------------------------------------------- workflow
def make_approved_premix(client, users, name="Layer Premix", note=None):
    n, f = users["nutritionist"]["h"], users["formulator"]["h"]
    m = ing(client, n, f"Maize-{name}", 40, 16, 3300)
    pid = product(client, f, name)
    r = client.post("/api/formulations", json=recipe(pid, [(m, 100)]), headers=f)
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    assert client.post(f"/api/formulations/{fid}/submit", headers=f).status_code == 200
    r = client.post(f"/api/formulations/{fid}/approve", json={"note": note}, headers=n)
    return pid, m, fid, r


def test_full_workflow_and_versioning(client, users):
    n, f, v = users["nutritionist"]["h"], users["formulator"]["h"], users["viewer"]["h"]
    pid, m, fid, r = make_approved_premix(client, users)
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert r.json()["reviewed_by_email"] == "nutritionist@choice.test"

    # approved version is immutable through the API
    assert client.put(f"/api/formulations/{fid}", json={"batch_size_kg": 50, "lines": []}, headers=n).status_code == 409
    # new version supersedes the old one on approval
    r2 = client.post(f"/api/formulations/{fid}/revise", headers=f)
    assert r2.status_code == 201 and r2.json()["version"] == 2 and r2.json()["status"] == "draft"
    fid2 = r2.json()["id"]
    client.post(f"/api/formulations/{fid2}/submit", headers=f)
    assert client.post(f"/api/formulations/{fid2}/approve", json={}, headers=n).status_code == 200
    rows = {x["version"]: x["status"] for x in client.get(f"/api/formulations?product_id={pid}", headers=v).json()}
    assert rows == {1: "superseded", 2: "approved"}

    # batch sheet
    r = client.post("/api/batches", json={"formulation_id": fid2, "batch_count": 3, "lot": "L-1"}, headers=f)
    assert r.status_code == 201 and r.json()["total_kg"] == "300.0000" or float(r.json()["total_kg"]) == 300
    assert float(r.json()["lines"][0]["quantity_kg"]) == 300
    assert client.post("/api/batches", json={"formulation_id": fid, "batch_count": 1}, headers=f).status_code == 409  # superseded
    assert client.post("/api/batches", json={"formulation_id": fid2, "batch_count": 1}, headers=v).status_code == 403


def test_only_reviewers_approve_and_flags_need_note(client, users):
    n, f = users["nutritionist"]["h"], users["formulator"]["h"]
    m = ing(client, n, "Maize", 40, 8, 3300)             # protein 8% -> misses the 14% target -> flag
    pid = product(client, f, "Flagged")
    fid = client.post("/api/formulations", json=recipe(pid, [(m, 100)]), headers=f).json()["id"]
    client.post(f"/api/formulations/{fid}/submit", headers=f)
    assert client.post(f"/api/formulations/{fid}/approve", json={}, headers=f).status_code == 403
    r = client.post(f"/api/formulations/{fid}/approve", json={}, headers=n)
    assert r.status_code == 422 and "review note" in r.json()["detail"]
    assert client.post(f"/api/formulations/{fid}/return", json={}, headers=n).status_code == 422
    r = client.post(f"/api/formulations/{fid}/approve", json={"note": "Accepted: protein supplied in feed"}, headers=n)
    assert r.status_code == 200 and r.json()["review_note"].startswith("Accepted")


def test_return_for_changes_then_new_version(client, users):
    n, f = users["nutritionist"]["h"], users["formulator"]["h"]
    m = ing(client, n, "Maize", 40, 16, 3300)
    pid = product(client, f, "P")
    fid = client.post("/api/formulations", json=recipe(pid, [(m, 100)]), headers=f).json()["id"]
    client.post(f"/api/formulations/{fid}/submit", headers=f)
    r = client.post(f"/api/formulations/{fid}/return", json={"note": "Lower maize"}, headers=n)
    assert r.json()["status"] == "rejected"
    assert client.post(f"/api/formulations/{fid}/submit", headers=f).status_code == 409
    assert client.post(f"/api/formulations/{fid}/revise", headers=f).json()["version"] == 2


def test_formulator_cannot_touch_others_drafts(client, users):
    n, f, f2 = users["nutritionist"]["h"], users["formulator"]["h"], users["formulator2"]["h"]
    m = ing(client, n, "Maize", 40, 16, 3300)
    pid = product(client, f, "P")
    fid = client.post("/api/formulations", json=recipe(pid, [(m, 100)]), headers=f).json()["id"]
    r = client.put(f"/api/formulations/{fid}", json={"batch_size_kg": 100, "lines": [{"ref_type": "ingredient", "ref_id": m, "quantity_kg": 100}]}, headers=f2)
    assert r.status_code == 403
    assert client.post(f"/api/formulations/{fid}/submit", headers=f2).status_code == 403
    assert client.post(f"/api/formulations/{fid}/submit", headers=n).status_code == 200      # reviewer may


def test_finished_feed_uses_approved_premix_snapshot(client, users):
    n, f = users["nutritionist"]["h"], users["formulator"]["h"]
    ppid, m, pfid, _ = make_approved_premix(client, users)
    feed = product(client, f, "Layer Mash", "finished_feed")
    body = {"product_id": feed, "animal": "Layers", "batch_size_kg": 100, "targets": {"protein": {"min": 10}},
            "lines": [{"ref_type": "ingredient", "ref_id": m, "quantity_kg": 95},
                      {"ref_type": "premix", "ref_id": ppid, "quantity_kg": 5}]}
    r = client.post("/api/formulations", json=body, headers=f)
    assert r.status_code == 201, r.text
    assert r.json()["summary"]["nutrients"]["protein"] == pytest.approx(16)
    assert r.json()["lines"][1]["snapshot"]["premix_version"] == 1
    # premix in a premix recipe is refused
    body["product_id"] = product(client, f, "Other premix")
    assert client.post("/api/formulations", json=body, headers=f).status_code == 422
    # draft premix (not approved) cannot be used
    draft = product(client, f, "Unapproved premix")
    bad = {**body, "product_id": feed, "lines": [{"ref_type": "premix", "ref_id": draft, "quantity_kg": 5}]}
    assert client.post("/api/formulations", json=bad, headers=f).status_code == 422


def test_inclusion_limits_flag_in_summary(client, users):
    n, f = users["nutritionist"]["h"], users["formulator"]["h"]
    m = ing(client, n, "Maize", 40, 16, 3300)
    pid = product(client, f, "P")
    body = recipe(pid, [(m, 100)])
    body["lines"][0]["max_pct"] = 50
    r = client.post("/api/formulations", json=body, headers=f).json()
    assert any("above its 50% maximum" in w for w in r["summary"]["warnings"])
    assert r["lines"][0]["max_pct"] == 50


def test_validation(client, users):
    n, f = users["nutritionist"]["h"], users["formulator"]["h"]
    m = ing(client, n, "Maize", 40, 16, 3300)
    pid = product(client, f, "P")
    assert client.post("/api/ingredients", json={"name": "Bad", "nutrients": {"zinc": 3}}, headers=n).status_code == 422
    assert client.post("/api/ingredients", json={"name": "Maize"}, headers=n).status_code == 409      # duplicate name
    bad = recipe(pid, [(m, 100)])
    bad["lines"][0].update(min_pct=60, max_pct=40)
    assert client.post("/api/formulations", json=bad, headers=f).status_code == 422
    bad = recipe(pid, [(m, 100)], targets={"protein": {"min": 20, "max": 10}})
    assert client.post("/api/formulations", json=bad, headers=f).status_code == 422
    assert client.post("/api/formulations", json=recipe(pid, []), headers=f).status_code == 422


# ---------------------------------------------------------------- database enforces the rules itself
def test_database_rules_hold_without_the_api(users, admin_db, client):
    """Connect as an authenticated formulator directly and try to cheat."""
    import json
    import psycopg
    import os
    TEST_DB = os.environ['DATABASE_URL']
    n, f = users["nutritionist"]["h"], users["formulator"]["h"]
    m = ing(client, n, "Maize", 40, 16, 3300)
    pid = product(client, f, "P")
    fid = client.post("/api/formulations", json=recipe(pid, [(m, 100)]), headers=f).json()["id"]
    client.post(f"/api/formulations/{fid}/submit", headers=f)
    uid = users["formulator"]["id"]

    def as_user(sql, *params):
        with psycopg.connect(TEST_DB) as c:
            c.execute("select set_config('request.jwt.claims', %s, true)", [json.dumps({"sub": uid, "email": "x"})])
            c.execute("set local role authenticated")
            return c.execute(sql, params)

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user("update public.formulations set status='approved' where id=%s", fid)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user("update public.formulations set batch_size_kg=1 where id=%s", fid)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user("delete from public.formulations where id=%s", fid)
    assert as_user("update public.ingredients set cost_per_kg=0").rowcount == 0     # RLS hides the rows from writes
    assert float(admin_db.execute("select cost_per_kg from public.ingredients").fetchone()[0]) == 40


# ---------------------------------------------------------------- optimizer
def seed_opt(client, n):
    return (ing(client, n, "Maize", 40, 8, 3300), ing(client, n, "Soya", 80, 44, 2400), ing(client, n, "Bran", 25, 12, 1800))


def test_optimizer_matches_hand_calculation(client, users):
    n = users["nutritionist"]["h"]
    m, s, b = seed_opt(client, n)
    body = {"kind": "premix", "batch_size_kg": 100, "targets": {"protein": {"min": 16}, "me": {"min": 2.8}}, "lines": []}
    r = client.post("/api/optimize", json=body, headers=n).json()
    assert r["status"] == "optimal"
    q = {l["name"]: l["quantity_kg"] for l in r["lines"]}
    assert q["Maize"] == pytest.approx(58.7301, abs=1e-3) and q["Bran"] == pytest.approx(21.4286, abs=1e-3)
    assert r["cost"] == pytest.approx(4472.22, abs=0.01)
    assert sum(q.values()) == pytest.approx(100, abs=1e-6)

    body["lines"] = [{"ref_type": "ingredient", "ref_id": m, "quantity_kg": 0, "max_pct": 55}]
    r = client.post("/api/optimize", json=body, headers=n).json()
    q = {l["name"]: l["quantity_kg"] for l in r["lines"]}
    assert q["Maize"] == pytest.approx(55) and r["cost"] == pytest.approx(4929.17, abs=0.01)
    assert any(x.get("ingredient") == "Maize" for x in r["binding"])

    body["lines"][0]["max_pct"] = 40                      # impossible: explain why
    r = client.post("/api/optimize", json=body, headers=n).json()
    assert r["status"] == "infeasible" and r["achievable"]["me"]["highest"] == pytest.approx(2.76)


def test_optimizer_only_listed_and_missing_data(client, users):
    n = users["nutritionist"]["h"]
    m, s, b = seed_opt(client, n)
    client.post("/api/ingredients", json={"name": "NoPrice", "nutrients": {"protein": 50, "me": 3.0}}, headers=n)
    body = {"kind": "premix", "batch_size_kg": 100, "targets": {"protein": {"min": 16}, "me": {"min": 2.8}},
            "only_listed": True, "lines": [{"ref_type": "ingredient", "ref_id": x, "quantity_kg": 0} for x in (m, s)]}
    r = client.post("/api/optimize", json=body, headers=n).json()
    assert r["status"] == "optimal" and {l["name"] for l in r["lines"]} <= {"Maize", "Soya"}
    body["only_listed"] = False
    r = client.post("/api/optimize", json=body, headers=n).json()
    assert {"name": "NoPrice", "reason": "no price"} in r["excluded"]
    assert client.post("/api/optimize", json={**body, "targets": {}}, headers=n).json()["status"] == "error"


def test_optimizer_min_limit_on_unmodellable_item(client, users):
    n = users["nutritionist"]["h"]
    seed_opt(client, n)
    x = client.post("/api/ingredients", json={"name": "NoData"}, headers=n).json()["id"]
    body = {"kind": "premix", "batch_size_kg": 100, "targets": {"protein": {"min": 16}},
            "lines": [{"ref_type": "ingredient", "ref_id": x, "quantity_kg": 0, "min_pct": 5}]}
    r = client.post("/api/optimize", json=body, headers=n).json()
    assert r["status"] == "error" and "minimum inclusion" in r["message"]


# ---------------------------------------------------------------- reports / history / backup
def test_reports_and_history(client, users):
    n, f = users["nutritionist"]["h"], users["formulator"]["h"]
    pid, m, fid, _ = make_approved_premix(client, users)
    client.post("/api/ingredients", json={"name": "Empty"}, headers=n)
    client.post("/api/batches", json={"formulation_id": fid, "batch_count": 2, "lot": "A"}, headers=f)
    s = client.get("/api/reports/summary", headers=f).json()
    assert s["approved"] == 1 and s["kg_30d"] == 200 and s["gaps"] == 1
    assert client.get("/api/reports/gaps", headers=f).json()[0]["name"] == "Empty"
    rr = client.get("/api/reports/recipes", headers=f).json()
    assert rr[0]["status"] == "approved"
    csvr = client.get("/api/reports/batches?format=csv", headers=f)
    assert csvr.headers["content-type"].startswith("text/csv") and "Layer Premix" in csvr.text
    assert client.get("/api/reports/batches?from=2999-01-01", headers=f).json() == []
    ev = client.get("/api/events", headers=f).json()
    assert {"formulation_approved", "production_batch_created"} <= {e["event"] for e in ev}
    assert client.get("/api/backup", headers=f).status_code == 403
    b = client.get("/api/backup", headers=n)
    assert b.status_code == 200 and "formulations" in b.json()["data"]


def test_admin_manages_members(client, users, admin_db):
    a = users["admin"]["h"]
    o = users["outsider"]
    r = client.post("/api/members", json={"user_id": o["id"], "email": o["email"], "role": "viewer"}, headers=a)
    assert r.status_code == 201
    assert client.get("/api/me", headers=o["h"]).json()["role"] == "viewer"
    assert client.patch(f"/api/members/{o['id']}", json={"active": False}, headers=a).status_code == 200
    assert client.get("/api/me", headers=o["h"]).status_code == 403
    assert client.patch(f"/api/members/{users['admin']['id']}", json={"role": "viewer"}, headers=a).status_code == 422
