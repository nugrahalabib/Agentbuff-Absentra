import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { Button, Card, Field, Input, Select, BottomSheet, EmptyState, Skeleton, Badge } from '@/components/ui'
import { IconClock } from '@/components/ui/icons'
import { todayISODate } from '@/lib/format'

export function ShiftsPage() {
  const qc = useQueryClient()
  const [newShift, setNewShift] = useState(false)
  const [assignOpen, setAssign] = useState(false)
  const templates = useQuery({ queryKey: ['shiftTemplates'], queryFn: () => api.shiftTemplates() })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">Shift & Jadwal</h1>
          <p className="text-sm text-text-muted">Template shift + penjadwalan massal.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setAssign(true)}>Susun Jadwal</Button>
          <Button onClick={() => setNewShift(true)}>Template Shift</Button>
        </div>
      </div>

      {templates.isLoading ? <Skeleton className="h-24" /> : templates.data?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.data.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 font-medium text-text"><IconClock width={16} height={16} /> {s.name}</p>
                {s.crossesMidnight && <Badge tone="neutral">Lintas malam</Badge>}
              </div>
              <p className="mt-1 text-sm text-text-muted">{s.startTime}–{s.endTime} · toleransi {s.lateToleranceMinutes} mnt · istirahat {s.breakMinutes} mnt</p>
            </Card>
          ))}
        </div>
      ) : <EmptyState title="Belum ada template shift." action={<Button onClick={() => setNewShift(true)}>Buat template</Button>} />}

      <BottomSheet open={newShift} onClose={() => setNewShift(false)} title="Template Shift Baru">
        <ShiftForm onDone={() => { qc.invalidateQueries({ queryKey: ['shiftTemplates'] }); setNewShift(false) }} />
      </BottomSheet>
      <BottomSheet open={assignOpen} onClose={() => setAssign(false)} title="Susun Jadwal (bulk)">
        <AssignForm templates={templates.data ?? []} onDone={() => { qc.invalidateQueries({ queryKey: ['schedule'] }); setAssign(false) }} />
      </BottomSheet>
    </div>
  )
}

function ShiftForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [startTime, setStart] = useState('08:00')
  const [endTime, setEnd] = useState('17:00')
  const [crossesMidnight, setCross] = useState(false)
  const [breakMinutes, setBreak] = useState(60)
  const [lateToleranceMinutes, setTol] = useState(10)
  const m = useMutation({ mutationFn: () => api.createShiftTemplate({ name, startTime, endTime, crossesMidnight, breakMinutes, lateToleranceMinutes }), onSuccess: onDone })
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <Field label="Nama shift"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Shift Malam" required /></Field>
      <div className="flex gap-2">
        <Field label="Mulai"><Input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Selesai"><Input type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={crossesMidnight} onChange={(e) => setCross(e.target.checked)} /> Lintas tengah malam (shift malam)</label>
      <div className="flex gap-2">
        <Field label="Istirahat (mnt)"><Input type="number" value={breakMinutes} onChange={(e) => setBreak(Number(e.target.value))} /></Field>
        <Field label="Toleransi telat (mnt)"><Input type="number" value={lateToleranceMinutes} onChange={(e) => setTol(Number(e.target.value))} /></Field>
      </div>
      <Button type="submit" fullWidth loading={m.isPending} disabled={!name}>Simpan</Button>
    </form>
  )
}

function AssignForm({ templates, onDone }: { templates: { id: string; name: string }[]; onDone: () => void }) {
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const [selected, setSelected] = useState<string[]>([])
  const [shiftTemplateId, setTemplate] = useState('')
  const [dateStart, setStart] = useState(todayISODate())
  const [dateEnd, setEnd] = useState(todayISODate())
  const m = useMutation({ mutationFn: () => api.bulkAssign({ employeeIds: selected, shiftTemplateId, dateStart, dateEnd, skipSundays: true }), onSuccess: onDone })
  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (selected.length && shiftTemplateId) m.mutate() }}>
      <Field label="Template shift"><Select value={shiftTemplateId} onChange={(e) => setTemplate((e.target as HTMLSelectElement).value)}><option value="">Pilih…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      <div className="flex gap-2">
        <Field label="Dari"><Input type="date" value={dateStart} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Sampai"><Input type="date" value={dateEnd} min={dateStart} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-text">Karyawan ({selected.length} dipilih)</p>
        <div className="max-h-44 overflow-y-auto rounded-md border border-border">
          {employees.data?.filter((e) => e.employmentStatus === 'active').map((e) => (
            <label key={e.id} className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0">
              <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggle(e.id)} /> {e.name}
            </label>
          ))}
        </div>
      </div>
      <p className="text-xs text-text-muted">Hari Minggu otomatis dilewati.</p>
      <Button type="submit" fullWidth loading={m.isPending} disabled={!selected.length || !shiftTemplateId}>Terapkan jadwal</Button>
    </form>
  )
}
