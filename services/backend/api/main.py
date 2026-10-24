
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query

from simulation.spectrum import generate_spectrum

from fastapi.middleware.cors import CORSMiddleware

import asyncio

from fastapi import WebSocket, WebSocketDisconnect

app = FastAPI(
    title="Mag-Null Backend",
    description="Simulation-only RF analysis service",
    version="0.1.0",
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
            frame_seed = (seed + frame_id) % 2147483647

            spectrum = generate_spectrum(
                scenario=scenario,
                seed=seed,
                frame_id=frame_id,
            )

            await websocket.send_json({
                "frame_id": frame_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **spectrum,
            })

            frame_id += 1
            await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        pass