
import asyncio
import hashlib
import json
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from schemas.spectrum import SpectrumFrame
from simulation.spectrum import generate_spectrum


SIM_VERSION = "0.1.0"

app = FastAPI(
    title="Mag-Null Backend",
    description="Simulation-only RF analysis service",
    version=SIM_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def build_config_hash(scenario: str, bins: int, seed: int) -> str:
    """Hash the canonical effective configuration used by the generator."""
    config = {
        "sim_version": SIM_VERSION,
        "scenario": scenario,
        "bins": bins,
        "seed": seed,
        "noise_floor": -80.0,
        "noise_std": 2.0,
        "peak_counts": {
            "idle": 0,
            "hobby": 2,
            "fpv": 3,
            "multi": 6,
        },
        "peak_width_range": [2, 7],
        "peak_amplitude_range": [12.0, 28.0],
    }

    canonical = json.dumps(config, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_spectrum_frame(
    scenario: str,
    seed: int,
    frame_id: int = 0,
    bins: int = 512,
) -> dict:
    spectrum = generate_spectrum(
        scenario=scenario,
        bins=bins,
        seed=seed,
        frame_id=frame_id,
    )

    frame = {
        **spectrum,
        "source": "simulated",
        "sim_version": SIM_VERSION,
        "config_hash": build_config_hash(scenario, bins, seed),
        "frame_id": frame_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    return SpectrumFrame.model_validate(frame).model_dump()


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
        return build_spectrum_frame(scenario=scenario, seed=seed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.websocket("/ws/spectrum")
async def stream_spectrum(
    websocket: WebSocket,
    scenario: str = "idle",
    seed: int = 42,
):
    supported_scenarios = {"idle", "hobby", "fpv", "multi"}

    if scenario not in supported_scenarios:
        await websocket.close(code=1008, reason="Unsupported scenario")
        return

    if seed < 0 or seed > 2147483647:
        await websocket.close(code=1008, reason="Invalid seed")
        return

    await websocket.accept()
    frame_id = 0

    try:
        while True:
            try:
                frame = build_spectrum_frame(
                    scenario=scenario,
                    seed=seed,
                    frame_id=frame_id,
                )
            except ValueError as exc:
                await websocket.close(code=1011, reason=str(exc))
                return

            await websocket.send_json(frame)
            frame_id += 1
            await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        pass
