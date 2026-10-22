# Mag-Null Architecture Overview

## 1. Desktop application

Electron manages the desktop window and Python backend lifecycle.
The frontend communicates through a restricted preload API and a local
backend endpoint. The backend should bind only to 127.0.0.1.

## 2. Synthetic simulation pipeline

Scenario engine
  -> synthetic source models
  -> virtual channel and receiver
  -> synthetic measurements
  -> detection
  -> feature extraction
  -> classification
  -> temporal association and tracking
  -> events and alerts
  -> publishing and selected persistence

## 3. Ground-truth isolation

The simulator owns scenario parameters and hidden ground truth.
The analysis pipeline receives synthetic measurements, not hidden
ground truth. Evaluation compares analysis outputs against ground truth
afterward, using a separate evaluation component.

## 4. Initial engineering targets

- Spectrum frame: 512 bins.
- Display update target: approximately 13 frames per second.
- Six scenarios: idle, hobby, FPV, DJI-like, swarm, and silent.
- Avoid persisting every spectrum frame by default.
- Use deterministic seeds for reproducible tests.

These are simulation targets, not real-world receiver specifications.

## 5. Module responsibilities

- simulation: scenario orchestration and synthetic measurement generation
- processing: signal-region detection and feature extraction
- classification: synthetic signal-category estimates and confidence
- tracking: temporal association of analysis observations
- alerts: rule-based severity and event generation
- persistence: session metadata, selected events, and settings
- reports: session summaries and evaluation metrics
- api: validated HTTP and WebSocket interfaces
- core: configuration, logging, lifecycle, and shared runtime services

## 6. Quality requirements

Test reproducibility, schema validation, detection metrics, false alarms,
classification precision and recall, tracking continuity, latency,
resource usage, recovery behavior, and auditability.

## 7. Scope boundary

The initial release is simulation-only. Hardware receivers, real RF
capture, and external device integrations are not part of Phase 1.
