import { describe, it, expect } from 'vitest'
import { computeTrustScore, trustDecision, type TrustSignals } from './trust'

const clean: TrustSignals = {
  geofenceResult: 'inside',
  gpsAccuracyM: 20,
  ipGeoConsistent: true,
  impossibleTravel: false,
  deviceConsistent: true,
  livenessPassed: true,
  withinShiftWindow: true,
}

describe('computeTrustScore', () => {
  it('clean signals → 100', () => {
    expect(computeTrustScore(clean).score).toBe(100)
  })
  it('outside geofence + impossible travel tank the score and list reasons', () => {
    const r = computeTrustScore({ ...clean, geofenceResult: 'outside', impossibleTravel: true })
    expect(r.score).toBe(25) // 100 - 35 - 40
    expect(r.reasons.length).toBe(2)
  })
  it('never goes below 0', () => {
    const r = computeTrustScore({
      geofenceResult: 'outside', gpsAccuracyM: 500, ipGeoConsistent: false,
      impossibleTravel: true, deviceConsistent: false, livenessPassed: false, withinShiftWindow: false,
    })
    expect(r.score).toBe(0)
  })
})

describe('trustDecision', () => {
  const th = { accept: 80, review: 60 }
  it('accepts at/above accept threshold', () => {
    expect(trustDecision(85, th, false)).toBe('accepted')
  })
  it('review band', () => {
    expect(trustDecision(70, th, false)).toBe('review')
  })
  it('below review: flagged (default) vs rejected (strict)', () => {
    expect(trustDecision(40, th, false)).toBe('flagged')
    expect(trustDecision(40, th, true)).toBe('rejected')
  })
})
