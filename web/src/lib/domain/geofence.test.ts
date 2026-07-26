import { describe, it, expect } from 'vitest'
import { haversineMeters, pointInPolygon, evaluateGeofence, isAccuracyAcceptable } from './geofence'
import type { Geofence } from './types'

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    expect(haversineMeters({ lat: -6.2, long: 106.8 }, { lat: -6.2, long: 106.8 })).toBeLessThan(0.01)
  })
  it('approximates a known short distance (~111m per 0.001° lat)', () => {
    const d = haversineMeters({ lat: -6.2, long: 106.8 }, { lat: -6.201, long: 106.8 })
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(118)
  })
})

describe('pointInPolygon', () => {
  const square = [
    { lat: 0, long: 0 },
    { lat: 0, long: 2 },
    { lat: 2, long: 2 },
    { lat: 2, long: 0 },
  ]
  it('detects inside and outside', () => {
    expect(pointInPolygon({ lat: 1, long: 1 }, square)).toBe(true)
    expect(pointInPolygon({ lat: 3, long: 3 }, square)).toBe(false)
  })
})

describe('evaluateGeofence (circle)', () => {
  const fence: Geofence = {
    id: 'g1', companyId: 'c1', branchId: 'b1', type: 'circle',
    centerLat: -6.2, centerLong: 106.8, radiusM: 100, bufferM: 50,
  }
  it('inside within radius', () => {
    expect(evaluateGeofence({ lat: -6.2, long: 106.8 }, fence).result).toBe('inside')
  })
  it('near within buffer', () => {
    // ~133m away (0.0012° lat ≈ 133m) → outside radius(100) but within radius+buffer(150)
    expect(evaluateGeofence({ lat: -6.2012, long: 106.8 }, fence).result).toBe('near')
  })
  it('outside beyond buffer', () => {
    expect(evaluateGeofence({ lat: -6.205, long: 106.8 }, fence).result).toBe('outside')
  })
})

describe('isAccuracyAcceptable', () => {
  it('rejects poor accuracy (likely IP-geo)', () => {
    expect(isAccuracyAcceptable(30)).toBe(true)
    expect(isAccuracyAcceptable(250)).toBe(false)
  })
})
