/** Pengaturan usaha (khusus pemilik): profil usaha dan aturan absen & upah. */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { Company, Policy } from '@/lib/domain/types'
import { Button, Field, Input, InputAngka, KepalaHalaman, PesanGalat, Saklar, Segmen, Select, Skeleton } from '@/components/ui'
import { IconPlus, IconTrash, IconUpload } from '@/components/ui/icons'
import { toast } from '@/components/Toast'
import { pesanGalat } from '@/lib/galat'
import { kecilkanGambar } from '@/lib/gambar'

const ZONA = [
  { v: 'Asia/Jakarta', l: 'WIB (Jakarta)' },
  { v: 'Asia/Makassar', l: 'WITA (Makassar)' },
  { v: 'Asia/Jayapura', l: 'WIT (Jayapura)' },
]

export default function SettingsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'usaha' | 'aturan'>('usaha')
  const companyQ = useQuery({ queryKey: ['company'], queryFn: () => api.company() })
  const policyQ = useQuery({ queryKey: ['policy'], queryFn: () => api.policy() })

  return (
    <div className="mx-auto max-w-2xl">
      <KepalaHalaman judul="Pengaturan" keterangan="Hanya pemilik usaha yang bisa mengubah ini." />
      <Segmen
        label="Bagian pengaturan"
        nilai={tab}
        onChange={setTab}
        pilihan={[{ nilai: 'usaha', label: 'Profil usaha' }, { nilai: 'aturan', label: 'Aturan absen & upah' }]}
        className="mb-5"
      />
      {tab === 'usaha'
        ? companyQ.isLoading
          ? <Skeleton className="h-64" />
          : companyQ.data && <FormUsaha key={companyQ.data.id} usaha={companyQ.data} onSimpan={() => { qc.invalidateQueries({ queryKey: ['company'] }); qc.invalidateQueries({ queryKey: ['me'] }) }} />
        : policyQ.isLoading
          ? <Skeleton className="h-64" />
          : policyQ.data && <FormAturan key={policyQ.data.id} aturan={policyQ.data} onSimpan={() => qc.invalidateQueries({ queryKey: ['policy'] })} />}
    </div>
  )
}

function FormUsaha({ usaha, onSimpan }: { usaha: Company; onSimpan: () => void }) {
  const [nama, setNama] = useState(usaha.displayName)
  const [jenis, setJenis] = useState(usaha.businessType)
  const [zona, setZona] = useState(usaha.timezone)
  const [minggu, setMinggu] = useState(usaha.workweekType)
  const [alamat, setAlamat] = useState(usaha.address ?? '')
  const [logo, setLogo] = useState<string | null>(usaha.logoUrl ?? null)
  const simpan = useMutation({ mutationFn: () => api.updateCompany({ displayName: nama.trim(), businessType: jenis.trim(), timezone: zona, workweekType: minggu, address: alamat.trim() }), onSuccess: () => { onSimpan(); toast.berhasil('Profil usaha tersimpan.') } })
  const unggah = useMutation({ mutationFn: (data: string) => api.uploadLogo(data), onSuccess: (c) => { setLogo(c.logoUrl ?? null); onSimpan(); toast.berhasil('Logo diperbarui.') }, onError: (e) => toast.galat(pesanGalat(e, 'Logo belum bisa diunggah. Pakai PNG, JPG, atau WebP di bawah 300 KB.')) })

  const pilihLogo = (f?: File) => {
    if (!f) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { toast.galat('Pakai gambar PNG, JPG, atau WebP.'); return }
    void kecilkanGambar(f, 256).then((d) => unggah.mutate(d)).catch(() => toast.galat('Gambar tidak bisa dibaca.'))
  }

  return (
    <form className="kaca-panel flex flex-col gap-4 rounded-[28px] p-5 sm:p-6" onSubmit={(e) => { e.preventDefault(); simpan.mutate() }}>
      <div className="flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[18px] bg-sumur text-[13px] text-tinta-3">
          {logo ? <img src={logo} alt="Logo usaha" className="h-full w-full object-cover" /> : 'Logo'}
        </span>
        <label className="tombol-kaca inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full px-4 text-[14px] font-semibold">
          <IconUpload width={16} height={16} /> {unggah.isPending ? 'Mengunggah...' : logo ? 'Ganti logo' : 'Unggah logo'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pilihLogo(e.target.files?.[0])} />
        </label>
      </div>
      <Field label="Nama usaha"><Input value={nama} onChange={(e) => setNama(e.target.value)} required maxLength={80} /></Field>
      <Field label="Jenis usaha"><Input value={jenis} onChange={(e) => setJenis(e.target.value)} maxLength={60} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Zona waktu"><Select value={zona} onChange={(e) => setZona(e.target.value)}>{ZONA.map((z) => <option key={z.v} value={z.v}>{z.l}</option>)}</Select></Field>
        <Field label="Hari kerja" helper="Menentukan pengali lembur."><Select value={minggu} onChange={(e) => setMinggu(e.target.value as Company['workweekType'])}><option value="six_day">6 hari seminggu</option><option value="five_day">5 hari seminggu</option></Select></Field>
      </div>
      <Field label="Alamat"><Input value={alamat} onChange={(e) => setAlamat(e.target.value)} maxLength={200} /></Field>
      <PesanGalat>{simpan.isError ? pesanGalat(simpan.error) : null}</PesanGalat>
      <Button type="submit" size="lg" loading={simpan.isPending} disabled={!nama.trim()}>Simpan</Button>
    </form>
  )
}

type Jenjang = { uptoMinutes: number; amount: number }

function FormAturan({ aturan, onSimpan }: { aturan: Policy; onSimpan: () => void }) {
  const [mode, setMode] = useState(aturan.lateDeductionMode)
  const [perMenit, setPerMenit] = useState(aturan.lateDeductionConfig.perMinuteRate ?? 500)
  const [toleransi, setToleransi] = useState(aturan.lateDeductionConfig.graceMinutes ?? 10)
  const [tetap, setTetap] = useState(aturan.lateDeductionConfig.flatAmount ?? 20000)
  const [jenjang, setJenjang] = useState<Jenjang[]>(aturan.lateDeductionConfig.tiers?.length ? aturan.lateDeductionConfig.tiers : [{ uptoMinutes: 15, amount: 10000 }, { uptoMinutes: 60, amount: 25000 }])
  const [makanLembur, setMakanLembur] = useState(aturan.mealAllowanceConfig.onOvertimeAmount ?? 25000)
  const [makanHarian, setMakanHarian] = useState(aturan.mealAllowanceConfig.perPresentDay ?? 0)
  const [ketat, setKetat] = useState(aturan.strictGeofence)
  const [ambangTerima, setAmbangTerima] = useState(aturan.trustThresholds.accept)
  const [ambangCek, setAmbangCek] = useState(aturan.trustThresholds.review)
  const [simpanFoto, setSimpanFoto] = useState(aturan.photoRetentionDays)
  const [jedaShift, setJedaShift] = useState<number>((aturan as Policy & { minRestHours?: number }).minRestHours ?? 0)

  const m = useMutation({
    mutationFn: () =>
      api.updatePolicy({
        lateDeductionMode: mode,
        lateDeductionConfig: mode === 'per_minute' ? { perMinuteRate: perMenit } : mode === 'grace_flat' ? { graceMinutes: toleransi, flatAmount: tetap } : { tiers: [...jenjang].sort((a, b) => a.uptoMinutes - b.uptoMinutes) },
        mealAllowanceConfig: { perPresentDay: makanHarian, onOvertimeMinHours: 4, onOvertimeAmount: makanLembur },
        strictGeofence: ketat,
        trustThresholds: { accept: ambangTerima, review: Math.min(ambangCek, ambangTerima) },
        photoRetentionDays: simpanFoto,
        minRestHours: jedaShift,
      }),
    onSuccess: () => { onSimpan(); toast.berhasil('Aturan tersimpan.') },
  })

  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <section className="kaca-panel flex flex-col gap-4 rounded-[28px] p-5 sm:p-6">
        <h2 className="text-[18px] font-semibold text-tinta">Potongan telat</h2>
        <Field label="Cara memotong">
          <Select value={mode} onChange={(e) => setMode(e.target.value as Policy['lateDeductionMode'])}>
            <option value="per_minute">Per menit telat</option>
            <option value="grace_flat">Toleransi, lalu potongan tetap</option>
            <option value="tiered">Berjenjang menurut lama telat</option>
          </Select>
        </Field>
        {mode === 'per_minute' && <Field label="Potongan per menit (Rp)"><InputAngka rupiah min={0} nilai={perMenit} onNilai={setPerMenit} /></Field>}
        {mode === 'grace_flat' && (
          <div className="flex gap-3">
            <Field label="Toleransi (menit)"><InputAngka min={0} nilai={toleransi} onNilai={setToleransi} /></Field>
            <Field label="Potongan (Rp)"><InputAngka rupiah min={0} nilai={tetap} onNilai={setTetap} /></Field>
          </div>
        )}
        {mode === 'tiered' && (
          <div className="flex flex-col gap-2">
            {jenjang.map((j, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field label={i === 0 ? 'Telat sampai (menit)' : ''}><Input type="number" inputMode="numeric" min={1} value={j.uptoMinutes} onChange={(e) => setJenjang(jenjang.map((x, k) => (k === i ? { ...x, uptoMinutes: Number(e.target.value) } : x)))} /></Field>
                <Field label={i === 0 ? 'Potong (Rp)' : ''}><Input type="number" inputMode="numeric" min={0} value={j.amount} onChange={(e) => setJenjang(jenjang.map((x, k) => (k === i ? { ...x, amount: Number(e.target.value) } : x)))} /></Field>
                <button type="button" aria-label="Hapus jenjang" disabled={jenjang.length <= 1} onClick={() => setJenjang(jenjang.filter((_, k) => k !== i))} className="mb-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-tinta-3 hover:bg-galat-lembut hover:text-galat disabled:opacity-30"><IconTrash width={18} height={18} /></button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setJenjang([...jenjang, { uptoMinutes: (jenjang[jenjang.length - 1]?.uptoMinutes ?? 0) + 30, amount: (jenjang[jenjang.length - 1]?.amount ?? 0) + 10000 }])}><IconPlus width={16} height={16} /> Tambah jenjang</Button>
          </div>
        )}
      </section>

      <section className="kaca-panel flex flex-col gap-4 rounded-[28px] p-5 sm:p-6">
        <h2 className="text-[18px] font-semibold text-tinta">Uang makan</h2>
        <div className="flex gap-3">
          <Field label="Per hari hadir (Rp)"><InputAngka rupiah min={0} nilai={makanHarian} onNilai={setMakanHarian} /></Field>
          <Field label="Lembur 4 jam atau lebih (Rp)"><InputAngka rupiah min={0} nilai={makanLembur} onNilai={setMakanLembur} /></Field>
        </div>
      </section>

      <section className="kaca-panel flex flex-col gap-4 rounded-[28px] p-5 sm:p-6">
        <h2 className="text-[18px] font-semibold text-tinta">Absen dari luar lokasi</h2>
        <Saklar
          checked={ketat}
          onChange={setKetat}
          label="Tolak absen yang meragukan"
          keterangan={ketat ? 'Absen dengan skor di bawah ambang cek akan ditolak.' : 'Bawaan: tetap diterima, tapi ditandai untuk kamu cek. Lebih adil untuk karyawan yang sinyal GPS-nya lemah.'}
        />
        <div className="flex gap-3">
          <Field label="Skor dianggap aman" helper="Di atas ini langsung diterima."><InputAngka min={0} max={100} nilai={ambangTerima} onNilai={setAmbangTerima} /></Field>
          <Field label="Skor perlu dicek" helper="Di bawah ini ditandai."><InputAngka min={0} max={100} nilai={ambangCek} onNilai={setAmbangCek} /></Field>
        </div>
      </section>

      <section className="kaca-panel flex flex-col gap-4 rounded-[28px] p-5 sm:p-6">
        <h2 className="text-[18px] font-semibold text-tinta">Lain-lain</h2>
        <div className="flex gap-3">
          <Field label="Simpan foto absen (hari)" helper="Setelah itu foto dihapus otomatis."><InputAngka min={7} max={365} nilai={simpanFoto} onNilai={setSimpanFoto} /></Field>
          <Field label="Jeda minimal antar shift (jam)" helper="0 = tidak dibatasi."><InputAngka min={0} max={24} nilai={jedaShift} onNilai={setJedaShift} /></Field>
        </div>
      </section>

      <PesanGalat>{m.isError ? pesanGalat(m.error) : null}</PesanGalat>
      <Button type="submit" size="lg" loading={m.isPending}>Simpan aturan</Button>
    </form>
  )
}
