import { useState } from "react";
import {
  OpenWorldScene,
  type CameraCommand,
  type EnvironmentMode,
} from "./OpenWorldScene";

const INITIAL_SEED = 42;

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="open-world-metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function OpenWorldPage() {
  const [seed, setSeed] = useState(INITIAL_SEED);
  const [seedText, setSeedText] = useState(String(INITIAL_SEED));
  const [mode, setMode] = useState<EnvironmentMode>("technical");
  const [cameraCommand, setCameraCommand] = useState<CameraCommand>({
    view: "overview",
    revision: 0,
  });

  const updateSeed = (text: string) => {
    setSeedText(text);
    const nextSeed = Number(text);
    if (
      Number.isInteger(nextSeed) &&
      nextSeed >= 0 &&
      nextSeed <= 2_147_483_647
    ) {
      setSeed(nextSeed);
    }
  };

  const generateEnvironment = () => {
    const randomSeed = new Uint32Array(1);
    window.crypto.getRandomValues(randomSeed);
    const nextSeed = randomSeed[0] % 2_147_483_648;
    setSeed(nextSeed);
    setSeedText(String(nextSeed));
  };

  const setCameraView = (view: CameraCommand["view"]) => {
    setCameraCommand((current) => ({ view, revision: current.revision + 1 }));
  };

  return (
    <main className="open-world-page">
      <header className="open-world-page-header">
        <div>
          <h2>OPEN WORLD ANALYSIS</h2>
          <p>Seeded terrain and camera workspace</p>
        </div>
        <div className="open-world-status-strip" aria-label="Simulation status">
          <span className="open-world-status-item"><i /> SIMULATION: STANDBY</span>
          <span className="open-world-status-item"><i /> WORLD: READY</span>
          <span className="open-world-status-item muted"><i /> DRONE: NOT SPAWNED</span>
          <span className="open-world-status-item muted"><i /> RF: IDLE</span>
        </div>
      </header>

      <div className="open-world-layout">
        <aside className="open-world-sidebar open-world-config" aria-label="World configuration">
          <div className="open-world-panel-heading">WORLD CONFIGURATION</div>

          <label className="open-world-field">
            <span>Scenario seed</span>
            <input
              type="number"
              min={0}
              max={2_147_483_647}
              step={1}
              value={seedText}
              aria-describedby="world-seed-help"
              onChange={(event) => updateSeed(event.target.value)}
            />
            <small id="world-seed-help">Same seed generates the same terrain.</small>
          </label>

          <div className="open-world-field">
            <span>Environment presentation</span>
            <div className="open-world-segmented" role="group" aria-label="Environment presentation">
              <button
                type="button"
                className={mode === "technical" ? "selected" : ""}
                aria-pressed={mode === "technical"}
                onClick={() => setMode("technical")}
              >
                TECHNICAL
              </button>
              <button
                type="button"
                className={mode === "realistic" ? "selected" : ""}
                aria-pressed={mode === "realistic"}
                onClick={() => setMode("realistic")}
              >
                TERRAIN
              </button>
            </div>
          </div>

          <div className="open-world-config-facts">
            <MetricRow label="WORLD EXTENT" value="12 × 12 km" />
            <MetricRow label="DISTANCE UNITS" value="Virtual metres" />
            <MetricRow label="WORLD SEED" value={String(seed)} />
          </div>

          <div className="open-world-section-divider">SCENARIO LIFECYCLE</div>
          <button className="open-world-primary-action" type="button" disabled title="Flight simulation is introduced in the next phase">
            ▶ START SIMULATION
          </button>
          <div className="open-world-action-grid">
            <button type="button" disabled>Ⅱ PAUSE</button>
            <button type="button" disabled>■ STOP</button>
            <button type="button" disabled>↺ RESET SCENARIO</button>
          </div>
          <p className="open-world-hint">Flight remains inactive while the terrain and camera foundation is being built.</p>

          <button className="open-world-secondary-action" type="button" onClick={generateEnvironment}>
            GENERATE NEW ENVIRONMENT
          </button>
          <div className="open-world-provenance">SIMULATED DATA · UNCLASSIFIED · DEMONSTRATION SYSTEM</div>
        </aside>

        <section className="open-world-view" aria-label="Interactive virtual terrain">
          <div className="open-world-view-heading">
            <span>3D OPEN-WORLD ENVIRONMENT</span>
            <span>SEED {seed} · VIRTUAL METRES</span>
          </div>
          <div className="open-world-canvas-wrap">
            <OpenWorldScene seed={seed} mode={mode} cameraCommand={cameraCommand} />
            <div className="open-world-camera-tools" aria-label="Camera controls">
              <span className="camera-tool-hint">DRAG ORBIT · RIGHT-DRAG PAN · WHEEL ZOOM</span>
              <button type="button" onClick={() => setCameraView("overview")}>RESET VIEW</button>
              <button type="button" onClick={() => setCameraView("top-down")}>TOP-DOWN</button>
            </div>
            <div className="open-world-axis" aria-hidden="true">
              <span>N</span><i /><b>E</b>
            </div>
            <div className="open-world-scene-stamp">SIMULATION DATA — DEMONSTRATION SYSTEM</div>
          </div>
        </section>

        <aside className="open-world-sidebar open-world-analysis" aria-label="Live analysis">
          <section>
            <div className="open-world-panel-heading">LIVE TELEMETRY <span>NO ACTIVE DRONE</span></div>
            <MetricRow label="DRONE ID" value="—" />
            <MetricRow label="SIMULATION TIME" value="00:00:00" />
            <MetricRow label="POSITION · X / Y / Z" value="— / — / — m" />
            <MetricRow label="ALTITUDE" value="— m" />
            <MetricRow label="GROUND SPEED" value="— m/s" />
            <MetricRow label="HEADING" value="—°" />
            <MetricRow label="DISTANCE REMAINING" value="— m" />
            <MetricRow label="ESTIMATED ARRIVAL" value="—" />
          </section>

          <section>
            <div className="open-world-panel-heading">SYNTHETIC RF ANALYSIS</div>
            <MetricRow label="RF ENGINE" value="IDLE" />
            <MetricRow label="SOURCE" value="—" />
            <MetricRow label="PROFILE" value="—" />
            <MetricRow label="CHANNEL EVENTS" value="0" />
            <p className="open-world-hint">RF activity begins only with an explicitly started simulation.</p>
          </section>

          <section className="open-world-event-section">
            <div className="open-world-panel-heading">WORLD EVENT LOG</div>
            <div className="open-world-event-row"><time>READY</time><span>World generated from seed {seed}</span></div>
            <div className="open-world-event-row"><time>IDLE</time><span>No flight or RF events have been generated</span></div>
          </section>
        </aside>

        <section className="open-world-bottom" aria-label="Scenario history panels">
          <article className="open-world-chart-placeholder">
            <div className="open-world-panel-heading">SPEED OVER TIME</div>
            <span>Waiting for simulation start</span>
          </article>
          <article className="open-world-chart-placeholder">
            <div className="open-world-panel-heading">ALTITUDE OVER TIME</div>
            <span>Waiting for simulation start</span>
          </article>
          <article className="open-world-chart-placeholder open-world-history-preview">
            <div className="open-world-panel-heading">HOPPING & WATERFALL PREVIEW</div>
            <span>RF engine idle</span>
          </article>
        </section>
      </div>
    </main>
  );
}
