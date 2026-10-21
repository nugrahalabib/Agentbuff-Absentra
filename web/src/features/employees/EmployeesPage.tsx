/**
 * Karyawan: daftar + cari, tambah manual, undang lewat link/QR/WhatsApp, impor & ekspor CSV.
 * Peran hanya bisa diubah pemilik (server juga menegakkan). Upah hanya tampil bagi yang berhak.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type EmployeeRow } from '@/lib/api/client'
import { useActor } from '@/auth/useActor'
import { can } from '@/lib/domain/rbac'
import { Badge, BottomSheet, Button, EmptyState, Field, Input, InputAngka, KepalaHalaman, PesanGalat, Select, Skeleton, Spinner } from '@/components/ui'
import { IconCopy, IconDownload, IconMapPin, IconPlus, IconQr, IconSearch, IconShare, IconTrash, IconUpload } from '@/components/ui/icons'
import { Link } from 'react-router-dom'
import { toast } from '@/components/Toast'
import { salin } from '@/lib/salin'
import { downloadCsv } from '@/lib/exporters'
import { formatDate, formatIDR } from '@/lib/format'
import { pesanGalat } from '@/lib/galat'
import type { Role } from '@/lib/domain/types'

const PERAN: Record<string, string> = { owner: 'Pemilik', branch_admin: 'Admin cabang', hr: 'HR', employee: 'Karyawan' }
type Lembar = null | 'tambah' | 'undang' | 'impor' | 'ekspor' | EmployeeRow

function inisial(nama: string) {
  const b = nama.trim().split(/\s+/)
  return ((b[0]?.[0] ?? '') + (b[1]?.[0] ?? '')).toUpperCase()
}

export default function EmployeesPage() {
  const qc = useQueryClient()
  const { actor, role } = useActor()
  const [lembar, setLembar] = useState<Lembar>(null)
  const [cari, setCari] = useState('')
  const empQ = useQuery({ queryKey: ['employees'], queryFn: () => api.employees() })
  const cabangQ = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() })
  const divQ = useQuery({ queryKey: ['divisions'], queryFn: () => api.divisions() })
  const namaCabang = (id: string) => cabangQ.data?.find((b) => b.id === id)?.name ?? '-'
  const namaDivisi = (id?: string) => divQ.data?.find((d) => d.id === id)?.name
  const segarkan = () => qc.invalidateQueries({ queryKey: ['employees'] })
  const pemilik = role === 'owner'
  const bolehUpah = !!actor && can(actor, 'wage.set')

  const daftar = useMemo(() => {
    const k = cari.trim().toLowerCase()
    const semua = empQ.data ?? []
    return k ? semua.filter((e) => e.name.toLowerCase().includes(k) || (e.email ?? '').toLowerCase().includes(k)) : semua
  }, [empQ.data, cari])
  const aktif = (empQ.data ?? []).filter((e) => e.employmentStatus === 'active').length

  const tanpaCabang = !cabangQ.isLoading && (cabangQ.data?.length ?? 0) === 0

  return (
    <div className="mx-auto max-w-4xl">
      <KepalaHalaman
        judul="Karyawan"
        keterangan={empQ.data ? `${aktif} aktif dari ${empQ.data.length} orang.` : 'Orang-orang di usahamu.'}
        aksi={
          <>
            <Button variant="secondary" onClick={() => setLembar('undang')} disabled={tanpaCabang}><IconQr width={18} height={18} /> Undang</Button>
            <Button onClick={() => setLembar('tambah')} disabled={tanpaCabang}><IconPlus width={18} height={18} /> Tambah</Button>
          </>
        }
      />

      {tanpaCabang ? (
        <EmptyState pose="peta" title="Tentukan lokasi kerja dulu" keterangan="Karyawan perlu ditempatkan di satu lokasi kerja supaya bisa absen." action={<Link to="/cabang" className="tombol-grafit inline-flex min-h-[46px] items-center rounded-full px-5 text-[15px] font-semibold">Atur lokasi kerja</Link>} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <IconSearch width={18} height={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-tinta-3" />
              <span className="sr-only">Cari karyawan</span>
              <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama atau email" className="rounded-full pl-11" />
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setLembar('impor')}><IconUpload width={16} height={16} /> Impor CSV</Button>
              <Button variant="ghost" size="sm" onClick={() => setLembar('ekspor')} disabled={!empQ.data?.length}><IconDownload width={16} height={16} /> Ekspor</Button>
            </div>
          </div>

          {empQ.isLoading ? (
            <Skeleton className="h-40" />
          ) : empQ.isError ? (
            <EmptyState title="Daftar belum bisa dimuat" keterangan={pesanGalat(empQ.error)} />
          ) : !empQ.data?.length ? (
            <EmptyState
              pose="selfie"
              title="Belum ada karyawan"
              keterangan="Cara paling cepat: kirim link undangan lewat WhatsApp. Karyawan cukup buka dan masuk dengan Google."
              action={<Button onClick={() => setLembar('undang')}><IconQr width={18} height={18} /> Buat link undangan</Button>}
            />
          ) : daftar.length === 0 ? (
            <p className="py-8 text-center text-[15px] text-tinta-3">Tidak ada yang cocok dengan &ldquo;{cari}&rdquo;.</p>
          ) : (
            <div className="kaca-panel divide-y divide-garis overflow-hidden rounded-[24px]">
              {daftar.map((e) => (
                <button key={e.id} type="button" onClick={() => setLembar(e)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-sumur">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sumur text-[14px] font-bold text-tinta-2">
                    {e.photoData ? <img src={e.photoData} alt="" className="h-full w-full object-cover" loading="lazy" /> : inisial(e.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold text-tinta">{e.name}</span>
                      {e.role !== 'employee' && <Badge tone="accent">{PERAN[e.role]}</Badge>}
                      {e.employmentStatus === 'inactive' && <Badge tone="danger">Nonaktif</Badge>}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-tinta-3">
                      <IconMapPin width={13} height={13} className="shrink-0" /> {namaCabang(e.branchId)}{namaDivisi(e.divisionId) ? ` · ${namaDivisi(e.divisionId)}` : ''}
                    </span>
                  </span>
                  {e.canSeeWage && e.wageBasic ? <span className="hidden text-[14px] font-medium tabular-nums text-tinta-2 sm:block">{formatIDR(e.wageBasic)}</span> : null}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <BottomSheet open={lembar === 'tambah'} onClose={() => setLembar(null)} title="Tambah karyawan" keterangan="Karyawan masuk pakai Google dengan email ini.">
        <FormKaryawan cabang={cabangQ.data ?? []} divisi={divQ.data ?? []} pemilik={pemilik} bolehUpah={bolehUpah} onSelesai={(p) => { segarkan(); setLembar(null); toast.berhasil(p) }} />
      </BottomSheet>
      <BottomSheet open={!!lembar && typeof lembar === 'object'} onClose={() => setLembar(null)} title="Ubah data karyawan">
        {typeof lembar === 'object' && lembar && (
          <FormKaryawan key={lembar.id} karyawan={lembar} cabang={cabangQ.data ?? []} divisi={divQ.data ?? []} pemilik={pemilik} bolehUpah={bolehUpah && lembar.canSeeWage} onSelesai={(p) => { segarkan(); setLembar(null); toast.berhasil(p) }} />
        )}
      </BottomSheet>
      <BottomSheet open={lembar === 'undang'} onClose={() => setLembar(null)} title="Undang karyawan" keterangan="Kirim link ini. Siapa pun yang membukanya bisa bergabung, jadi kirim ke orang yang tepat ya.">
        <FormUndang cabang={cabangQ.data ?? []} divisi={divQ.data ?? []} pemilik={pemilik} />
      </BottomSheet>
      <BottomSheet open={lembar === 'impor'} onClose={() => setLembar(null)} title="Impor karyawan dari CSV">
        <FormImpor cabang={cabangQ.data ?? []} divisi={divQ.data ?? []} onSelesai={() => { segarkan() }} onTutup={() => setLembar(null)} />
      </BottomSheet>
      <BottomSheet open={lembar === 'ekspor'} onClose={() => setLembar(null)} title="Ekspor data karyawan" lebar="lg">
        <Ekspor baris={empQ.data ?? []} namaCabang={namaCabang} namaDivisi={namaDivisi} />
      </BottomSheet>
    </div>
  )
}

function FormKaryawan({
  karyawan, cabang, divisi, pemilik, bolehUpah, onSelesai,
}: {
  karyawan?: EmployeeRow
  cabang: { id: string; name: string }[]
  divisi: { id: string; name: string }[]
  pemilik: boolean
  bolehUpah: boolean
  onSelesai: (pesan: string) => void
}) {
  const ubah = !!karyawan
  const [nama, setNama] = useState(karyawan?.name ?? '')
  const [email, setEmail] = useState(karyawan?.email ?? '')
  const [cabangId, setCabangId] = useState(karyawan?.branchId ?? cabang[0]?.id ?? '')
  const [divisiId, setDivisiId] = useState(karyawan?.divisionId ?? '')
  const [peran, setPeran] = useState<Role>((karyawan?.role as Role) ?? 'employee')
  const [upah, setUpah] = useState(karyawan?.wageBasic ?? 0)
  const [tunjangan, setTunjangan] = useState(karyawan?.wageFixedAllowance ?? 0)
  const [konfirmHapus, setKonfirmHapus] = useState(false)
  const peranTerkunci = karyawan?.role === 'owner'

  const simpan = useMutation({
    mutationFn: () => {
      const upahBag = bolehUpah ? { wageBasic: upah, wageFixedAllowance: tunjangan } : {}
      const peranBag = pemilik && !peranTerkunci ? { role: peran, scopeBranchIds: peran === 'branch_admin' || peran === 'hr' ? [cabangId] : [] } : {}
      return ubah
        ? api.updateEmployee(karyawan!.id, { name: nama.trim(), branchId: cabangId, divisionId: divisiId || null, ...peranBag, ...upahBag })
        : api.createEmployee({ name: nama.trim(), email: email.trim(), branchId: cabangId, divisionId: divisiId || undefined, ...peranBag, ...upahBag })
    },
    onSuccess: () => onSelesai(ubah ? 'Data karyawan tersimpan.' : 'Karyawan ditambahkan.'),
  })
  const status = useMutation({
    mutationFn: (s: 'active' | 'inactive') => api.updateEmployee(karyawan!.id, { employmentStatus: s }),
    onSuccess: (_d, s) => onSelesai(s === 'inactive' ? 'Karyawan dinonaktifkan.' : 'Karyawan aktif lagi.'),
  })
  const hapus = useMutation({ mutationFn: () => api.deleteEmployee(karyawan!.id), onSuccess: () => onSelesai('Karyawan dihapus. Riwayat absennya tetap tersimpan.') })
  const galat = simpan.error ?? status.error ?? hapus.error

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); simpan.mutate() }}>
      <Field label="Nama lengkap"><Input value={nama} onChange={(e) => setNama(e.target.value)} required maxLength={80} autoComplete="off" /></Field>
      {!ubah && (
        <Field label="Email Google" helper="Dipakai untuk masuk ke Absentra.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" inputMode="email" />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lokasi kerja">
          <Select value={cabangId} onChange={(e) => setCabangId(e.target.value)}>{cabang.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        </Field>
        <Field label="Divisi">
          <Select value={divisiId} onChange={(e) => setDivisiId(e.target.value)}><option value="">Tanpa divisi</option>{divisi.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </Field>
      </div>
      {pemilik && !peranTerkunci && (
        <Field label="Peran" helper={peran === 'employee' ? 'Bisa absen, lihat jadwal, ajukan cuti.' : peran === 'hr' ? 'Bisa menyetujui cuti dan melihat laporan di lokasinya.' : 'Mengelola karyawan, shift, dan laporan di lokasinya.'}>
          <Select value={peran} onChange={(e) => setPeran(e.target.value as Role)}>
            <option value="employee">Karyawan</option>
            <option value="hr">HR</option>
            <option value="branch_admin">Admin cabang</option>
          </Select>
        </Field>
      )}
      {bolehUpah && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gaji pokok (Rp)"><InputAngka rupiah nilai={upah} onNilai={setUpah} /></Field>
          <Field label="Tunjangan tetap (Rp)"><InputAngka rupiah nilai={tunjangan} onNilai={setTunjangan} /></Field>
        </div>
      )}
      <PesanGalat>{galat ? pesanGalat(galat) : null}</PesanGalat>
      <Button type="submit" size="lg" fullWidth loading={simpan.isPending} disabled={!nama.trim() || (!ubah && !email.trim()) || !cabangId}>Simpan</Button>

      {ubah && !peranTerkunci && (
        <div className="flex flex-col gap-2 border-t border-garis pt-4">
          {karyawan!.employmentStatus === 'active' ? (
            <Button variant="ghost" onClick={() => status.mutate('inactive')} loading={status.isPending}>Nonaktifkan (tidak bisa absen lagi)</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => status.mutate('active')} loading={status.isPending}>Aktifkan lagi</Button>
              {konfirmHapus ? (
                <div className="rounded-[18px] bg-galat-lembut p-3">
                  <p className="text-[14px] text-galat">Hapus {karyawan!.name} dari daftar? Riwayat absennya tetap tersimpan.</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setKonfirmHapus(false)}>Batal</Button>
                    <Button size="sm" variant="danger" onClick={() => hapus.mutate()} loading={hapus.isPending}><IconTrash width={16} height={16} /> Ya, hapus</Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setKonfirmHapus(true)}><IconTrash width={16} height={16} /> Hapus dari daftar</Button>
              )}
            </>
          )}
        </div>
      )}
    </form>
  )
}

function FormUndang({ cabang, divisi, pemilik }: { cabang: { id: string; name: string }[]; divisi: { id: string; name: string }[]; pemilik: boolean }) {
  const qc = useQueryClient()
  const { company } = useActor()
  const [cabangId, setCabangId] = useState(cabang[0]?.id ?? '')
  const [divisiId, setDivisiId] = useState('')
  const [peran, setPeran] = useState<Role>('employee')
  const [hasil, setHasil] = useState<{ token: string; expiresAt: string } | null>(null)
  const undanganQ = useQuery({ queryKey: ['invites'], queryFn: () => api.invites() })
  const buat = useMutation({
    mutationFn: () => api.createInvite({ branchId: cabangId, divisionId: divisiId || undefined, role: pemilik ? peran : 'employee', maxUses: 50, expiresInDays: 14 }),
    onSuccess: (r) => { setHasil(r); qc.invalidateQueries({ queryKey: ['invites'] }) },
  })
  const cabut = useMutation({ mutationFn: (id: string) => api.deleteInvite(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['invites'] }); toast.berhasil('Link undangan dicabut.') } })

  if (hasil) {
    const link = `${location.origin}/invite/${hasil.token}`
    const pesan = `Halo! Kamu diundang absen di ${company?.displayName ?? 'tempat kerja kita'} pakai Absentra. Buka link ini dari HP lalu masuk dengan Google: ${link}`
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <KodeQr isi={link} />
        <p className="text-[14px] text-tinta-3">Karyawan cukup memindai kode ini dengan kamera HP. Berlaku sampai {formatDate(hasil.expiresAt)}.</p>
        <p className="w-full break-all rounded-[16px] bg-sumur px-4 py-3 text-left text-[13px] text-tinta-2">{link}</p>
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => void salin(link, 'Link disalin.')}><IconCopy width={18} height={18} /> Salin link</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(pesan)}`} target="_blank" rel="noopener noreferrer" className="tombol-grafit inline-flex min-h-[46px] items-center justify-center gap-2 rounded-full text-[15px] font-semibold">
            <IconShare width={18} height={18} /> Kirim via WhatsApp
          </a>
        </div>
        <button type="button" onClick={() => setHasil(null)} className="text-[14px] font-medium text-tinta-3 hover:text-tinta">Buat link lain</button>
      </div>
    )
  }

  const aktif = (undanganQ.data ?? []).filter((u) => new Date(u.expiresAt).getTime() > Date.now() && u.usedCount < u.maxUses)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lokasi kerja"><Select value={cabangId} onChange={(e) => setCabangId(e.target.value)}>{cabang.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Divisi"><Select value={divisiId} onChange={(e) => setDivisiId(e.target.value)}><option value="">Tanpa divisi</option>{divisi.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      </div>
      {pemilik && (
        <Field label="Masuk sebagai">
          <Select value={peran} onChange={(e) => setPeran(e.target.value as Role)}>
            <option value="employee">Karyawan</option>
            <option value="hr">HR</option>
            <option value="branch_admin">Admin cabang</option>
          </Select>
        </Field>
      )}
      <PesanGalat>{buat.isError ? pesanGalat(buat.error) : null}</PesanGalat>
      <Button size="lg" fullWidth loading={buat.isPending} disabled={!cabangId} onClick={() => buat.mutate()}><IconQr width={20} height={20} /> Buat link undangan</Button>

      {aktif.length > 0 && (
        <div className="border-t border-garis pt-4">
          <p className="mb-2 text-[14px] font-semibold text-tinta-2">Link yang masih berlaku</p>
          <div className="flex flex-col gap-2">
            {aktif.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-[16px] bg-sumur px-3 py-2.5">
                <span className="min-w-0 flex-1 text-[13px] text-tinta-2">
                  {cabang.find((b) => b.id === u.branchId)?.name ?? 'Lokasi'} · {PERAN[u.role] ?? u.role} · dipakai {u.usedCount}/{u.maxUses}
                </span>
                <button type="button" aria-label="Salin link" onClick={() => void salin(`${location.origin}/invite/${u.token}`, 'Link disalin.')} className="flex h-9 w-9 items-center justify-center rounded-full text-tinta-2 hover:bg-permukaan"><IconCopy width={16} height={16} /></button>
                <button type="button" aria-label="Cabut link" onClick={() => cabut.mutate(u.id)} className="flex h-9 w-9 items-center justify-center rounded-full text-galat hover:bg-galat-lembut"><IconTrash width={16} height={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Kode QR sungguhan (pustaka uqr dimuat hanya saat dibutuhkan). Selalu hitam di atas putih supaya terbaca kamera. */
function KodeQr({ isi }: { isi: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [gagal, setGagal] = useState(false)
  useEffect(() => {
    let batal = false
    import('uqr')
      .then(({ renderSVG }) => { if (!batal) setSvg(renderSVG(isi, { ecc: 'M', border: 2, whiteColor: '#ffffff', blackColor: '#111111' })) })
      .catch(() => { if (!batal) setGagal(true) })
    return () => { batal = true }
  }, [isi])
  return (
    <div className="flex h-56 w-56 items-center justify-center overflow-hidden rounded-[24px] bg-[#fff] p-3 shadow-lembut" role="img" aria-label="Kode QR undangan">
      {svg ? <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        : gagal ? <p className="px-4 text-center text-[13px] text-[#555]">Kode QR belum bisa dibuat. Kirim link di bawah saja.</p>
        : <Spinner className="h-6 w-6 text-[#555]" />}
    </div>
  )
}

interface BarisCsv { name: string; email: string; wageBasic: number; wageFixedAllowance: number }
const MAKS_BARIS = 500
/** Pecah satu baris CSV; isian bertanda kutip boleh memuat pemisah ("Budi, S.E."). */
function pecahBaris(l: string, pemisah: string): string[] {
  const hasil: string[] = []
  let isi = ''
  let kutip = false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (kutip) {
      if (c === '"' && l[i + 1] === '"') { isi += '"'; i++ } else if (c === '"') kutip = false
      else isi += c
    } else if (c === '"') kutip = true
    else if (c === pemisah) { hasil.push(isi.trim()); isi = '' }
    else isi += c
  }
  hasil.push(isi.trim())
  return hasil
}
/** "Rp 1.500.000" / "1500000" / "1.500.000,00" jadi 1500000. */
function angkaRupiah(x?: string): number {
  if (!x) return 0
  return Number(x.trim().replace(/[.,]\d{1,2}$/, '').replace(/\D/g, '')) || 0
}
function bacaCsv(teks: string): { baris: BarisCsv[]; dilewati: number; terpotong: boolean } {
  const semua = teks.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!semua.length) return { baris: [], dilewati: 0, terpotong: false }
  const pertama = semua[0]
  const pemisah = [',', ';', '\t'].map((p) => [p, pertama.split(p).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const kepala = pertama.toLowerCase()
  const adaKepala = kepala.includes('nama') || kepala.includes('name') || kepala.includes('email')
  const isi = adaKepala ? semua.slice(1) : semua
  const sah: BarisCsv[] = []
  let dilewati = 0
  for (const l of isi) {
    const k = pecahBaris(l, pemisah)
    const r = { name: (k[0] ?? '').slice(0, 120), email: (k[1] ?? '').toLowerCase(), wageBasic: angkaRupiah(k[2]), wageFixedAllowance: angkaRupiah(k[3]) }
    if (r.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) sah.push(r)
    else dilewati++
  }
  return { baris: sah.slice(0, MAKS_BARIS), dilewati, terpotong: sah.length > MAKS_BARIS }
}

function FormImpor({ cabang, divisi, onSelesai, onTutup }: { cabang: { id: string; name: string }[]; divisi: { id: string; name: string }[]; onSelesai: () => void; onTutup: () => void }) {
  const [cabangId, setCabangId] = useState(cabang[0]?.id ?? '')
  const [divisiId, setDivisiId] = useState('')
  const [baris, setBaris] = useState<BarisCsv[]>([])
  const [catatan, setCatatan] = useState<string | null>(null)
  const [hasil, setHasil] = useState<{ created: number; skipped: string[] } | null>(null)
  const m = useMutation({ mutationFn: () => api.importEmployees({ branchId: cabangId, divisionId: divisiId || undefined, rows: baris }), onSuccess: (r) => { setHasil(r); onSelesai() } })

  const baca = (f?: File) => {
    if (!f) return
    if (f.size > 1_000_000) { toast.galat('Berkas terlalu besar. Maksimal 1 MB.'); return }
    const r = new FileReader()
    r.onload = () => {
      const h = bacaCsv(String(r.result))
      setBaris(h.baris)
      const bagian: string[] = []
      if (h.dilewati) bagian.push(`${h.dilewati} baris dilewati karena nama kosong atau email tidak sah`)
      if (h.terpotong) bagian.push(`hanya ${MAKS_BARIS} baris pertama yang diambil`)
      setCatatan(bagian.length ? bagian.join(', ') + '.' : !h.baris.length ? 'Tidak ada baris yang bisa dibaca. Cek urutan kolomnya.' : null)
    }
    r.onerror = () => toast.galat('Berkas tidak bisa dibaca.')
    r.readAsText(f)
  }

  if (hasil) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[18px] bg-inti-lembut px-4 py-3 text-[15px] text-inti-teks">
          {hasil.created} karyawan ditambahkan{hasil.skipped.length ? `, ${hasil.skipped.length} dilewati karena emailnya sudah ada` : ''}.
        </div>
        <Button fullWidth onClick={onTutup}>Selesai</Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-tinta-2">Kolom: <span className="font-semibold text-tinta">nama, email, gaji pokok, tunjangan tetap</span>. Baris judul boleh ada. Bisa dibuat dari Excel lalu simpan sebagai CSV.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lokasi kerja"><Select value={cabangId} onChange={(e) => setCabangId(e.target.value)}>{cabang.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Divisi"><Select value={divisiId} onChange={(e) => setDivisiId(e.target.value)}><option value="">Tanpa divisi</option>{divisi.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      </div>
      <label className="tombol-kaca flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-full text-[15px] font-semibold">
        <IconUpload width={18} height={18} /> Pilih berkas CSV
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => baca(e.target.files?.[0])} />
      </label>
      {catatan && <p className="rounded-[16px] bg-perlu-lembut px-4 py-3 text-[14px] text-perlu">{catatan}</p>}
      {baris.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-[16px] bg-sumur text-[14px]">
          {baris.map((r, i) => (
            <div key={i} className="flex justify-between gap-3 border-b border-garis px-3 py-2 last:border-0">
              <span className="truncate text-tinta">{r.name}</span>
              <span className="truncate text-tinta-3">{r.email}</span>
            </div>
          ))}
        </div>
      )}
      <PesanGalat>{m.isError ? pesanGalat(m.error) : null}</PesanGalat>
      <Button size="lg" fullWidth disabled={!baris.length || !cabangId} loading={m.isPending} onClick={() => m.mutate()}>
        {baris.length ? `Impor ${baris.length} karyawan` : 'Impor'}
      </Button>
    </div>
  )
}

function Ekspor({ baris, namaCabang, namaDivisi }: { baris: EmployeeRow[]; namaCabang: (id: string) => string; namaDivisi: (id?: string) => string | undefined }) {
  const unduh = () =>
    downloadCsv(
      'karyawan.csv',
      ['Nama', 'Email', 'Lokasi', 'Divisi', 'Peran', 'Status', 'GajiPokok'],
      baris.map((e) => [e.name, e.email ?? '', namaCabang(e.branchId), namaDivisi(e.divisionId) ?? '', PERAN[e.role] ?? e.role, e.employmentStatus === 'active' ? 'Aktif' : 'Nonaktif', e.canSeeWage ? e.wageBasic ?? 0 : '']),
    )
  return (
    <div className="flex flex-col gap-4">
      <div className="print-area max-h-72 overflow-auto rounded-[18px] bg-sumur">
        <div className="print-only mb-2"><h2 className="text-lg font-bold">Data karyawan</h2></div>
        <table className="w-full text-[14px]">
          <thead className="text-left text-tinta-3"><tr><th className="p-2.5 font-medium">Nama</th><th className="p-2.5 font-medium">Lokasi</th><th className="p-2.5 font-medium">Peran</th><th className="p-2.5 font-medium">Status</th></tr></thead>
          <tbody>
            {baris.map((e) => (
              <tr key={e.id} className="border-t border-garis">
                <td className="p-2.5 text-tinta">{e.name}</td>
                <td className="p-2.5 text-tinta-2">{namaCabang(e.branchId)}</td>
                <td className="p-2.5 text-tinta-2">{PERAN[e.role] ?? e.role}</td>
                <td className="p-2.5 text-tinta-2">{e.employmentStatus === 'active' ? 'Aktif' : 'Nonaktif'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={unduh}><IconDownload width={18} height={18} /> Unduh CSV</Button>
        <Button variant="secondary" onClick={() => window.print()}>Cetak / PDF</Button>
      </div>
    </div>
  )
}
