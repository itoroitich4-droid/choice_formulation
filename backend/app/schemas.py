from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .calc import NUTRIENT_KEYS

Kind = Literal["premix", "finished_feed"]
Role = Literal["admin", "nutritionist", "formulator", "viewer"]


class Range(BaseModel):
    min: float | None = Field(None, ge=0)
    max: float | None = Field(None, ge=0)

    @model_validator(mode="after")
    def _order(self):
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("a minimum cannot be higher than its maximum")
        return self


def _check_keys(d: dict, what: str):
    bad = [k for k in d if k not in NUTRIENT_KEYS]
    if bad:
        raise ValueError(f"Unknown {what}: {', '.join(bad)}")
    return d


class IngredientIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str | None = None
    cost_per_kg: float | None = Field(None, ge=0)
    pack: str | None = None
    source: str | None = None
    nutrients: dict[str, float | None] = {}

    @field_validator("name")
    @classmethod
    def _strip(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("nutrients")
    @classmethod
    def _nut(cls, v):
        _check_keys(v, "nutrient")
        if "ca_p_ratio" in v:
            raise ValueError("Ca:P Ratio is calculated from calcium and total phosphorus")
        if any(x is not None and x < 0 for x in v.values()):
            raise ValueError("nutrient values cannot be negative")
        return {k: x for k, x in v.items() if x is not None}


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Kind
    animal: str | None = None
    pack: str | None = None
    description: str | None = None
    targets: dict[str, Range] = {}

    @field_validator("targets")
    @classmethod
    def _t(cls, v):
        return _check_keys(v, "nutrient")


class LineIn(BaseModel):
    ref_type: Literal["ingredient", "premix"]
    ref_id: str
    quantity_kg: float = Field(0, ge=0)
    min_pct: float | None = Field(None, ge=0, le=100)
    max_pct: float | None = Field(None, ge=0, le=100)

    @model_validator(mode="after")
    def _order(self):
        if self.min_pct is not None and self.max_pct is not None and self.min_pct > self.max_pct:
            raise ValueError("a minimum inclusion cannot be higher than its maximum")
        return self


class RecipeBody(BaseModel):
    animal: str | None = None
    batch_size_kg: float = Field(gt=0)
    notes: str | None = None
    targets: dict[str, Range] = {}
    lines: list[LineIn] = []

    @field_validator("targets")
    @classmethod
    def _t(cls, v):
        return _check_keys(v, "nutrient")


class FormulationIn(RecipeBody):
    product_id: str


class CalcIn(RecipeBody):
    kind: Kind


class OptimizeIn(BaseModel):
    kind: Kind
    batch_size_kg: float = Field(gt=0)
    targets: dict[str, Range] = {}
    lines: list[LineIn] = []          # limits are read from these lines
    only_listed: bool = False         # restrict the search to the listed materials

    @field_validator("targets")
    @classmethod
    def _t(cls, v):
        return _check_keys(v, "nutrient")


class ReviewIn(BaseModel):
    note: str | None = None


class BatchIn(BaseModel):
    formulation_id: str
    batch_count: float = Field(gt=0, le=100000)
    lot: str | None = None
    produced_on: date | None = None
    prepared_by: str | None = None


class MemberIn(BaseModel):
    user_id: str
    email: str | None = None
    role: Role
    active: bool = True


class MemberPatch(BaseModel):
    role: Role | None = None
    active: bool | None = None
