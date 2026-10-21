/**
 * Halaman depan Absentra. Gaya Inti Hidup AgentBuff dengan aksen sendiri (cyan
 * "lencana hadir" + kisi titik). Yang dipamerkan = layar ASLI aplikasinya (DemoLayar),
 * fiturnya hanya yang benar-benar ada. Gerak: CSS ringan, hanya saat terlihat.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui'
import { TrustMeter } from '@/components/StatusBadge'
import { Gelembung, LogoAbsentra, LogoAgentBuff, Maskot, type PoseMaskot } from '@/components/merek'
import {
  IconArrowRight, IconBot, IconCheck, IconCheckCircle, IconClock, IconLayers, IconMapPin, IconMoon, IconPlus, IconReceipt, IconSun, IconWifiOff, IconX,
} from '@/components/ui/icons'
import { bacaPilihanTema, simpanPilihanTema, temaEfektif } from '@/lib/tema'
import { DemoDasbor, DemoHp } from './DemoLayar'
import './landing.css'

export default function LandingPage() {
  useMunculGulir()
  return (
    <div className="min-h-[100dvh] overflow-x-hidden">
      <Navigasi />
      <main>
        <Hero />
        <Pemilik />
        <CaraKerja />
        <Fitur />
        <UntukSiapa />
        <Harga />
        <TanyaJawab />
        <Penutup />
      </main>
      <Kaki />
    </div>
  )
}

/** Tandai `.lp-muncul` saat masuk layar (sekali saja). */
function useMunculGulir() {
  useEffect(() => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('.lp-muncul'))
    if (typeof IntersectionObserver === 'undefined') { el.forEach((e) => (e.dataset.tampil = '1')); return }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { (e.target as HTMLElement).dataset.tampil = '1'; io.unobserve(e.target) } }),
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    )
    el.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
}

function Navigasi() {
  const [gulir, setGulir] = useState(false)
  const [tema, setTema] = useState(() => temaEfektif(bacaPilihanTema()))
  useEffect(() => {
    const f = () => setGulir(window.scrollY > 12)
    f()
    window.addEventListener('scroll', f, { passive: true })
    return () => window.removeEventListener('scroll', f)
  }, [])
  return (
    <header className={`sticky top-0 z-40 transition-[background-color,box-shadow] ${gulir ? 'kaca-bilah' : ''}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 lg:px-8 lg:py-4">
        <Link to="/" aria-label="Absentra"><LogoAbsentra ukuran={32} /></Link>
        <nav aria-label="Bagian halaman" className="hidden items-center gap-7 text-[15px] font-medium text-tinta-2 md:flex">
          <a href="#cara" className="hover:text-tinta">Cara kerja</a>
          <a href="#fitur" className="hover:text-tinta">Fitur</a>
          <a href="#harga" className="hover:text-tinta">Harga</a>
          <a href="#tanya" className="hover:text-tinta">Tanya jawab</a>
        </nav>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={tema === 'dark' ? 'Pakai mode terang' : 'Pakai mode gelap'}
            onClick={() => { const t = tema === 'dark' ? 'terang' : 'gelap'; simpanPilihanTema(t); setTema(t === 'gelap' ? 'dark' : 'light') }}
            className="flex h-10 w-10 items-center justify-center rounded-full text-tinta-2 hover:bg-sumur"
          >
            {tema === 'dark' ? <IconSun width={19} height={19} /> : <IconMoon width={19} height={19} />}
          </button>
          <Link to="/masuk" className="flex h-10 items-center whitespace-nowrap rounded-full px-2.5 text-[15px] font-semibold text-tinta hover:bg-sumur sm:px-4">Masuk</Link>
          <Link to="/daftar" className="tombol-grafit flex h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[15px] font-semibold sm:px-4">Coba gratis</Link>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative">
      <div className="lp-kisi pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-14 pt-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-14 lg:px-8 lg:pb-20 lg:pt-12">
        <div className="min-w-0">
          <a href="https://agentbuff.id" target="_blank" rel="noopener noreferrer" className="kaca-pil inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium text-tinta-2">
            <LogoAgentBuff ukuran={22} /> Dari keluarga <span className="font-semibold text-tinta">AgentBuff</span>
          </a>
          <h1 className="mt-6 text-[44px] font-bold leading-[1] tracking-[-0.045em] text-tinta sm:text-[60px] lg:text-[72px]">
            Absen karyawan
            <br />
            <span className="lp-teks-aksen">cukup dari HP.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-tinta-2 sm:text-[19px]">
            Tanpa mesin sidik jari, tanpa buku absen. Karyawan cukup buka HP, absen pakai lokasi dan foto. Kamu langsung tahu siapa yang sudah datang, siapa yang telat, dan berapa lemburnya.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/daftar" className="tombol-grafit flex min-h-[56px] items-center justify-center gap-2 rounded-full px-7 text-[17px] font-semibold">
              Coba Absentra <IconArrowRight width={19} height={19} />
            </Link>
            <a href="#cara" className="tombol-kaca flex min-h-[56px] items-center justify-center rounded-full px-7 text-[17px] font-semibold">Lihat cara kerjanya</a>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-tinta-2">
            {['Karyawan tidak perlu instal aplikasi', 'Bisa di Android dan iPhone', 'Siap dalam 5 menit'].map((x) => (
              <li key={x} className="flex items-center gap-1.5"><IconCheck width={16} height={16} className="text-aksen-teks" /> {x}</li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto flex items-end justify-center">
          <div className="cahaya-aksen absolute -inset-16" aria-hidden />
          <div className="relative -mr-10 hidden self-end sm:block" aria-hidden>
            <Maskot pose="selfie" ukuran="besar" prioritas className="relative z-10" />
          </div>
          <DemoHp />
        </div>
      </div>
      <div className="lp-tali mx-auto max-w-5xl" aria-hidden />
    </section>
  )
}

function Pemilik() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 lg:px-8 lg:py-24">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="lp-muncul">
          <p className="text-[15px] font-semibold lp-teks-aksen">Untuk pemilik usaha</p>
          <h2 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.04em] text-tinta sm:text-[44px]">Buka HP, langsung tahu keadaan hari ini.</h2>
          <ul className="mt-6 flex flex-col gap-4">
            {[
              ['Siapa sudah masuk dan siapa belum, terlihat saat itu juga.', <IconClock key="a" width={20} height={20} />],
              ['Absen yang janggal ditandai. Kamu tinggal cek foto dan lokasinya.', <IconCheckCircle key="b" width={20} height={20} />],
              ['Cuti dan lembur cukup disetujui dari HP, rekap gajinya ikut beres.', <IconReceipt key="c" width={20} height={20} />],
            ].map(([t, ikon]) => (
              <li key={t as string} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-permukaan text-tinta shadow-lembut">{ikon}</span>
                <span className="pt-2 text-[16px] text-tinta-2">{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="lp-muncul"><DemoDasbor /></div>
      </div>
    </section>
  )
}

const LANGKAH: { pose: PoseMaskot; judul: string; isi: string }[] = [
  { pose: 'peta', judul: 'Tandai lokasi usahamu', isi: 'Tempel link Google Maps atau pakai lokasimu sekarang, lalu atur radiusnya. Misalnya 100 meter.' },
  { pose: 'jadwal', judul: 'Atur jam kerja', isi: 'Shift pagi, siang, sampai malam. Susun jadwal seminggu untuk banyak orang sekaligus.' },
  { pose: 'selfie', judul: 'Undang lewat WhatsApp', isi: 'Karyawan buka link atau pindai kode QR, masuk dengan Google, lalu langsung bisa absen.' },
]

function CaraKerja() {
  return (
    <section id="cara" className="scroll-mt-20 py-16 lg:py-24">
      <div className="mx-auto max-w-6xl px-5 lg:px-8">
        <div className="lp-muncul mx-auto max-w-2xl text-center">
          <p className="text-[15px] font-semibold lp-teks-aksen">Cara kerja</p>
          <h2 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.04em] text-tinta sm:text-[44px]">Siap dipakai dalam lima menit.</h2>
        </div>
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {LANGKAH.map((l, i) => (
            <li key={l.judul} className="lp-muncul kaca-panel relative flex flex-col items-center overflow-hidden rounded-[28px] px-6 pb-7 pt-6 text-center" style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="absolute left-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-grafit text-[14px] font-bold text-grafit-teks">{i + 1}</span>
              <div className="relative">
                <div className="cahaya-aksen absolute -inset-6" aria-hidden />
                <Maskot pose={l.pose} ukuran="sedang" className="relative" />
              </div>
              <h3 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-tinta">{l.judul}</h3>
              <p className="mt-2 text-[15px] text-tinta-2">{l.isi}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Ubin({ judul, isi, children, className = '', ikon }: { judul: string; isi: string; children?: ReactNode; className?: string; ikon?: ReactNode }) {
  return (
    <article className={`lp-muncul kaca-panel flex flex-col overflow-hidden rounded-[28px] p-6 ${className}`}>
      {ikon && <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-permukaan text-tinta shadow-lembut">{ikon}</span>}
      <h3 className="text-[21px] font-semibold leading-tight tracking-[-0.025em] text-tinta">{judul}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-tinta-2">{isi}</p>
      {children && <div className="mt-5 flex-1">{children}</div>}
    </article>
  )
}

function Fitur() {
  return (
    <section id="fitur" className="scroll-mt-20 mx-auto max-w-6xl px-5 py-16 lg:px-8 lg:py-24">
      <div className="lp-muncul max-w-2xl">
        <p className="text-[15px] font-semibold lp-teks-aksen">Fitur</p>
        <h2 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.04em] text-tinta sm:text-[44px]">Yang biasanya bikin pusing, sudah diurus.</h2>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-6">
        <Ubin className="md:col-span-4" judul="Absen pakai lokasi dan foto" isi="Absen hanya dianggap di tempat kalau dalam radius lokasi kerja. Foto wajahnya bikin titip absen jadi susah.">
          <div className="relative flex h-44 items-center justify-center overflow-hidden rounded-[22px] bg-sumur">
            <span className="lp-radar absolute h-40 w-40 rounded-full bg-aksen/25" aria-hidden />
            <span className="absolute h-40 w-40 rounded-full border-2 border-dashed border-aksen/50" aria-hidden />
            <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-aksen-isi text-aksen-isi-teks shadow-lembut"><IconMapPin width={24} height={24} /></span>
            <span className="kaca-pil absolute bottom-3 left-3 rounded-full px-3 py-1.5 text-[13px] font-semibold text-tinta">Toko Pusat · radius 100 m</span>
            <span className="absolute right-3 top-3"><Badge tone="success" icon={<IconCheck width={12} height={12} />}>Di lokasi kerja</Badge></span>
          </div>
        </Ubin>
        <Ubin className="md:col-span-2" judul="Ditandai, bukan ditolak" isi="Sinyal GPS kadang lemah. Absen yang janggal tetap masuk tapi ditandai, kamu yang memutuskan.">
          <div className="flex flex-col gap-3 rounded-[22px] bg-sumur p-4">
            <TrustMeter score={92} />
            <TrustMeter score={55} />
          </div>
        </Ubin>
        <Ubin className="md:col-span-3" judul="Rekap gaji tanpa kalkulator" isi="Lembur dihitung sesuai PP 35/2021, potongan telat dan uang makan ikut. Tinggal unduh ke Excel.">
          <div className="overflow-hidden rounded-[22px] bg-sumur text-[14px]">
            {[['Rina', '6 jam', 'Rp242.772'], ['Dimas', '2 jam', 'Rp80.924'], ['Ayu', '-', '-']].map(([n, j, u]) => (
              <div key={n} className="flex items-center justify-between border-b border-garis px-4 py-2.5 last:border-0">
                <span className="font-semibold text-tinta">{n}</span>
                <span className="tabular-nums text-tinta-3">{j}</span>
                <span className="font-semibold tabular-nums text-tinta">{u}</span>
              </div>
            ))}
          </div>
        </Ubin>
        <Ubin className="md:col-span-3" judul="Cuti dan lembur lewat HP" isi="Karyawan mengajukan dari HP, kamu setujui dari HP. Semuanya tercatat rapi.">
          <div className="rounded-[22px] bg-sumur p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold text-tinta">Ayu Lestari</p>
                <p className="text-[13px] text-tinta-3">24 sampai 25 Oktober</p>
              </div>
              <Badge tone="accent">Cuti tahunan</Badge>
            </div>
            <div className="mt-3 flex gap-2">
              <span className="tombol-kaca flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold"><IconX width={16} height={16} /> Tolak</span>
              <span className="tombol-grafit flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold"><IconCheck width={16} height={16} /> Setujui</span>
            </div>
          </div>
        </Ubin>
        <Ubin className="md:col-span-2" ikon={<IconMoon width={20} height={20} />} judul="Shift malam aman" isi="Masuk jam 10 malam, pulang jam 6 pagi, tetap tercatat sebagai satu shift." />
        <Ubin className="md:col-span-2" ikon={<IconWifiOff width={20} height={20} />} judul="Sinyal hilang? Tetap tercatat" isi="Absen disimpan di HP dulu, lalu terkirim sendiri dengan jam aslinya begitu ada sinyal." />
        <Ubin className="md:col-span-2" ikon={<IconLayers width={20} height={20} />} judul="Banyak cabang, satu layar" isi="Admin cabang hanya melihat cabangnya. Kamu sebagai pemilik melihat semuanya." />
        <Ubin className="md:col-span-6" ikon={<IconBot width={20} height={20} />} judul="Tinggal tanya agen AI-mu" isi="Absentra tersambung ke agen AgentBuff-mu. Tanya dari chat atau WhatsApp, tanpa membuka laporan.">
          <div className="mx-auto flex max-w-2xl flex-col gap-2.5">
            <div className="ml-auto max-w-sm rounded-[20px] rounded-br-[6px] bg-grafit px-4 py-3 text-[15px] text-grafit-teks">Siapa yang belum absen hari ini?</div>
            <Gelembung className="mr-auto max-w-md !rounded-[20px] !rounded-bl-[6px] text-[15px]">Dimas dan Yoga belum absen. Dimas shift pagi mulai 08.00, sudah telat 17 menit.</Gelembung>
          </div>
        </Ubin>
      </div>
    </section>
  )
}

const USAHA = ['Warung & kafe', 'Rumah makan', 'Toko & minimarket', 'Salon & barbershop', 'Bengkel', 'Laundry', 'Klinik & apotek', 'Kantor kecil', 'Produksi rumahan', 'Gudang & ekspedisi']

function UntukSiapa() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-12 lg:px-8 lg:py-16">
      <div className="lp-muncul kaca-panel flex flex-col items-center gap-6 rounded-[32px] px-6 py-10 text-center lg:flex-row lg:text-left">
        <Maskot pose="jadwal" ukuran="sedang" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-tinta sm:text-[34px]">Cocok untuk usaha yang karyawannya datang ke tempat kerja.</h2>
          <div className="mt-5 flex flex-wrap justify-center gap-2 lg:justify-start">
            {USAHA.map((u) => <span key={u} className="kaca-pil rounded-full px-4 py-2 text-[14px] font-medium text-tinta-2">{u}</span>)}
          </div>
        </div>
      </div>
    </section>
  )
}

function Harga() {
  return (
    <section id="harga" className="scroll-mt-20 mx-auto max-w-6xl px-5 py-16 lg:px-8 lg:py-24">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="lp-muncul">
          <p className="text-[15px] font-semibold lp-teks-aksen">Harga</p>
          <h2 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.04em] text-tinta sm:text-[44px]">Absentra gratis untuk pemilik akun AgentBuff.</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-tinta-2">Ambil Absentra di Marketplace AgentBuff dengan harga Rp0. Yang kamu perlukan cuma akun AgentBuff yang aktif, dan akun baru bisa dicoba gratis dulu.</p>
        </div>
        <div className="lp-muncul kaca-panel rounded-[32px] p-7">
          <div className="flex items-baseline gap-2">
            <span className="text-[56px] font-bold leading-none tracking-[-0.05em] text-tinta">Rp0</span>
            <span className="text-[16px] text-tinta-3">untuk Absentra</span>
          </div>
          <ul className="mt-6 flex flex-col gap-3">
            {[
              'Karyawan tidak perlu bayar dan tidak perlu akun AgentBuff',
              'Tanpa mesin absen dan tanpa biaya pasang',
              'Rekap gaji, laporan, dan ekspor Excel sudah termasuk',
              'Kalau akses AgentBuff-mu berhenti, data absensi tetap tersimpan',
            ].map((x) => (
              <li key={x} className="flex gap-3 text-[15px] text-tinta-2"><IconCheckCircle width={20} height={20} className="mt-0.5 shrink-0 text-aksen-teks" /> {x}</li>
            ))}
          </ul>
          <Link to="/daftar" className="tombol-grafit mt-7 flex min-h-[54px] items-center justify-center gap-2 rounded-full text-[16px] font-semibold">
            Daftarkan usahamu <IconArrowRight width={18} height={18} />
          </Link>
        </div>
      </div>
    </section>
  )
}

const TANYA: [string, string][] = [
  ['Karyawan harus instal aplikasi?', 'Tidak. Absentra dibuka dari peramban HP seperti Chrome atau Safari. Kalau mau, bisa ditambahkan ke layar utama supaya terasa seperti aplikasi.'],
  ['Bagaimana kalau ada yang pakai GPS palsu?', 'Absen lewat HP mana pun tidak bisa menjamin seratus persen. Absentra menggabungkan lokasi, akurasi GPS, foto wajah, dan perpindahan yang tidak masuk akal. Yang janggal ditandai supaya kamu bisa cek fotonya. Kalau mau lebih ketat, absen yang meragukan bisa langsung ditolak.'],
  ['Bisa untuk shift malam?', 'Bisa. Shift yang melewati tengah malam tetap tercatat sebagai satu shift, dari absen masuk sampai absen keluar.'],
  ['Kalau sinyal di tempat kerja jelek?', 'Absen tetap bisa. Kalau sinyal hilang saat dikirim, absen disimpan di HP lalu terkirim sendiri dengan jam aslinya begitu online.'],
  ['Lembur dan potongan telatnya dihitung bagaimana?', 'Lembur mengikuti PP 35/2021: upah sebulan dibagi 173, lalu dikali pengali sesuai jam ke berapa dan jenis harinya. Potongan telat dan uang makan mengikuti aturan yang kamu atur sendiri. Absentra membuat rekapnya, bukan mentransfer gaji.'],
  ['Data lokasi dan foto karyawan aman?', 'Lokasi dan foto hanya diambil saat absen, dan hanya setelah karyawan menyetujuinya. Yang bisa melihat cuma pemilik dan admin yang berhak. Foto dihapus otomatis setelah jangka waktu yang kamu atur.'],
  ['Kenapa pemilik masuk pakai akun AgentBuff?', 'Absentra bagian dari keluarga AgentBuff. Dengan akun yang sama, agen AI-mu di AgentBuff bisa langsung membantu, misalnya merekap absen minggu ini atau mengingatkan siapa yang belum masuk.'],
]

function TanyaJawab() {
  return (
    <section id="tanya" className="scroll-mt-20 mx-auto max-w-3xl px-5 py-16 lg:px-8 lg:py-24">
      <h2 className="lp-muncul text-center text-[34px] font-bold leading-[1.05] tracking-[-0.04em] text-tinta sm:text-[44px]">Yang sering ditanyakan</h2>
      <div className="mt-10 flex flex-col gap-3">
        {TANYA.map(([t, j]) => (
          <details key={t} className="lp-faq lp-muncul kaca-panel rounded-[24px] px-5 py-1">
            <summary className="flex min-h-[60px] cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold text-tinta">
              {t}
              <span className="lp-faq-ikon flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sumur transition-transform"><IconPlus width={16} height={16} /></span>
            </summary>
            <p className="pb-5 text-[15px] leading-relaxed text-tinta-2">{j}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function Penutup() {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <section className="mx-auto max-w-6xl px-5 pb-16 lg:px-8 lg:pb-24">
      <div ref={ref} className="lp-muncul relative overflow-hidden rounded-[36px] bg-grafit px-6 py-12 text-grafit-teks sm:px-12 lg:py-16">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <h2 className="text-[34px] font-bold leading-[1.05] tracking-[-0.04em] sm:text-[48px]">Mulai minggu ini.<br />Absen jadi nggak ribet.</h2>
            <p className="mt-4 max-w-lg text-[17px] opacity-80">Siapkan usahamu sekali, kirim link ke karyawan, besok pagi mereka sudah bisa absen dari HP.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/daftar" className="flex min-h-[56px] items-center justify-center gap-2 rounded-full bg-kanvas px-7 text-[17px] font-semibold text-tinta">Coba Absentra <IconArrowRight width={19} height={19} /></Link>
              <Link to="/masuk" className="flex min-h-[56px] items-center justify-center rounded-full px-7 text-[17px] font-semibold ring-1 ring-grafit-teks/30">Sudah punya akun? Masuk</Link>
            </div>
            <p className="mt-5 text-[14px] opacity-70">Karyawan? Buka link undangan dari atasanmu.</p>
          </div>
          <Maskot pose="pulang" ukuran="besar" className="mx-auto hidden sm:block" />
        </div>
      </div>
    </section>
  )
}

function Kaki() {
  return (
    <footer className="border-t border-garis">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-[14px] text-tinta-3 sm:flex-row lg:px-8">
        <LogoAbsentra ukuran={28} />
        <p className="text-center">Absensi karyawan dari HP untuk UMKM Indonesia. Bagian dari <a href="https://agentbuff.id" className="font-semibold text-tinta-2 hover:text-tinta">AgentBuff</a>.</p>
        <p>© 2026 Absentra</p>
      </div>
    </footer>
  )
}
