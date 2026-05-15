from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import joblib
import pandas as pd
import numpy as np

app = FastAPI(title="F1 Predictor API")

# Allow frontend to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model on startup
model = joblib.load("model.pkl")
features = joblib.load("features.pkl")
df = pd.read_csv("../data/f1_master.csv")

@app.get("/")
def root():
    return {"message": "F1 Predictor API is running"}

@app.get("/drivers")
def get_drivers():
    drivers = df[['driverRef', 'driver_name']].drop_duplicates()
    return drivers.to_dict(orient="records")

@app.get("/races")
def get_races():
    races = df[['raceId', 'year', 'round', 'name_race', 'circuitRef']].drop_duplicates()
    races = races.sort_values(['year', 'round'], ascending=False)
    return races.head(100).to_dict(orient="records")

@app.get("/predict/{race_id}")
def predict_race(race_id: int):
    race_data = df[df['raceId'] == race_id].copy()
    if race_data.empty:
        return {"error": "Race not found"}
    
    X = race_data[features]
    race_data['podium_probability'] = model.predict_proba(X)[:, 1]
    
    result = race_data[['driver_name', 'podium_probability', 'grid', 'positionOrder', 'podium']]
    result = result.sort_values('podium_probability', ascending=False)
    return result.to_dict(orient="records")