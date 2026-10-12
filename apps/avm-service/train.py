"""Entrenamiento del modelo. El dataset DEBE tener la columna price_usd (nunca ARS)."""
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor

df = pd.read_csv("listings_usd.csv")  # columnas: ver Features en main.py + price_usd
assert "price_usd" in df.columns, "El dataset debe estar en USD"

df["n_amenities"] = df["amenities"].fillna("").apply(lambda s: len([a for a in str(s).split("|") if a]))
df["usd_m2"] = df["price_usd"] / df["covered_m2"]
y = np.log1p(df["usd_m2"])
X = pd.get_dummies(df[["neighborhood", "property_type", "covered_m2", "total_m2", "rooms",
                       "bathrooms", "garage_spots", "age_years", "lat", "lng", "n_amenities"]])

X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)
model = XGBRegressor(n_estimators=500, max_depth=6, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8)
model.fit(X_tr, y_tr)

# Rango de confianza empírico a partir del error relativo en test
ratio = np.expm1(model.predict(X_te)) / np.expm1(y_te)
q_low, q_high = np.quantile(1 / ratio, [0.1, 0.9])
mape = float(np.mean(np.abs(1 - ratio)))

joblib.dump({"model": model, "columns": list(X.columns), "q_low": float(q_low),
             "q_high": float(q_high), "confidence": max(0.0, 1 - mape)}, "model.joblib")
print(f"MAPE test: {mape:.2%}")
