/**
 * Anti-fraud trust scoring — PRD §7.3.4 ("honest" approach).
 * Browser attendance can't match dedicated hardware, so we aggregate weighted
 * signals into a 0–100 score and FLAG anomalies for human review rather than
 * hard-blocking. Decisions are transparent (reasons surfaced to admin/employee).
 */
import type { GeofenceResult } from './types'

export interface TrustSignals {
  geofenceResult: GeofenceResult
  gpsAccuracyM: number
  ipGeoConsistent: boolean // GPS roughly agrees with IP location
  impossibleTravel: boolean // implies superhuman speed vs last event
  deviceConsistent: boolean // same device fingerprint as usual
  livenessPassed: boolean | null // null = not prompted
  withinShiftWindow: boolean // event time near the shift window
}

export interface TrustResult {
  score: number // 0–100
  reasons: string[] // human-readable reasons for any deductions
}

/** Compute a transparent trust score. Starts at 100 and deducts per failing signal. */
export function computeTrustScore(s: TrustSignals): TrustResult {
  let score = 100
  const reasons: string[] = []
  const deduct = (n: number, reason: string) => {
    score -= n
    reasons.push(reason)
  }

  if (s.geofenceResult === 'near') deduct(10, 'Berada di tepi area (near geofence)')
  if (s.geofenceResult === 'outside') deduct(35, 'Di luar area kerja (outside geofence)')

  if (s.gpsAccuracyM > 100) deduct(15, 'Akurasi GPS rendah (kemungkinan bukan GPS)')

  if (!s.ipGeoConsistent) deduct(15, 'Lokasi GPS tidak cocok dengan lokasi jaringan')
  if (s.impossibleTravel) deduct(40, 'Perpindahan tidak masuk akal (impossible travel)')
  if (!s.deviceConsistent) deduct(10, 'Perangkat berbeda dari biasanya')
  if (s.livenessPassed === false) deduct(20, 'Verifikasi liveness gagal')
  if (!s.withinShiftWindow) deduct(10, 'Waktu absen di luar jendela shift')

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons }
}

export type TrustDecision = 'accepted' | 'review' | 'flagged' | 'rejected'

/**
 * Map a score to a decision given tenant thresholds and strict mode.
 * Default (non-strict): <review → flagged (mandatory review) but still accepted.
 * Strict: below the review threshold is rejected.
 */
export function trustDecision(
  score: number,
  thresholds: { accept: number; review: number },
  strict: boolean,
): TrustDecision {
  if (score >= thresholds.accept) return 'accepted'
  if (score >= thresholds.review) return 'review'
  return strict ? 'rejected' : 'flagged'
}
