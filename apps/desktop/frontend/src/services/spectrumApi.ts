
const API_BASE_URL = 'http://127.0.0.1:8765'

export type ScenarioId = 'idle' | 'hobby' | 'fpv' | 'multi'

export interface SpectrumData {
    mode: 'simulation'
    scenario: ScenarioId
    synthetic: true
    units: 'relative_dB'
    bin_count: number
    frequency_bins: number[]
    power: number[]
    noise_floor: number
    seed: number
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
        throw new Error(
            `Spectrum request failed: HTTP ${response.status}`,
        )
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
