/**
 * Overtime request lifecycle shared by REST and MCP.
 *
 * Clock-out past the shift end auto-creates a DRAFT overtime request
 * (`is_draft=1`, pending) for the employee to confirm (PRD §6.6). A manual
 * request for the same employee + date SUPERSEDES the draft — the draft is
 * rejected with a reason — so the same hours can never be paid twice. Only
 * approved requests count in payroll (and payroll also ignores an approved
 * draft whenever an approved manual request exists for that date).
 */
import { db, now } from './db.js'

export const SUPERSEDED_REASON = 'Digantikan pengajuan lembur manual untuk tanggal yang sama'

/** Reject every draft (pending or approved) for employee+date except `keepId`. */
export function supersedeDrafts(companyId: string, employeeId: string, workDate: string, keepId?: string): number {
  const r = db.prepare(
    `UPDATE overtime_request SET status='rejected', approver_id='system', decided_at=?, decided_reason=?
      WHERE company_id=? AND employee_id=? AND work_date=? AND is_draft=1 AND status IN ('pending','approved') AND id != ?`,
  ).run(now(), SUPERSEDED_REASON, companyId, employeeId, workDate, keepId ?? '')
  return r.changes
}

export type OvertimeDecision =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string }

/**
 * Apply an approver's decision. Approving a draft is refused when a manual
 * request for that date is already approved (it would double-pay); approving a
 * manual request supersedes any draft for the date.
 */
export function decideOvertime(companyId: string, ot: any, decision: 'approved' | 'rejected', approverId: string, reason: string | null): OvertimeDecision {
  const tx = db.transaction((): OvertimeDecision => {
    if (decision === 'approved') {
      if (ot.is_draft) {
        const manual = db.prepare(
          `SELECT id FROM overtime_request WHERE company_id=? AND employee_id=? AND work_date=? AND is_draft=0 AND status='approved' AND id != ?`,
        ).get(companyId, ot.employee_id, ot.work_date, ot.id)
        if (manual) {
          return { ok: false, status: 409, error: 'overtime_duplicate_date', message: 'Sudah ada lembur manual yang disetujui untuk tanggal ini. Draf otomatis tidak bisa disetujui juga.' }
        }
      } else {
        supersedeDrafts(companyId, ot.employee_id, ot.work_date, ot.id)
      }
    }
    db.prepare('UPDATE overtime_request SET status=?, approver_id=?, decided_at=?, decided_reason=? WHERE id=? AND company_id=?')
      .run(decision, approverId, now(), reason, ot.id, companyId)
    return { ok: true }
  })
  return tx()
}
