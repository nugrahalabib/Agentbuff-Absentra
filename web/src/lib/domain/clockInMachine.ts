/**
 * Clock-in/out finite state machine — PRD §6.4 (the most-used, network-resilient path).
 * Pure transition function; the React component performs side-effects (geolocation,
 * camera, submit) and dispatches events. Keeps offline→queued→sync deterministic.
 */

export type ClockState =
  | 'CheckingContext'
  | 'ReadyIn'
  | 'ReadyOut'
  | 'NoShift'
  | 'Locating'
  | 'Capturing'
  | 'Reviewing'
  | 'Submitting'
  | 'Success'
  | 'Queued' // offline → saved to IndexedDB, will background-sync
  | 'LocationError'
  | 'SubmitError'

export type ClockEvent =
  | { type: 'CONTEXT_READY_IN' }
  | { type: 'CONTEXT_READY_OUT' }
  | { type: 'CONTEXT_NO_SHIFT' }
  | { type: 'TAP_CLOCK' } // tap Absen Masuk / Keluar
  | { type: 'LOCATION_OK' }
  | { type: 'LOCATION_FAIL' }
  | { type: 'PHOTO_CAPTURED' }
  | { type: 'CONFIRM' }
  | { type: 'RETAKE' }
  | { type: 'SUBMIT_ONLINE_OK' }
  | { type: 'SUBMIT_OFFLINE' }
  | { type: 'SUBMIT_REJECTED' }
  | { type: 'SYNC_OK' }
  | { type: 'RETRY' }
  | { type: 'RESET' }

export type ClockKind = 'in' | 'out'

export interface ClockContext {
  state: ClockState
  kind: ClockKind // whether the next action is clock-in or clock-out
}

export const initialClockContext: ClockContext = { state: 'CheckingContext', kind: 'in' }

/** Pure transition. Unknown (state,event) pairs are no-ops (return prev). */
export function clockTransition(ctx: ClockContext, event: ClockEvent): ClockContext {
  const { state } = ctx
  switch (event.type) {
    case 'CONTEXT_READY_IN':
      return { state: 'ReadyIn', kind: 'in' }
    case 'CONTEXT_READY_OUT':
      return { state: 'ReadyOut', kind: 'out' }
    case 'CONTEXT_NO_SHIFT':
      return { ...ctx, state: 'NoShift' }
    case 'TAP_CLOCK':
      return state === 'ReadyIn' || state === 'ReadyOut' ? { ...ctx, state: 'Locating' } : ctx
    case 'LOCATION_OK':
      return state === 'Locating' ? { ...ctx, state: 'Capturing' } : ctx
    case 'LOCATION_FAIL':
      return state === 'Locating' ? { ...ctx, state: 'LocationError' } : ctx
    case 'PHOTO_CAPTURED':
      return state === 'Capturing' ? { ...ctx, state: 'Reviewing' } : ctx
    case 'RETAKE':
      return state === 'Reviewing' ? { ...ctx, state: 'Capturing' } : ctx
    case 'CONFIRM':
      return state === 'Reviewing' ? { ...ctx, state: 'Submitting' } : ctx
    case 'SUBMIT_ONLINE_OK':
      return state === 'Submitting' ? { ...ctx, state: 'Success' } : ctx
    case 'SUBMIT_OFFLINE':
      return state === 'Submitting' ? { ...ctx, state: 'Queued' } : ctx
    case 'SUBMIT_REJECTED':
      return state === 'Submitting' ? { ...ctx, state: 'SubmitError' } : ctx
    case 'SYNC_OK':
      return state === 'Queued' ? { ...ctx, state: 'Success' } : ctx
    case 'RETRY':
      if (state === 'LocationError' || state === 'SubmitError') {
        return { ...ctx, state: ctx.kind === 'in' ? 'ReadyIn' : 'ReadyOut' }
      }
      return ctx
    case 'RESET':
      return { ...ctx, state: 'CheckingContext' }
    default:
      return ctx
  }
}

/** Late-status resolution (PRD §6.4 step 8 / §7.3.3). */
export function resolveAttendanceStatus(
  clockInMinutes: number, // minutes-of-day of the clock-in
  shiftStartMinutes: number,
  toleranceMinutes: number,
): { status: 'on_time' | 'late'; lateMinutes: number } {
  const allowed = shiftStartMinutes + toleranceMinutes
  if (clockInMinutes <= allowed) return { status: 'on_time', lateMinutes: 0 }
  return { status: 'late', lateMinutes: clockInMinutes - shiftStartMinutes }
}
