/**
 * Geofencing — PRD §6.4 step 3 & §7.3.1.
 * Haversine distance for circular fences; ray-casting point-in-polygon for
 * irregular sites. Classification: inside / near (within buffer) / outside.
 */
import type { Geofence, GeofenceResult } from './types'

export interface LatLong {
  lat: number
  long: number
}

const EARTH_RADIUS_M = 6_371_000

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance in metres between two coordinates. */
export function haversineMeters(a: LatLong, b: LatLong): number {
  const dLat = toRad(b.lat - a.lat)
  const dLong = toRad(b.long - a.long)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLong / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Ray-casting point-in-polygon test. Polygon is an ordered ring. */
export function pointInPolygon(point: LatLong, polygon: LatLong[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].long
    const yi = polygon[i].lat
    const xj = polygon[j].long
    const yj = polygon[j].lat
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.long < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export interface GeofenceEvaluation {
  result: GeofenceResult
  distanceM: number | null // null for polygon (containment, not distance)
}

/** Evaluate a coordinate against a geofence definition. */
export function evaluateGeofence(point: LatLong, fence: Geofence): GeofenceEvaluation {
  if (fence.type === 'polygon' && fence.polygon && fence.polygon.length >= 3) {
    const inside = pointInPolygon(point, fence.polygon)
    if (inside) return { result: 'inside', distanceM: null }
    // crude "near" for polygons: within buffer of the centroid edge — fall back to centre distance
    const d = haversineMeters(point, { lat: fence.centerLat, long: fence.centerLong })
    return { result: d <= fence.radiusM + fence.bufferM ? 'near' : 'outside', distanceM: d }
  }
  const d = haversineMeters(point, { lat: fence.centerLat, long: fence.centerLong })
  if (d <= fence.radiusM) return { result: 'inside', distanceM: d }
  if (d <= fence.radiusM + fence.bufferM) return { result: 'near', distanceM: d }
  return { result: 'outside', distanceM: d }
}

/** GPS accuracy beyond this (metres) is likely IP-based, not real GPS (PRD §6.4 step 2). */
export const GPS_ACCURACY_THRESHOLD_M = 100

export function isAccuracyAcceptable(accuracyM: number): boolean {
  return accuracyM <= GPS_ACCURACY_THRESHOLD_M
}
