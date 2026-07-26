import { describe, it, expect } from 'vitest'
import { clockTransition, initialClockContext, resolveAttendanceStatus, type ClockContext } from './clockInMachine'

describe('clock-in FSM', () => {
  it('happy online path: Ready → Locating → Capturing → Reviewing → Submitting → Success', () => {
    let ctx: ClockContext = clockTransition(initialClockContext, { type: 'CONTEXT_READY_IN' })
    expect(ctx.state).toBe('ReadyIn')
    ctx = clockTransition(ctx, { type: 'TAP_CLOCK' })
    expect(ctx.state).toBe('Locating')
    ctx = clockTransition(ctx, { type: 'LOCATION_OK' })
    expect(ctx.state).toBe('Capturing')
    ctx = clockTransition(ctx, { type: 'PHOTO_CAPTURED' })
    expect(ctx.state).toBe('Reviewing')
    ctx = clockTransition(ctx, { type: 'CONFIRM' })
    expect(ctx.state).toBe('Submitting')
    ctx = clockTransition(ctx, { type: 'SUBMIT_ONLINE_OK' })
    expect(ctx.state).toBe('Success')
  })

  it('offline path queues then syncs', () => {
    let ctx: ClockContext = { state: 'Submitting', kind: 'in' }
    ctx = clockTransition(ctx, { type: 'SUBMIT_OFFLINE' })
    expect(ctx.state).toBe('Queued')
    ctx = clockTransition(ctx, { type: 'SYNC_OK' })
    expect(ctx.state).toBe('Success')
  })

  it('location error can retry back to ReadyIn', () => {
    let ctx: ClockContext = { state: 'Locating', kind: 'in' }
    ctx = clockTransition(ctx, { type: 'LOCATION_FAIL' })
    expect(ctx.state).toBe('LocationError')
    ctx = clockTransition(ctx, { type: 'RETRY' })
    expect(ctx.state).toBe('ReadyIn')
  })

  it('unknown transitions are no-ops', () => {
    const ctx: ClockContext = { state: 'ReadyIn', kind: 'in' }
    expect(clockTransition(ctx, { type: 'SYNC_OK' })).toEqual(ctx)
  })
})

describe('resolveAttendanceStatus', () => {
  it('on_time within tolerance', () => {
    // shift 08:00 (480), tolerance 10, clock-in 08:08 (488)
    expect(resolveAttendanceStatus(488, 480, 10)).toEqual({ status: 'on_time', lateMinutes: 0 })
  })
  it('late beyond tolerance counts from shift start', () => {
    // clock-in 08:25 (505), shift 480, tolerance 10 → late 25 min
    expect(resolveAttendanceStatus(505, 480, 10)).toEqual({ status: 'late', lateMinutes: 25 })
  })
})
