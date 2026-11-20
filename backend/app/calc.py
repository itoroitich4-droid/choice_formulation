"""Recipe maths: weighted nutrient values, cost and review flags. Pure functions, no database access."""
from __future__ import annotations

from typing import Any

NUTRIENTS: list[tuple[str, str, str]] = [
    ("availability", "Availability", "%"), ("dm", "DM", "%"),
    ("me", "ME", "kcal/g"), ("de", "D.E", "kcal/g"),
    ("protein", "Crude protein", "%"), ("tdn", "TDN", "%"),
    ("fat", "Fat", "%"), ("fibre", "Fibre", "%"),
    ("calcium", "Calcium", "%"), ("phosphorus", "Total P", "%"),
    ("available_phosphorus", "Avail. Phosphorus", "%"), ("ca_p_ratio", "Ca:P Ratio", ":1"),
    ("sodium", "Sodium", "%"), ("chloride", "Chloride", "%"),
    ("lysine", "Lysine", "%"), ("methionine", "Methionine", "%"),
    ("ap_lysine", "AP Lysine", "%"), ("ap_methionine", "AP Methionine", "%"),
    ("ap_tsaa", "AP TSAA", "%"), ("ap_threonine", "AP Threonine", "%"),
    ("ap_tryptophan", "AP Tryptophan", "%"), ("ap_arginine", "AP Arginine", "%"),
    ("ap_valine", "AP Valine", "%"), ("ap_isoleucine", "AP Isoleucine", "%"),
    ("ap_histidine", "AP Histidine", "%"), ("ap_leucine", "AP Leucine", "%"),
    ("rup", "RUP", "%"), ("starch", "Starch", "%"),
    ("adf", "ADF", "%"), ("ndf", "NDF", "%"), ("ash", "Ash", "%"),
]
DERIVED_NUTRIENTS = {"ca_p_ratio"}
NUTRIENT_KEYS = [k for k, _, _ in NUTRIENTS]
LABELS = {k: label for k, label, _ in NUTRIENTS}
LIMIT_TOL_PP = 0.001
BATCH_TOL_KG = 0.01


def _num(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def active_targets(targets: dict | None) -> dict[str, dict[str, float | None]]:
    out = {}
    for k, r in (targets or {}).items():
        if k in LABELS and isinstance(r, dict):
            lo, hi = _num(r.get("min")), _num(r.get("max"))
            if lo is not None or hi is not None:
                out[k] = {"min": lo, "max": hi}
    return out


def summarize(lines: list[dict], batch_size_kg: float, targets: dict | None) -> dict:
    """lines: [{name, quantity_kg, min_pct, max_pct, snapshot:{cost_per_kg, nutrients}|None, inactive?}]"""
    warnings: list[str] = []
    tg = active_targets(targets)
    qty = [(_num(l.get("quantity_kg")) or 0.0) for l in lines]
    total = sum(qty)
    if total <= 0:
        return {"total_kg": 0.0, "cost": None, "cost_per_kg": None,
                "nutrients": {k: None for k in NUTRIENT_KEYS}, "warnings": ["Enter ingredient quantities."]}

    cost, cost_ok = 0.0, True
    for l, q in zip(lines, qty):
        snap = l.get("snapshot")
        name = l.get("name") or "A recipe line"
        if not snap:
            warnings.append(f"{name} has no ingredient or approved premix record.")
            cost_ok = False
            continue
        if l.get("inactive"):
            warnings.append(f"{name} is archived.")
        c = _num(snap.get("cost_per_kg"))
        if c is None:
            if q > 0:
                warnings.append(f"{name} has no cost entered.")
            cost_ok = False
        else:
            cost += q * c

    nutrients: dict[str, float | None] = {}
    for k in NUTRIENT_KEYS:
        if k in DERIVED_NUTRIENTS:
            continue
        acc, complete = 0.0, True
        for l, q in zip(lines, qty):
            if q <= 0:
                continue
            v = _num(((l.get("snapshot") or {}).get("nutrients") or {}).get(k))
            if v is None:
                complete = False
                break
            acc += q * v
        nutrients[k] = acc / total if complete else None
        if not complete and k in tg:
            warnings.append(f"{LABELS[k]} is incomplete because at least one ingredient has no value.")

    calcium, phosphorus = nutrients.get("calcium"), nutrients.get("phosphorus")
    nutrients["ca_p_ratio"] = calcium / phosphorus if calcium is not None and phosphorus not in (None, 0) else None

    for l, q in zip(lines, qty):
        pct = q / total * 100
        lo, hi = _num(l.get("min_pct")), _num(l.get("max_pct"))
        name = l.get("name") or "An ingredient"
        if lo is not None and pct < lo - LIMIT_TOL_PP:
            warnings.append(f"{name} is at {pct:.2f}%, below its {lo:g}% minimum inclusion.")
        if hi is not None and pct > hi + LIMIT_TOL_PP:
            warnings.append(f"{name} is at {pct:.2f}%, above its {hi:g}% maximum inclusion.")

    if abs(total - batch_size_kg) > BATCH_TOL_KG:
        warnings.append(f"Recipe quantities total {total:.3f} kg, while the stated batch size is {batch_size_kg:.3f} kg.")
    if not tg:
        warnings.append("No nutrient target ranges are set for this recipe.")
    for k, r in tg.items():
        v = nutrients.get(k)
        if v is None:
            continue
        if r["min"] is not None and v < r["min"] - 1e-9:
            warnings.append(f"{LABELS[k]} is below the minimum target.")
        if r["max"] is not None and v > r["max"] + 1e-9:
            warnings.append(f"{LABELS[k]} is above the maximum target.")

    return {"total_kg": total, "cost": cost if cost_ok else None,
            "cost_per_kg": cost / total if cost_ok else None, "nutrients": nutrients, "warnings": warnings}