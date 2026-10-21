/**
 * Rekap gaji: lembur (PP 35/2021), potongan telat, dan uang makan per karyawan.
 * Absentra hanya membuat rekap siap-bayar, tidak mentransfer gaji.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import type { PayrollRecapRow } from '@/lib/domain/payroll'
import { Button, EmptyState, Field, Input, KepalaHalaman, PesanGalat, Skeleton } from '@/components/ui'
import { Maskot } from '@/components/merek'
import { IconDownload, IconInfo, IconReceipt } from '@/components/ui/icons'
import { downloadCsv } from '@/lib/exporters'
import { awalBulan, formatDate, formatIDR, todayISODate } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'

export default function PayrollPage() {
  const { company } = useActor()
  const hariIni = todayISODate()
  const [mulai, setMulai] = useState(awalBulan(hariIni))
  const [selesai, setSelesai] = useState(hariIni)
  const [jalan, setJalan] = useState(0)
  const q = useQuery({ queryKey: ['payroll', company?.id, mulai, selesai, jalan], enabled: !!company?.id && jalan > 0, queryFn: () => api.generatePayroll(undefined, mulai, selesai) })
  const data = q.data ?? []
  const total = (k: keyof PayrollRecapRow) => data.reduce((s, r) => s + (Number(r[k]) || 0), 0)

  const unduh = () =>
    downloadCsv(
      `rekap-gaji-${mulai}-${selesai}.csv`,
      ['Karyawan', 'HariHadir', 'MenitTelat', 'PotonganTelat', 'UangMakan', 'JamLembur', 'UpahLembur'],
      data.map((r) => [r.name, r.presentDays, r.lateMinutesTotal, r.lateDeduction, r.mealAllowance, r.overtimeHoursTotal, r.overtimePayTotal]),
    )

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print flex items-end justify-between gap-3">
        <KepalaHalaman judul="Rekap gaji" keterangan="Lembur, potongan telat, dan uang makan dihitung otomatis. Tinggal dipakai saat menggaji." />
        <Maskot pose="analisis" ukuran="kecil" className="-mb-1 hidden shrink-0 sm:block" />
      </div>

      <div className="kaca-panel no-print mb-4 grid gap-3 rounded-[24px] p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Dari"><Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} /></Field>
        <Field label="Sampai"><Input type="date" value={selesai} min={mulai} onChange={(e) => setSelesai(e.target.value)} /></Field>
        <Button onClick={() => setJalan((r) => r + 1)}><IconReceipt width={18} height={18} /> Buat rekap</Button>
      </div>
      <p className="no-print mb-5 flex items-start gap-2 text-[13px] text-tinta-3">
        <IconInfo width={16} height={16} className="mt-0.5 shrink-0" /> Lembur dihitung sesuai PP 35/2021 dari upah sebulan dibagi 173, hanya lembur yang sudah disetujui. Absentra tidak mentransfer gaji.
      </p>

      {jalan === 0 ? (
        <EmptyState pose="analisis" title="Pilih periodenya" keterangan="Biasanya satu bulan, dari tanggal 1 sampai akhir bulan." />
      ) : q.isLoading ? (
        <Skeleton className="h-56" />
      ) : q.isError ? (
        <PesanGalat>{pesanGalat(q.error)}</PesanGalat>
      ) : data.length === 0 ? (
        <p className="py-8 text-center text-[15px] text-tinta-3">Belum ada data pada periode ini.</p>
      ) : (
        <>
          <div className="no-print mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Ringkas label="Upah lembur" nilai={formatIDR(total('overtimePayTotal'))} />
            <Ringkas label="Uang makan" nilai={formatIDR(total('mealAllowance'))} />
            <Ringkas label="Potongan telat" nilai={formatIDR(total('lateDeduction'))} />
          </div>
          <div className="no-print mb-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={unduh}><IconDownload width={16} height={16} /> Unduh CSV (Excel)</Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>Cetak / simpan PDF</Button>
          </div>
          <div className="print-area kaca-panel overflow-x-auto rounded-[24px]">
            <div className="print-only mb-3 p-3">
              <h2 className="text-lg font-bold">Rekap gaji · {company?.displayName ?? ''}</h2>
              <p className="text-sm">Periode {formatDate(mulai)} sampai {formatDate(selesai)}. Lembur sesuai PP 35/2021. Rekap ini bukan bukti transfer gaji.</p>
            </div>
            <table className="w-full min-w-[680px] text-[14px]">
              <thead className="text-left text-tinta-3">
                <tr>
                  <th className="p-3 font-medium">Karyawan</th>
                  <th className="p-3 text-right font-medium">Hadir</th>
                  <th className="p-3 text-right font-medium">Telat</th>
                  <th className="p-3 text-right font-medium">Potongan</th>
                  <th className="p-3 text-right font-medium">Uang makan</th>
                  <th className="p-3 text-right font-medium">Lembur</th>
                  <th className="p-3 text-right font-medium">Upah lembur</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.employeeId} className="border-t border-garis">
                    <td className="p-3 font-semibold text-tinta">{r.name}</td>
                    <td className="p-3 text-right tabular-nums text-tinta">{r.presentDays} hari</td>
                    <td className="p-3 text-right tabular-nums text-tinta-2">{r.lateMinutesTotal ? `${r.lateMinutesTotal} mnt` : '-'}</td>
                    <td className="p-3 text-right tabular-nums text-galat">{r.lateDeduction ? `-${formatIDR(r.lateDeduction)}` : '-'}</td>
                    <td className="p-3 text-right tabular-nums text-tinta">{r.mealAllowance ? formatIDR(r.mealAllowance) : '-'}</td>
                    <td className="p-3 text-right tabular-nums text-tinta-2">{r.overtimeHoursTotal ? `${r.overtimeHoursTotal} jam` : '-'}</td>
                    <td className="p-3 text-right font-semibold tabular-nums text-tinta">{r.overtimePayTotal ? formatIDR(r.overtimePayTotal) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Ringkas({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="kaca-panel rounded-[22px] px-4 py-3">
      <p className="text-[13px] text-tinta-3">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold tabular-nums tracking-[-0.02em] text-tinta">{nilai}</p>
    </div>
  )
}
