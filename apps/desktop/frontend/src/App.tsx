import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  connectSpectrumStream,
  type ScenarioId,
  type SpectrumData,
  type SpectrumFrame,
} from "./services/spectrumApi";

const WATERFALL_ROWS = 20;
const BAND_START_MHZ = 2400;
const BAND_END_MHZ = 2480;
const MAX_ALERTS = 40;

type Contact = {
  id: string;
  protocol: string;
  classification: string;
  confidence: number;
  frequencyMHz: number;
  relativePower: number;
  hopEstimate: number;
  status: string;
  threat: "LOW" | "MEDIUM" | "HIGH";
};

type Alert = {
  id: number;
  time: string;
  message: string;
  level: "INFO" | "WARNING" | "CRITICAL";
};

const scenarios: {
  id: ScenarioId;
  name: string;
  button: string;
  description: string;
}[] = [
    {
      id: "idle",
      name: "Idle Environment",
      button: "IDLE",
      description: "Background noise only",
    },
    {
      id: "hobby",
      name: "Hobby Signals",
      button: "HOBBY",
      description: "Intermittent synthetic signals",
    },
    {
      id: "fpv",
      name: "FPV-style Signals",
      button: "FPV",
      description: "Synthetic FPV-style signal patterns",
    },
    {
      id: "multi",
      name: "Multiple Sources",
      button: "MULTI",
      description: "Overlapping synthetic signal sources",
    },
  ];

const protocolLabels = [
  "AFHDS-like",
  "ELRS-like",
  "DJI-like",
  "FASST-like",
  "Unknown",
];

const classificationLabels = [
  "Control-link-like",
  "Telemetry-like",
  "Video-link-like",
  "Hopping-like",
  "Unclassified",
];

function getWaterfallColor(value: number): string {
  const normalized = Math.max(0, Math.min(1, (value + 90) / 50));

  if (normalized < 0.2) return "#030612";
  if (normalized < 0.4) return "#102334";
  if (normalized < 0.58) return "#15515b";
  if (normalized < 0.73) return "#178b83";
  if (normalized < 0.86) return "#d4a72c";
  return "#ff542e";
}

function WaterfallCanvas({
  rows,
  maxRows,
  label,
}: {
  rows: number[][];
  maxRows: number;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;

    const width = Math.max(1, ...rows.map((row) => row.length));
    const image = context.createImageData(width, maxRows);
    const firstRow = maxRows - rows.length;

    rows.forEach((row, rowIndex) => {
      row.forEach((value, binIndex) => {
        const color = getWaterfallColor(value);
        const offset = ((firstRow + rowIndex) * width + binIndex) * 4;
        image.data[offset] = Number.parseInt(color.slice(1, 3), 16);
        image.data[offset + 1] = Number.parseInt(color.slice(3, 5), 16);
        image.data[offset + 2] = Number.parseInt(color.slice(5, 7), 16);
        image.data[offset + 3] = 255;
      });
    });

    canvas.width = width;
    canvas.height = maxRows;
    context.putImageData(image, 0, 0);
  }, [rows, maxRows]);

  return (
    <canvas
      ref={canvasRef}
      className="waterfall-canvas"
      role="img"
      aria-label={label}
    />
  );
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return "--:--:--";

  const date = new Date(timestamp);

  if (!Number.isFinite(date.getTime())) return "--:--:--";

  return date.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getScenarioName(scenario: ScenarioId): string {
  return scenarios.find((item) => item.id === scenario)?.name ?? scenario;
}

/**
 * These are demonstration estimates derived from synthetic spectrum peaks.
 * They are not protocol decoding or real drone identification.
 */
function estimateContacts(
  spectrum: SpectrumData | null,
  scenario: ScenarioId,
): Contact[] {
  if (!spectrum || scenario === "idle") return [];

  const values = spectrum.power;
  const candidates: { index: number; power: number }[] = [];

  for (let i = 2; i < values.length - 2; i += 1) {
    const value = values[i];

    if (
      value > -69 &&
      value >= values[i - 1] &&
      value >= values[i + 1] &&
      value >= values[i - 2] &&
      value >= values[i + 2]
    ) {
      candidates.push({ index: i, power: value });
    }
  }

  candidates.sort((a, b) => b.power - a.power);

  const minimumSeparation = 9;
  const peaks: typeof candidates = [];

  for (const candidate of candidates) {
    if (
      peaks.every(
        (peak) => Math.abs(peak.index - candidate.index) >= minimumSeparation,
      )
    ) {
      peaks.push(candidate);
    }

    if (peaks.length >= (scenario === "multi" ? 6 : 4)) break;
  }

  return peaks.map((peak, index) => {
    const frequencyMHz =
      BAND_START_MHZ +
      (peak.index / Math.max(1, values.length - 1)) *
      (BAND_END_MHZ - BAND_START_MHZ);

    const protocol =
      scenario === "fpv"
        ? "Video-link-like"
        : protocolLabels[(index + spectrum.seed) % protocolLabels.length];

    const classification =
      scenario === "fpv"
        ? "FPV-style candidate"
        : classificationLabels[
        (index + spectrum.seed) % classificationLabels.length
        ];

    const confidence = Math.min(
      95,
      Math.max(35, Math.round(45 + (peak.power + 80) * 2)),
    );

    const threat: Contact["threat"] =
      peak.power > -48 ? "HIGH" : peak.power > -58 ? "MEDIUM" : "LOW";

    return {
      id: `SIM-${String(index + 1).padStart(3, "0")}`,
      protocol,
      classification,
      confidence,
      frequencyMHz,
      relativePower: peak.power,
      hopEstimate: 0,
      status: "SIMULATED",
      threat,
    };
  });
}

function App() {
  const [selectedScenario, setSelectedScenario] = useState<ScenarioId>("idle");
  type Workspace =
    | "Overview"
    | "Spectrum"
    | "Waterfall"
    | "Detections"
    | "Tracking"
    | "Settings";
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [spectrum, setSpectrum] = useState<SpectrumFrame | null>(null);
  const [waterfallRows, setWaterfallRows] = useState<number[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [frameRate, setFrameRate] = useState(0);
  const [showOnlyStrong, setShowOnlyStrong] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const previousContactIdsRef = useRef<string[]>([]);
  const alertIdRef = useRef(0);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>("Overview");
  const addAlert = useCallback(
    (message: string, level: Alert["level"] = "INFO") => {
      const alert: Alert = {
        id: ++alertIdRef.current,
        time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
        message,
        level,
      };

      setAlerts((previous) => [alert, ...previous].slice(0, MAX_ALERTS));
    },
    [],
  );

  const stopSimulation = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;

    if (socket) {
      socket.close();
    }

    setSimulationRunning(false);
    setLoading(false);
    setBackendConnected(false);
    addAlert("Simulation stream stopped", "INFO");
  }, [addAlert]);

  const startSimulation = useCallback(() => {
    const previousSocket = socketRef.current;
    socketRef.current = null;

    if (previousSocket) previousSocket.close();

    setSimulationRunning(true);
    setLoading(true);
    setError(null);
    setSpectrum(null);
    setWaterfallRows([]);
    setBackendConnected(false);
    setAlerts([]);
    setFrameRate(0);

    frameTimesRef.current = [];
    previousContactIdsRef.current = [];

    addAlert(`Starting ${getScenarioName(selectedScenario)}`, "INFO");

    const socket = connectSpectrumStream(
      selectedScenario,
      (frame: SpectrumFrame) => {
        if (socketRef.current !== socket) return;

        setSpectrum(frame);
        setWaterfallRows((previous) =>
          [...previous, frame.power].slice(-WATERFALL_ROWS),
        );

        const now = Date.now();
        frameTimesRef.current = [
          ...frameTimesRef.current.filter((time) => now - time < 2000),
          now,
        ];

        setFrameRate(
          Math.max(0, Math.round((frameTimesRef.current.length - 1) / 2)),
        );

        setLoading(false);
        setBackendConnected(true);
      },
      (message: string) => {
        if (socketRef.current !== socket) return;

        setError(message);
        setLoading(false);
        setBackendConnected(false);
        setSimulationRunning(false);
        socketRef.current = null;
        socket.close();

        addAlert(`Backend error: ${message}`, "CRITICAL");
      },
    );

    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;

      setBackendConnected(true);
      addAlert("WebSocket connected to local simulator", "INFO");
    };

    socket.onclose = () => {
      if (socketRef.current !== socket) return;

      socketRef.current = null;
      setBackendConnected(false);
      setLoading(false);
      setSimulationRunning(false);
      addAlert("Simulation stream disconnected", "WARNING");
    };
  }, [selectedScenario, addAlert]);

  useEffect(() => {
    return () => {
      const socket = socketRef.current;
      socketRef.current = null;

      if (socket) socket.close();
    };
  }, []);

  const contacts = estimateContacts(spectrum, selectedScenario);
  const visibleContacts = showOnlyStrong
    ? contacts.filter((contact) => contact.relativePower > -58)
    : contacts;

  const strongestPower =
    spectrum && spectrum.power.length ? Math.max(...spectrum.power) : null;

  const averagePower =
    spectrum && spectrum.power.length
      ? spectrum.power.reduce((sum, value) => sum + value, 0) /
      spectrum.power.length
      : null;

  const scenarioName = getScenarioName(selectedScenario);

  const chartPoints = spectrum
    ? spectrum.power
      .map((value, index) => {
        const x = (index / Math.max(spectrum.power.length - 1, 1)) * 1000;
        const y = ((0 - value) / 80) * 300;

        return `${x.toFixed(2)},${Math.max(0, Math.min(300, y)).toFixed(2)}`;
      })
      .join(" ")
    : "";

  const threatCount = contacts.filter(
    (contact) => contact.threat === "HIGH",
  ).length;

  return (
    <div
      className={`app-shell console-shell ${activeWorkspace === "Overview" ? "overview-workspace" : ""
        }`}
    >
      <header className="console-header">
        <div className="console-brand">
          <span className="brand-mark">M</span>
          <div>
            <h1>MAG-NULL</h1>
            <span>RF SPECTRUM ANALYSIS CONSOLE</span>
          </div>
        </div>

        <div
          className={`system-state ${error ? "state-critical" : backendConnected ? "state-active" : "state-idle"}`}
        >
          <span className="status-dot" />
          {error ? "ERROR" : backendConnected ? "ACTIVE" : "STANDBY"}
        </div>

        <div className="contact-counter">
          <strong>{contacts.length}</strong>
          <span>SIM CONTACTS</span>
        </div>
      </header>
      <nav className="workspace-nav" aria-label="Main navigation">
        {(
          [
            "Overview",
            "Spectrum",
            "Waterfall",
            "Detections",
            "Tracking",
            "Settings",
          ] as Workspace[]
        ).map((workspace) => (
          <button
            key={workspace}
            type="button"
            className={`workspace-tab ${activeWorkspace === workspace ? "active" : ""
              }`}
            aria-current={activeWorkspace === workspace ? "page" : undefined}
            onClick={() => setActiveWorkspace(workspace)}
          >
            {workspace}
          </button>
        ))}
      </nav>

      <nav className="scenario-toolbar" aria-label="Simulation scenarios">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            className={`console-button ${selectedScenario === scenario.id ? "selected" : ""}`}
            aria-pressed={selectedScenario === scenario.id}
            disabled={simulationRunning}
            onClick={() => setSelectedScenario(scenario.id)}
          >
            {scenario.button}
          </button>
        ))}

        <div className="toolbar-spacer" />

        <span className="simulation-label">
          <span className="status-dot" />
          SIMULATED DATA
        </span>

        {!simulationRunning ? (
          <button
            type="button"
            className="console-button action-button"
            onClick={startSimulation}
          >
            ▶ START
          </button>
        ) : (
          <button
            type="button"
            className="console-button stop-action"
            onClick={stopSimulation}
          >
            ■ STOP
          </button>
        )}
      </nav>

      {activeWorkspace === "Overview" ? (
        <main className="console-main">
          <section className="monitor-column">
            <article className="console-panel spectrum-console-panel">
              <div className="console-panel-heading">
                <span>SPECTRUM ANALYSIS</span>
                <span>
                  {BAND_START_MHZ}–{BAND_END_MHZ} MHz · SIMULATED BAND
                </span>
                <span className="heading-spacer" />
                <span>
                  {spectrum ? `FRAME ${spectrum.frame_id}` : "NO FRAME"}
                </span>
              </div>

              <div className="main-spectrum-chart">
                <div className="spectrum-y-axis">
                  <span>0 dB</span>
                  <span>-20 dB</span>
                  <span>-40 dB</span>
                  <span>-60 dB</span>
                  <span>-80 dB</span>
                </div>

                <div className="spectrum-plot">
                  <div className="plot-grid">
                    {Array.from({ length: 5 }, (_, index) => (
                      <i key={index} />
                    ))}
                  </div>

                  {spectrum ? (
                    <svg
                      viewBox="0 0 1000 300"
                      preserveAspectRatio="none"
                      role="img"
                      aria-label="Live simulated spectrum"
                    >
                      <polyline
                        points={chartPoints}
                        fill="none"
                        stroke="#00d8aa"
                        strokeWidth="1.7"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  ) : (
                    <div className="console-empty">
                      <strong>
                        {loading
                          ? "CONNECTING TO SIMULATOR"
                          : "AWAITING SPECTRUM"}
                      </strong>
                      <span>
                        {error ??
                          "Start a scenario to receive synthetic spectrum frames"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="spectrum-axis">
                <span>{BAND_START_MHZ} MHz</span>
                <span>FREQUENCY →</span>
                <span>{BAND_END_MHZ} MHz</span>
              </div>

              <div className="spectrum-readouts">
                <div>
                  <span>PEAK RELATIVE POWER</span>
                  <strong>
                    {strongestPower === null
                      ? "—"
                      : `${strongestPower.toFixed(1)} dB`}
                  </strong>
                </div>
                <div>
                  <span>AVERAGE RELATIVE POWER</span>
                  <strong>
                    {averagePower === null
                      ? "—"
                      : `${averagePower.toFixed(1)} dB`}
                  </strong>
                </div>
                <div>
                  <span>BIN COUNT</span>
                  <strong>{spectrum?.bin_count ?? 512}</strong>
                </div>
                <div>
                  <span>FRAME RATE</span>
                  <strong>{frameRate} FPS</strong>
                </div>
              </div>
            </article>

            <article className="console-panel waterfall-console-panel">
              <div className="console-panel-heading">
                <span>WATERFALL SPECTROGRAM</span>
                <span>FREQUENCY × TIME</span>
                <span className="heading-spacer" />
                <span>
                  {waterfallRows.length}/{WATERFALL_ROWS} ROWS
                </span>
              </div>

              <div className="waterfall-display">
                {waterfallRows.length === 0 ? (
                  <div className="console-empty">
                    <strong>NO WATERFALL HISTORY</strong>
                    <span>
                      Start a simulation to populate the time-frequency display
                    </span>
                  </div>
                ) : (
                  <WaterfallCanvas
                    rows={waterfallRows}
                    maxRows={WATERFALL_ROWS}
                    label="Simulated waterfall spectrogram, newest frame at bottom"
                  />
                )}
              </div>

              <div className="waterfall-axis">
                <span>OLDER ↓</span>
                <span>
                  {BAND_START_MHZ} MHz — {BAND_END_MHZ} MHz
                </span>
                <span>NEWER ↓</span>
              </div>

              <div className="heatmap-legend">
                <span>LOW</span>
                <div className="heatmap-gradient" />
                <span>HIGH RELATIVE POWER</span>
              </div>
            </article>

            <article className="console-panel contacts-panel">
              <div className="console-panel-heading">
                <span>SIMULATED SIGNAL CONTACTS</span>
                <span>{contacts.length} CANDIDATES</span>
                <span className="heading-spacer" />
                <label className="compact-checkbox">
                  <input
                    type="checkbox"
                    checked={showOnlyStrong}
                    onChange={(event) =>
                      setShowOnlyStrong(event.target.checked)
                    }
                  />
                  Strong signals only
                </label>
              </div>

              <div className="contact-table-wrap">
                <table className="contact-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>PROTOCOL FAMILY*</th>
                      <th>CLASSIFICATION*</th>
                      <th>CONF.</th>
                      <th>FREQ. MHz</th>
                      <th>REL. POWER</th>
                      <th>HOPS</th>
                      <th>THREAT*</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleContacts.length ? (
                      visibleContacts.map((contact) => (
                        <tr key={contact.id}>
                          <td className="contact-id">{contact.id}</td>
                          <td>{contact.protocol}</td>
                          <td>{contact.classification}</td>
                          <td>{contact.confidence}%</td>
                          <td>{contact.frequencyMHz.toFixed(2)}</td>
                          <td>{contact.relativePower.toFixed(1)} dB</td>
                          <td>{contact.hopEstimate}</td>
                          <td
                            className={`threat-${contact.threat.toLowerCase()}`}
                          >
                            {contact.threat}
                          </td>
                          <td>{contact.status}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9} className="table-empty">
                          {selectedScenario === "idle"
                            ? "No synthetic signal candidates in this scenario."
                            : "No peaks passed the current demonstration threshold."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="table-disclaimer">
                * Demonstration-only heuristic labels. Protocol decoding,
                hopping estimation, and real drone classification are not
                implemented.
              </div>
            </article>
          </section>

          <aside className="console-side-column">
            <article className="console-panel side-panel alerts-panel">
              <div className="console-panel-heading">
                <span>SYSTEM ALERTS</span>
                <span>{alerts.length}</span>
              </div>

              <div className="alerts-list">
                {alerts.length ? (
                  alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`alert-item alert-${alert.level.toLowerCase()}`}
                    >
                      <span>{alert.time}</span>
                      <strong>{alert.level}</strong>
                      <p>{alert.message}</p>
                    </div>
                  ))
                ) : (
                  <div className="side-empty">No system alerts</div>
                )}
              </div>
            </article>

            <article className="console-panel side-panel scenario-info-panel">
              <div className="console-panel-heading">
                <span>ACTIVE SCENARIO</span>
              </div>
              <div className="scenario-info">
                <strong>{scenarioName.toUpperCase()}</strong>
                <span>
                  {
                    scenarios.find((item) => item.id === selectedScenario)
                      ?.description
                  }
                </span>
                <span>Mode: SIMULATION ONLY</span>
                <span>Seed: {spectrum?.seed ?? 42}</span>
                <span>
                  Simulation version: {spectrum?.sim_version ?? "0.1.0"}
                </span>
                <span className="hash-label">CONFIG HASH</span>
                <code>{spectrum?.config_hash ?? "Awaiting frame"}</code>
              </div>
            </article>

            <article className="console-panel side-panel contact-summary-panel">
              <div className="console-panel-heading">
                <span>CONTACT SUMMARY</span>
              </div>
              <div className="summary-metric">
                <span>SIMULATED CANDIDATES</span>
                <strong>{contacts.length}</strong>
              </div>
              <div className="summary-metric">
                <span>HIGH POWER CANDIDATES*</span>
                <strong className={threatCount ? "text-warning" : ""}>
                  {threatCount}
                </strong>
              </div>
              <div className="summary-metric">
                <span>CLASSIFICATION SOURCE</span>
                <strong>HEURISTIC</strong>
              </div>
              <p className="panel-disclaimer">
                These counts describe synthetic peaks, not confirmed aircraft or
                threats.
              </p>
            </article>

            <article className="console-panel side-panel classification-panel">
              <div className="console-panel-heading">
                <span>CLASSIFICATION CATEGORIES</span>
              </div>
              {[
                ["CONTROL-LINK-LIKE", "#00d8aa"],
                ["TELEMETRY-LIKE", "#45b9ff"],
                ["VIDEO-LINK-LIKE", "#e9b949"],
                ["HOPPING-LIKE", "#a78bfa"],
                ["UNKNOWN / UNCLASSIFIED", "#8b98a8"],
              ].map(([label, color]) => (
                <div className="classification-row" key={label}>
                  <span
                    className="classification-dot"
                    style={{ background: color }}
                  />
                  <span>{label}</span>
                </div>
              ))}
              <p className="panel-disclaimer">
                Categories are UI placeholders until protocol-specific features
                are implemented.
              </p>
            </article>
          </aside>
        </main>

      ) : (
        <main className="workspace-page">
          {activeWorkspace === "Spectrum" && (
            <section className="workspace-content">
              <div className="workspace-title">
                <div>
                  <h2>SPECTRUM ANALYSIS</h2>
                  <p>Live simulated frequency-domain measurements</p>
                </div>
                <span className="workspace-badge">
                  {backendConnected ? "CONNECTED" : "STANDBY"}
                </span>
              </div>

              <article className="console-panel spectrum-console-panel">
                <div className="console-panel-heading">
                  <span>LIVE SPECTRUM</span>
                  <span>{BAND_START_MHZ}–{BAND_END_MHZ} MHz</span>
                  <span className="heading-spacer" />
                  <span>
                    {spectrum ? `FRAME ${spectrum.frame_id}` : "NO FRAME"}
                  </span>
                </div>

                <div className="main-spectrum-chart">
                  <div className="spectrum-y-axis">
                    <span>0 dB</span>
                    <span>-20 dB</span>
                    <span>-40 dB</span>
                    <span>-60 dB</span>
                    <span>-80 dB</span>
                  </div>

                  <div className="spectrum-plot">
                    <div className="plot-grid">
                      {Array.from({ length: 5 }, (_, index) => (
                        <i key={index} />
                      ))}
                    </div>

                    {spectrum ? (
                      <svg
                        viewBox="0 0 1000 300"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label="Live simulated spectrum"
                      >
                        <polyline
                          points={chartPoints}
                          fill="none"
                          stroke="#00d8aa"
                          strokeWidth="1.7"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    ) : (
                      <div className="console-empty">
                        <strong>
                          {loading ? "CONNECTING" : "AWAITING SPECTRUM"}
                        </strong>
                        <span>
                          {error ?? "Start the simulation to receive frames"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="spectrum-axis">
                  <span>{BAND_START_MHZ} MHz</span>
                  <span>FREQUENCY →</span>
                  <span>{BAND_END_MHZ} MHz</span>
                </div>
              </article>

              <div className="workspace-metrics">
                <article className="console-panel">
                  <span>PEAK RELATIVE POWER</span>
                  <strong>
                    {strongestPower === null
                      ? "—"
                      : `${strongestPower.toFixed(1)} dB`}
                  </strong>
                </article>
                <article className="console-panel">
                  <span>AVERAGE RELATIVE POWER</span>
                  <strong>
                    {averagePower === null
                      ? "—"
                      : `${averagePower.toFixed(1)} dB`}
                  </strong>
                </article>
                <article className="console-panel">
                  <span>BIN COUNT</span>
                  <strong>{spectrum?.bin_count ?? 512}</strong>
                </article>
                <article className="console-panel">
                  <span>FRAME RATE</span>
                  <strong>{frameRate} FPS</strong>
                </article>
              </div>

              <p className="panel-disclaimer">
                Measurements use simulated relative dB values, not calibrated
                dBm. Frequency is mapped across the configured demonstration
                band.
              </p>
            </section>
          )}

          {activeWorkspace === "Waterfall" && (
            <section className="workspace-content">
              <div className="workspace-title">
                <div>
                  <h2>WATERFALL ANALYSIS</h2>
                  <p>Signal power across frequency and time</p>
                </div>
                <span className="workspace-badge">
                  {waterfallRows.length}/{WATERFALL_ROWS} FRAMES
                </span>
              </div>

              <article className="console-panel">
                <div className="console-panel-heading">
                  <span>WATERFALL SPECTROGRAM</span>
                  <span>FREQUENCY × TIME</span>
                </div>

                <div className="waterfall-display workspace-waterfall">
                  {waterfallRows.length === 0 ? (
                    <div className="console-empty">
                      <strong>NO WATERFALL HISTORY</strong>
                      <span>
                        Start the simulation to populate the time-frequency
                        display
                      </span>
                    </div>
                  ) : (
                    <WaterfallCanvas
                      rows={waterfallRows}
                      maxRows={WATERFALL_ROWS}
                      label="Simulated waterfall spectrogram"
                    />
                  )}
                </div>

                <div className="waterfall-axis">
                  <span>OLDER ↑</span>
                  <span>{BAND_START_MHZ}–{BAND_END_MHZ} MHz</span>
                  <span>NEWER ↓</span>
                </div>

                <div className="heatmap-legend">
                  <span>LOW</span>
                  <div className="heatmap-gradient" />
                  <span>HIGH RELATIVE POWER</span>
                </div>
              </article>

              <div className="workspace-metrics">
                <article className="console-panel">
                  <span>RETAINED FRAMES</span>
                  <strong>{waterfallRows.length}</strong>
                </article>
                <article className="console-panel">
                  <span>BIN COUNT</span>
                  <strong>{spectrum?.bin_count ?? 512}</strong>
                </article>
                <article className="console-panel">
                  <span>FRAME RATE</span>
                  <strong>{frameRate} FPS</strong>
                </article>
              </div>

              <p className="panel-disclaimer">
                History is held in application memory. Session persistence and
                time/frequency measurements are not implemented yet.
              </p>
            </section>
          )}

          {activeWorkspace === "Detections" && (
            <section className="workspace-content">
              <div className="workspace-title">
                <div>
                  <h2>DETECTION CANDIDATES</h2>
                  <p>Peak-based estimates from synthetic spectrum frames</p>
                </div>
                <span className="workspace-badge">
                  {visibleContacts.length} CANDIDATES
                </span>
              </div>

              <article className="console-panel contacts-panel">
                <div className="console-panel-heading">
                  <span>CANDIDATE REGISTER</span>
                  <span>HEURISTIC ANALYSIS</span>
                  <span className="heading-spacer" />
                  <label className="compact-checkbox">
                    <input
                      type="checkbox"
                      checked={showOnlyStrong}
                      onChange={(event) =>
                        setShowOnlyStrong(event.target.checked)
                      }
                    />
                    Strong signals only
                  </label>
                </div>

                <div className="contact-table-wrap">
                  <table className="contact-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>PROTOCOL FAMILY*</th>
                        <th>CLASSIFICATION*</th>
                        <th>CONF.</th>
                        <th>FREQ. MHz</th>
                        <th>REL. POWER</th>
                        <th>HOPS</th>
                        <th>LEVEL*</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleContacts.length > 0 ? (
                        visibleContacts.map((contact) => (
                          <tr key={contact.id}>
                            <td className="contact-id">{contact.id}</td>
                            <td>{contact.protocol}</td>
                            <td>{contact.classification}</td>
                            <td>{contact.confidence}%</td>
                            <td>{contact.frequencyMHz.toFixed(2)}</td>
                            <td>{contact.relativePower.toFixed(1)} dB</td>
                            <td>{contact.hopEstimate}</td>
                            <td
                              className={`threat-${contact.threat.toLowerCase()}`}
                            >
                              {contact.threat}
                            </td>
                            <td>{contact.status}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={9} className="table-empty">
                            {selectedScenario === "idle"
                              ? "No synthetic signal candidates in this scenario."
                              : "No candidates pass the current demonstration threshold."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="console-panel workspace-detail">
                <div className="console-panel-heading">
                  <span>METHOD & LIMITATIONS</span>
                </div>
                <p>
                  Candidates are heuristic local peaks in a synthetic spectrum.
                  Labels and confidence scores are demonstration estimates, not
                  validated protocol identification or calibrated probabilities.
                </p>
                <p>
                  Hopping analysis, protocol decoding, and real-world
                  classification are not implemented.
                </p>
              </article>
            </section>
          )}

          {activeWorkspace === "Tracking" && (
            <section className="workspace-content">
              <div className="workspace-title">
                <div>
                  <h2>TRACKING & HISTORY</h2>
                  <p>Temporal analysis workspace</p>
                </div>
                <span className="workspace-badge">FOUNDATION</span>
              </div>

              <div className="workspace-metrics">
                <article className="console-panel">
                  <span>CURRENT CANDIDATES</span>
                  <strong>{contacts.length}</strong>
                </article>
                <article className="console-panel">
                  <span>STREAM STATUS</span>
                  <strong>{backendConnected ? "CONNECTED" : "OFFLINE"}</strong>
                </article>
                <article className="console-panel">
                  <span>CONFIRMED TRACKS</span>
                  <strong>NOT IMPLEMENTED</strong>
                </article>
              </div>

              <article className="console-panel workspace-detail">
                <div className="console-panel-heading">
                  <span>TRACK REGISTER</span>
                </div>
                <div className="console-empty workspace-empty">
                  <strong>TRACK ASSOCIATION NOT IMPLEMENTED</strong>
                  <span>
                    Current candidates are estimated independently from each
                    spectrum frame. Persistent track IDs and association logic
                    have not been built.
                  </span>
                </div>
              </article>

              <article className="console-panel workspace-detail">
                <div className="console-panel-heading">
                  <span>AVAILABLE TEMPORAL DATA</span>
                </div>
                <p>Latest frame: {spectrum?.frame_id ?? "—"}</p>
                <p>
                  Latest timestamp: {formatTime(spectrum?.timestamp)}
                </p>
                <p>Retained waterfall frames: {waterfallRows.length}</p>
                <p>
                  Position, speed, heading, and multi-sensor tracking are not
                  available from the current single-spectrum stream.
                </p>
              </article>
            </section>
          )}

          {activeWorkspace === "Settings" && (
            <section className="workspace-content">
              <div className="workspace-title">
                <div>
                  <h2>SETTINGS & DIAGNOSTICS</h2>
                  <p>Current simulation configuration and service health</p>
                </div>
                <span className="workspace-badge">SIMULATION ONLY</span>
              </div>

              <article className="console-panel settings-group">
                <div className="console-panel-heading">
                  <span>SIMULATION CONFIGURATION</span>
                </div>
                <div className="settings-row">
                  <span>Active scenario</span>
                  <strong>{scenarioName}</strong>
                </div>
                <div className="settings-row">
                  <span>Scenario ID</span>
                  <strong>{selectedScenario}</strong>
                </div>
                <div className="settings-row">
                  <span>Seed</span>
                  <strong>{spectrum?.seed ?? "Awaiting frame"}</strong>
                </div>
                <div className="settings-row">
                  <span>Simulation version</span>
                  <strong>{spectrum?.sim_version ?? "Awaiting frame"}</strong>
                </div>
                <div className="settings-row">
                  <span>Configuration hash</span>
                  <code>{spectrum?.config_hash ?? "Awaiting frame"}</code>
                </div>
                <p className="panel-disclaimer">
                  Select a scenario from the toolbar. Scenario selection is
                  disabled while the simulation is running.
                </p>
              </article>

              <article className="console-panel settings-group">
                <div className="console-panel-heading">
                  <span>CONNECTION DIAGNOSTICS</span>
                </div>
                <div className="settings-row">
                  <span>Backend connection</span>
                  <strong>
                    {backendConnected ? "CONNECTED" : "DISCONNECTED"}
                  </strong>
                </div>
                <div className="settings-row">
                  <span>Simulation stream</span>
                  <strong>{simulationRunning ? "RUNNING" : "STOPPED"}</strong>
                </div>
                <div className="settings-row">
                  <span>Frame rate</span>
                  <strong>{frameRate} FPS</strong>
                </div>
                <div className="settings-row">
                  <span>Latest frame</span>
                  <strong>{spectrum?.frame_id ?? "—"}</strong>
                </div>
                {error && <p className="settings-error">{error}</p>}
              </article>

              <p className="panel-disclaimer">
                These settings currently report the active configuration.
                Persistent preferences and editable DSP parameters are future
                work.
              </p>
            </section>
          )}
        </main>
      )}


      <section className="bottom-console">
        <article className="console-panel swarm-panel">
          <div className="console-panel-heading">
            <span>SWARM INTELLIGENCE</span>
            <span>DEMO INDICATORS</span>
          </div>

          <div className="swarm-content">
            <div className="swarm-score">
              <strong>
                {selectedScenario === "multi"
                  ? "06"
                  : contacts.length.toString().padStart(2, "0")}
              </strong>
              <span>CANDIDATES</span>
            </div>
            <div className="swarm-bars">
              <div className="swarm-bar-row">
                <span>Signal peaks</span>
                <div className="swarm-track">
                  <i
                    style={{ width: `${Math.min(100, contacts.length * 16)}%` }}
                  />
                </div>
                <strong>{contacts.length}</strong>
              </div>
              <div className="swarm-bar-row">
                <span>Strong peaks</span>
                <div className="swarm-track">
                  <i style={{ width: `${Math.min(100, threatCount * 25)}%` }} />
                </div>
                <strong>{threatCount}</strong>
              </div>
              <div className="swarm-bar-row">
                <span>Stream health</span>
                <div className="swarm-track">
                  <i style={{ width: backendConnected ? "100%" : "0%" }} />
                </div>
                <strong>{backendConnected ? "OK" : "—"}</strong>
              </div>
            </div>
          </div>
          <p className="panel-disclaimer">
            No swarm coordination, grouping, or multi-aircraft tracking is
            inferred.
          </p>
        </article>

        <article className="console-panel pipeline-panel">
          <div className="console-panel-heading">
            <span>DETECTION PIPELINE</span>
            <span>SIMULATION DATA FLOW</span>
          </div>
          <div className="pipeline">
            {[
              "SPECTRUM",
              "PEAK FINDER",
              "FEATURES",
              "HEURISTICS",
              "CANDIDATES",
              "TRACKING",
              "EXPORT",
            ].map((stage, index) => {
              const active = backendConnected && index < 5;
              return (
                <div
                  className={`pipeline-stage ${active ? "pipeline-active" : ""}`}
                  key={stage}
                >
                  <span className="pipeline-node" />
                  <strong>{stage}</strong>
                  <small>
                    {index === 0
                      ? backendConnected
                        ? "RECEIVING"
                        : "WAITING"
                      : index < 5
                        ? active
                          ? "DEMO"
                          : "PENDING"
                        : "NOT BUILT"}
                  </small>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <footer className="console-footer">
        <span>
          <i
            className={`footer-indicator ${backendConnected ? "connected" : ""}`}
          />
          {backendConnected ? "BACKEND CONNECTED" : "BACKEND DISCONNECTED"}
        </span>
        <span>
          {spectrum
            ? `LAST FRAME ${formatTime(spectrum.timestamp)}`
            : "NO FRAME RECEIVED"}
        </span>
        <span>
          {spectrum ? `SIM ${spectrum.sim_version}` : "SIMULATION MODE"}
        </span>
        <span className="footer-warning">
          SYNTHETIC DATA · UNCLASSIFIED · NOT A REAL RF RECEIVER
        </span>
      </footer>
    </div>
  );
}

export default App;
