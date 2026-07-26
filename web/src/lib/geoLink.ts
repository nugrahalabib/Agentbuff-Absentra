/** Extract { lat, long } from a Google Maps URL or a plain "lat, long" string.
 * Handles @lat,lng / ?q=lat,lng / !3dlat!4dlng / query=lat,lng / bare pairs. */
export function parseLatLong(input: string): { lat: number; long: number } | null {
  if (!input) return null
  const s = input.trim()
  const valid = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)

  // !3d<lat>!4d<lng>
  let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
  if (m && valid(+m[1], +m[2])) return { lat: +m[1], long: +m[2] }

  // @lat,lng
  m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m && valid(+m[1], +m[2])) return { lat: +m[1], long: +m[2] }

  // q= / query= / ll=  lat,lng
  m = s.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m && valid(+m[1], +m[2])) return { lat: +m[1], long: +m[2] }

  // bare "lat, lng"
  m = s.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/)
  if (m && valid(+m[1], +m[2])) return { lat: +m[1], long: +m[2] }

  return null
}
