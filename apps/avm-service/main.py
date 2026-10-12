"""Microservicio de tasación (AVM). Todo en USD: el modelo se entrena con precios en dólares."""
import os
from typing import List, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_VERSION = "xgb-usd-v1"
MODEL_PATH = os.getenv("MODEL_PATH", "model.joblib")
# Plusvalía anual esperada (a calibrar con datos históricos reales por barrio).
DEFAULT_ANNUAL_APPRECIATION = 0.035

app = FastAPI(title="AVM Argentina (USD)")
_bundle = None


def get_bundle():
    """Carga perezosa: el servicio arranca aunque todavía no se haya entrenado el modelo."""
    global _bundle
    if _bundle is None:
        if not os.path.exists(MODEL_PATH):
            raise HTTPException(status_code=503, detail="Modelo no entrenado: ejecutá train.py y montá model.joblib")
        _bundle = joblib.load(MODEL_PATH)  # {"model", "columns", "q_low", "q_high", "confidence"}
    return _bundle


class Features(BaseModel):
    neighborhood: str
    city: Optional[str] = None
    property_type: str
    covered_m2: float
    total_m2: Optional[float] = None
    rooms: Optional[int] = 0
    bathrooms: Optional[int] = 0
    garage_spots: Optional[int] = 0
    age_years: Optional[float] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    amenities: List[str] = []


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": os.path.exists(MODEL_PATH)}


@app.post("/predict")
def predict(f: Features):
    bundle = get_bundle()
    row = pd.DataFrame([f.model_dump()])
    row["n_amenities"] = len(f.amenities)
    row = row.drop(columns=["amenities", "city"])
    X = pd.get_dummies(row).reindex(columns=bundle["columns"], fill_value=0)

    # El modelo predice USD/m2 en log; así se estabiliza la varianza entre barrios.
    usd_m2 = float(np.expm1(bundle["model"].predict(X)[0]))
    price = usd_m2 * f.covered_m2
    low = price * bundle["q_low"]
    high = price * bundle["q_high"]
    projected = price * (1 + DEFAULT_ANNUAL_APPRECIATION) ** 3

    return {
        "estimated_price_usd": round(price, 2),
        "range_low_usd": round(low, 2),
        "range_high_usd": round(high, 2),
        "projected_price_3y_usd": round(projected, 2),
        "appreciation_3y_pct": round((projected / price - 1) * 100, 2),
        "confidence": round(float(bundle.get("confidence", 0.8)), 2),
        "model_version": MODEL_VERSION,
    }
