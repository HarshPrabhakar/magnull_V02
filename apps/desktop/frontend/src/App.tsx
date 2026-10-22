import { useState } from 'react'
import './App.css'

type ScenarioId = 'idle' | 'hobby' | 'fpv' | 'multi'

const scenarios: { id: ScenarioId; name: string; description: string }[] = [
  { id: 'idle', name: 'Idle Environment', description: 'Background noise only' },
  { id: 'hobby', name: 'Hobby Signals', description: 'Intermittent synthetic signals' },
  { id: 'fpv', name: 'FPV-style Signals', description: 'Simulated signal patterns' },
  { id: 'multi', name: 'Multiple Sources', description: 'Overlapping synthetic signals' },
]


function App() {
  const [selectedScenario, setSelectedScenario] = useState<ScenarioId>('idle')
  const [simulationRunning, setSimulationRunning] = useState(false)
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">M</div>
          <div>
            <h1>MAG-NULL</h1>
            <span>RF ANALYSIS SYSTEM</span>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="navigation">
          <button className="nav-item active">▦ <span>Overview</span></button>
          <button className="nav-item">〰 <span>Spectrum</span></button>
          <button className="nav-item">▤ <span>Waterfall</span></button>
          <button className="nav-item">◎ <span>Detections</span></button>
          <button className="nav-item">⌖ <span>Tracking</span></button>
        </nav>

        <div className="sidebar-bottom">
          <div className="nav-label">SYSTEM</div>
          <button className="nav-item">⚙ <span>Settings</span></button>
          <div className="connection">
            <span className="status-dot" />
            <div>
              <strong>LOCAL SIMULATOR</strong>
              <small>Desktop interface ready</small>
            </div>
          </div>
          <div className="version">MAG-NULL · VERSION 0.1.0</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="breadcrumb">WORKSPACE / OVERVIEW</div>
            <h2>Mission Overview</h2>
          </div>
          <div className="mode-badge">
            <span className="status-dot" />
            SIMULATION MODE
          </div>
        </header>

        <section className="welcome-panel">
          <div>
            <div className="eyebrow">SIMULATION ENVIRONMENT</div>
            <h3>RF Analysis Workspace</h3>
            <p>
              Explore synthetic signal environments, inspect spectrum data,
              and evaluate simulated detection results.
            </p>
          </div>
          <div className="radar-mark" aria-hidden="true">
            <div className="radar-ring ring-one" />
            <div className="radar-ring ring-two" />
            <div className="radar-ring ring-three" />
            <div className="radar-sweep" />
            <div className="radar-center" />
          </div>
        </section>

        <section className="panel simulation-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SCENARIO MANAGEMENT</span>
              <h3>Simulation Control Center</h3>
            </div>
            <span className="panel-tag">
              {simulationRunning ? 'RUNNING' : 'STANDBY'}
            </span>
          </div>

          <p className="simulation-description">
            Select a synthetic environment to prepare a simulation session.
          </p>

          <div className="scenario-grid">
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                className={`scenario-option ${selectedScenario === scenario.id ? 'selected' : ''
                  }`}
                aria-pressed={selectedScenario === scenario.id}
                onClick={() => setSelectedScenario(scenario.id)}
                disabled={simulationRunning}
              >
                <span className="scenario-radio">
                  {selectedScenario === scenario.id ? '●' : '○'}
                </span>
                <strong>{scenario.name}</strong>
                <small>{scenario.description}</small>
              </button>
            ))}
          </div>

          <div className="simulation-actions">
            <div className="selected-scenario">
              Selected: <strong>
                {scenarios.find((scenario) => scenario.id === selectedScenario)?.name}
              </strong>
            </div>

            {!simulationRunning ? (
              <button
                type="button"
                className="simulation-button start-button"
                onClick={() => setSimulationRunning(true)}
              >
                ▶ Start Simulation
              </button>
            ) : (
              <button
                type="button"
                className="simulation-button stop-button"
                onClick={() => setSimulationRunning(false)}
              >
                ■ Stop Simulation
              </button>
            )}
          </div>

          <p className="simulation-notice">
            Frontend demonstration only. No RF hardware or Python simulation
            engine is connected yet.
          </p>
        </section>

        <section className="metrics-grid">
          <article className="metric-card">
            <span className="metric-label">SIMULATION STATUS</span>
            <strong className="metric-value">STANDBY</strong>
            <span className="metric-note">No scenario running</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">ACTIVE SCENARIOS</span>
            <strong className="metric-value">00</strong>
            <span className="metric-note">Synthetic environment</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">DETECTIONS</span>
            <strong className="metric-value">00</strong>
            <span className="metric-note">Awaiting analysis</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">BACKEND SERVICE</span>
            <strong className="metric-value service-status">NOT CONNECTED</strong>
            <span className="metric-note">Integration pending</span>
          </article>
        </section>

        <section className="analysis-grid">
          <article className="panel spectrum-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">SIGNAL MONITOR</span>
                <h3>Spectrum Analysis</h3>
              </div>
              <span className="panel-tag">PREVIEW</span>
            </div>

            <div className="chart-placeholder">
              <div className="chart-y-labels">
                <span>0 dB</span>
                <span>-20 dB</span>
                <span>-40 dB</span>
                <span>-60 dB</span>
                <span>-80 dB</span>
              </div>
              <div className="chart-area">
                <div className="chart-grid-lines">
                  <i /><i /><i /><i /><i />
                </div>
                <div className="empty-chart">
                  <span>⌁</span>
                  <strong>Awaiting signal data</strong>
                  <small>Start a simulation to populate this panel</small>
                </div>
              </div>
            </div>
            <div className="chart-axis">
              <span>Low frequency</span>
              <span>Frequency →</span>
              <span>High frequency</span>
            </div>
          </article>

          <article className="panel waterfall-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">TIME SERIES</span>
                <h3>Waterfall</h3>
              </div>
              <span className="panel-tag">LIVE VIEW PENDING</span>
            </div>
            <div className="waterfall-empty">
              <div className="waterfall-lines" />
              <div className="waterfall-message">
                <span>▤</span>
                <strong>No waterfall frames</strong>
                <small>Waiting for the simulation engine</small>
              </div>
            </div>
            <div className="waterfall-footer">
              <span>TIME ↓</span>
              <span>FREQUENCY →</span>
            </div>
          </article>
        </section>

        <section className="panel events-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SYSTEM ACTIVITY</span>
              <h3>Recent Events</h3>
            </div>
            <span className="panel-tag">0 EVENTS</span>
          </div>
          <div className="empty-events">
            <span>✓</span>
            <div>
              <strong>No events recorded</strong>
              <p>Simulation events and analysis results will appear here.</p>
            </div>
          </div>
        </section>

        <footer className="app-footer">
          <span><span className="status-dot" /> Desktop UI operational</span>
          <span>SIMULATED DATA ONLY · NOT A REAL RF RECEIVER</span>
        </footer>
      </main>
    </div>
  )
}

export default App
