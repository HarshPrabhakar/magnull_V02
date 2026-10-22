# Mag-Null

Mag-Null is a simulation-first desktop application for synthetic RF
spectrum monitoring, signal analysis, event visualization, and evaluation.

## Phase 1 objectives

- Generate reproducible synthetic RF spectrum frames.
- Display a 512-bin spectrum and a scrolling waterfall.
- Provide six configurable synthetic scenarios.
- Detect synthetic signal regions and extract features.
- Classify generated signals with explicitly labeled confidence.
- Maintain software analysis contacts and event histories.
- Provide tiered alerts, session history, and reports.
- Test correctness, repeatability, performance, and fault handling.

## Architecture

- Desktop shell: Electron
- Frontend: React, TypeScript, and Vite
- Backend: Python, FastAPI, and WebSockets
- Scientific processing: NumPy and SciPy
- Persistence: SQLite and SQLAlchemy
- Shared API contracts: validated request and event schemas

## Safety and interpretation

Phase 1 uses synthetic data only. Simulated detections and classifications
are not evidence of real-world RF activity, drone identity, location,
intent, or movement.

The simulation ground truth must remain separate from the analysis
pipeline. Evaluation may compare analysis results with ground truth only
after the analysis output has been produced.

## Development

The Python environment is stored locally in `.venv`.
Do not commit virtual environments, secrets, local databases, or build
artifacts.

See `docs/architecture/overview.md` for the initial architecture.
