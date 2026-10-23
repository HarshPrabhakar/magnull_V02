
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query

from simulation.spectrum import generate_spectrum

app = FastAPI(
    title="Mag-Null Backend",
    description="Simulation-only RF analysis service",
    version="0.1.0",
)


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "magnull-backend",
        "mode": "simulation",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/spectrum")
def get_spectrum(
    scenario: str = Query(default="idle"),
    seed: int = Query(default=42, ge=0, le=2147483647),
):
    try:
        return generate_spectrum(scenario=scenario, seed=seed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
