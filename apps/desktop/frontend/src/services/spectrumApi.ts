
const API_BASE_URL = 'http://127.0.0.1:8765'
const WS_BASE_URL = 'ws://127.0.0.1:8765'

export type ScenarioId = 'idle' | 'hobby' | 'fpv' | 'multi'


export interface SpectrumData {
    mode: 'simulation'
    source: 'simulated'
    synthetic: true
    sim_version: string
    scenario: ScenarioId
    seed: number
    config_hash: string
    bin_count: number
    frequency_bins: number[]
    power: number[]
    noise_floor: number
    units: 'relative_dB'
}

export interface SpectrumFrame extends SpectrumData {
    frame_id: number
    timestamp: string
}

export async function fetchSpectrum(
    scenario: ScenarioId = 'idle',
    seed = 42,
): Promise<SpectrumData> {
    const params = new URLSearchParams({
        scenario,
        seed: String(seed),
    })

    const response = await fetch(
        `${API_BASE_URL}/api/v1/spectrum?${params.toString()}`,
    )

    if (!response.ok) {
        throw new Error(`Spectrum request failed: HTTP ${response.status}`)
    }

    const data: SpectrumData = await response.json()

    if (
        data.mode !== 'simulation' ||
        data.synthetic !== true ||
        data.bin_count !== data.power.length ||
        data.bin_count !== data.frequency_bins.length
    ) {
        throw new Error('Invalid spectrum response from backend')
    }

    return data
}

export function connectSpectrumStream(
    scenario: ScenarioId,
    onFrame: (frame: SpectrumFrame) => void,
    onError: (message: string) => void,
    seed = 42,
): WebSocket {
    const params = new URLSearchParams({
        scenario,
        seed: String(seed),
    })

    const socket = new WebSocket(
        `${WS_BASE_URL}/ws/spectrum?${params.toString()}`,
    )

    socket.onmessage = (event: MessageEvent<string>) => {
        try {
            const frame = JSON.parse(event.data) as SpectrumFrame


            if (
                frame.mode !== 'simulation' ||
                frame.source !== 'simulated' ||
                frame.synthetic !== true ||
                !frame.sim_version ||
                frame.scenario !== scenario ||
                frame.seed !== seed ||
                !/^[0-9a-f]{64}$/.test(frame.config_hash) ||
                !Number.isInteger(frame.frame_id) ||
                frame.frame_id < 0 ||
                !frame.timestamp ||
                !Number.isFinite(Date.parse(frame.timestamp)) ||
                frame.bin_count < 32 ||
                frame.bin_count > 4096 ||
                frame.bin_count !== frame.power.length ||
                frame.bin_count !== frame.frequency_bins.length ||
                !frame.power.every(Number.isFinite) ||
                !frame.frequency_bins.every(Number.isFinite)
            ) {
                throw new Error('Invalid spectrum frame received')
            }


            onFrame(frame)
        } catch (error) {
            onError(
                error instanceof Error
                    ? error.message
                    : 'Unable to process spectrum frame',
            )
        }
    }

    socket.onerror = () => {
        onError('Spectrum WebSocket connection failed')
    }

    return socket
}
