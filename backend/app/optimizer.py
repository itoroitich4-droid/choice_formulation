"""Least-cost formulation with SciPy's linprog (HiGHS).

Variables are each material's fraction of the batch (0..1, sum = 1). A material's inclusion limits become
variable bounds; nutrient targets become min/max constraints; Ca:P ratio is enforced as a calcium-to-phosphorus blend ratio. Only materials with
a price and a value for every targeted nutrient are eligible - the optimizer never guesses missing data."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.optimize import linprog

from .calc import LABELS, active_targets, summarize

ZERO = 1e-7


@dataclass
class Candidate:
    ref_type: str            # 'ingredient' | 'premix'
    ref_id: str
    name: str
    cost_per_kg: float | None
    nutrients: dict[str, Any]


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def optimize(candidates: list[Candidate], batch_size_kg: float, targets: dict | None,
             limits: dict[tuple[str, str], tuple[float | None, float | None]]) -> dict:
    tg = active_targets(targets)
    if batch_size_kg <= 0:
        return {"status": "error", "message": "Enter a positive batch size."}
    if not tg:
        return {"status": "error", "message": "Set at least one nutrient target before optimizing."}

    eligible: list[Candidate] = []
    excluded: list[dict] = []
    for c in candidates:
        cost = _num(c.cost_per_kg)
        missing = [LABELS[k] for k in tg if any(_num(c.nutrients.get(req)) is None for req in (("calcium", "phosphorus") if k == "ca_p_ratio" else (k,)))]
        if cost is None or cost < 0:
            excluded.append({"name": c.name, "reason": "no price"})
        elif missing:
            excluded.append({"name": c.name, "reason": "no value for " + ", ".join(m.lower() for m in missing)})
        else:
            eligible.append(c)
    if not eligible:
        return {"status": "error", "message": "No materials have a price and values for every targeted nutrient.",
                "excluded": excluded}

    # A limited material that cannot be modelled would silently break the user's rule - say so.
    elig_keys = {(c.ref_type, c.ref_id) for c in eligible}
    for (rt, rid), (lo, _hi) in limits.items():
        if lo and lo > 0 and (rt, rid) not in elig_keys:
            name = next((c.name for c in candidates if (c.ref_type, c.ref_id) == (rt, rid)), "An ingredient")
            return {"status": "error", "excluded": excluded,
                    "message": f"{name} has a minimum inclusion but lacks a price or a value for a targeted nutrient, so it cannot be optimized."}

    n = len(eligible)
    cost = np.array([float(c.cost_per_kg) for c in eligible])
    bounds = []
    for c in eligible:
        lo, hi = limits.get((c.ref_type, c.ref_id), (None, None))
        bounds.append(((lo or 0.0) / 100.0, (hi if hi is not None else 100.0) / 100.0))
    if any(b[0] > b[1] + 1e-12 for b in bounds):
        return {"status": "infeasible", "message": "An ingredient minimum is above its maximum.", "excluded": excluded}

    A_ub, b_ub, rows = [], [], []     # rows: (nutrient key, 'min'|'max')
    for k, r in tg.items():
        if k == "ca_p_ratio":
            ca = np.array([float(_num(c.nutrients.get("calcium"))) for c in eligible])
            ph = np.array([float(_num(c.nutrients.get("phosphorus"))) for c in eligible])
            if r["min"] is not None:
                A_ub.append(-ca + r["min"] * ph); b_ub.append(0.0); rows.append((k, "min"))
            if r["max"] is not None:
                A_ub.append(ca - r["max"] * ph); b_ub.append(0.0); rows.append((k, "max"))
            continue
        v = np.array([float(_num(c.nutrients.get(k))) for c in eligible])
        if r["min"] is not None:
            A_ub.append(-v); b_ub.append(-r["min"]); rows.append((k, "min"))
        if r["max"] is not None:
            A_ub.append(v); b_ub.append(r["max"]); rows.append((k, "max"))
    A_eq, b_eq = np.ones((1, n)), np.array([1.0])
    A_ub_a, b_ub_a = (np.array(A_ub), np.array(b_ub)) if A_ub else (None, None)

    res = linprog(cost, A_ub=A_ub_a, b_ub=b_ub_a, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
    if res.status == 2:
        return {"status": "infeasible", "excluded": excluded,
                "message": "No mix meets every target and ingredient limit.",
                "achievable": _achievable(eligible, tg, bounds, A_eq, b_eq)}
    if res.status == 3 or not res.success:
        return {"status": "error", "excluded": excluded,
                "message": "The optimizer could not find a bounded solution. Check ingredient prices."}

    frac = np.where(res.x < ZERO, 0.0, res.x)
    qty = np.round(frac * batch_size_kg, 4)
    diff = round(batch_size_kg - float(qty.sum()), 4)         # push rounding residue into the largest line
    if diff and qty.max() > 0:
        qty[int(qty.argmax())] = round(qty[int(qty.argmax())] + diff, 4)

    out_lines = [
        {"ref_type": c.ref_type, "ref_id": c.ref_id, "name": c.name, "quantity_kg": float(q),
         "pct": round(float(q) / batch_size_kg * 100, 4)}
        for c, q in zip(eligible, qty) if q > 0
    ]
    snap_lines = [
        {"name": c.name, "quantity_kg": float(q),
         "min_pct": limits.get((c.ref_type, c.ref_id), (None, None))[0],
         "max_pct": limits.get((c.ref_type, c.ref_id), (None, None))[1],
         "snapshot": {"cost_per_kg": c.cost_per_kg, "nutrients": c.nutrients}}
        for c, q in zip(eligible, qty) if q > 0
    ]
    s = summarize(snap_lines, batch_size_kg, targets)
    if s["warnings"]:
        return {
            "status": "rounded_infeasible",
            "message": "The rounded recipe no longer meets every target or inclusion limit. Increase the batch size or adjust the targets/limits, then optimize again.",
            "warnings": s["warnings"],
            "lines": out_lines,
            "cost": s["cost"],
            "cost_per_kg": s["cost_per_kg"],
            "nutrients": s["nutrients"],
            "excluded": excluded,
        }
    binding = []
    marg = getattr(getattr(res, "ineqlin", None), "marginals", None)
    if marg is not None:
        for (k, side), m in zip(rows, marg):
            if abs(m) > 1e-9:
                binding.append({"nutrient": k, "label": LABELS[k], "side": side})
    for c, f, (lo, hi) in zip(eligible, frac, bounds):
        if (c.ref_type, c.ref_id) in limits and (abs(f - hi) < 1e-7 or (lo > 0 and abs(f - lo) < 1e-7)):
            binding.append({"ingredient": c.name, "side": "max" if abs(f - hi) < 1e-7 else "min"})
    return {
        "status": "optimal", "lines": out_lines, "cost": s["cost"], "cost_per_kg": s["cost_per_kg"],
        "nutrients": s["nutrients"], "binding": binding, "excluded": excluded,
    }


def _achievable(eligible, tg, bounds, A_eq, b_eq) -> dict:
    """Best and worst average the ingredient limits allow for each targeted nutrient, to explain infeasibility."""
    out = {}
    for k in tg:
        if k == "ca_p_ratio":
            ca = np.array([float(_num(c.nutrients.get("calcium"))) for c in eligible])
            ph = np.array([float(_num(c.nutrients.get("phosphorus"))) for c in eligible])
            lo = linprog(ca, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
            hi = linprog(-ca, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
            # Ratio extrema are nonlinear; report attainable calcium and phosphorus ranges instead.
            out[k] = {"label": LABELS[k], "note": "Ratio limits are enforced directly; range summary is unavailable."}
            continue
        v = np.array([float(_num(c.nutrients.get(k))) for c in eligible])
        lo = linprog(v, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
        hi = linprog(-v, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
        if lo.success and hi.success:
            out[k] = {"label": LABELS[k], "lowest": float(lo.fun), "highest": float(-hi.fun)}
    return out
