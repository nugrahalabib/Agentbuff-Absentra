# Absentra — Project Scaffold untuk Claude Code

Scaffold ini menyiapkan project **Absentra** (B2B SaaS absensi multi-tenant untuk UMKM, web-only, gratis, agentic-native via MCP) agar siap dikerjakan dengan **Claude Code**. Struktur folder, file `CLAUDE.md`, `.claude/`, rules, skills, subagents, dan konfigurasi sudah mengikuti dokumentasi resmi Claude Code.

Spesifikasi produk lengkap ada di `docs/PRD-Absentra.md` dan menjadi **sumber kebenaran tunggal** (single source of truth).

---

## Struktur folder

```
absentra/
├── CLAUDE.md                      # Memori project: dibaca setiap sesi (fakta + aturan wajib). Tetap ringkas.
├── README.md                      # File ini.
├── .gitignore                     # Mengecualikan secret, build, dan file Claude Code yang bersifat personal.
├── .mcp.json                      # MCP server level project (kosong; lihat cara mengisi di bawah).
├── docs/
│   └── PRD-Absentra.md            # PRD lengkap — sumber kebenaran. (Tidak di-import ke CLAUDE.md agar konteks ringan.)
└── .claude/
    ├── settings.json              # Permissions & konfigurasi sesi (di-commit, dibagikan ke tim).
    ├── rules/                     # Aturan teknik per-topik, aktif otomatis saat menyentuh file yang cocok (path-gated).
    │   ├── multi-tenancy.md
    │   ├── payroll-overtime.md
    │   ├── mcp-conventions.md
    │   ├── frontend-uiux.md
    │   └── security-privacy.md    # (tanpa path → selalu aktif)
    ├── skills/                    # Workflow & referensi yang dimuat saat dipakai (hemat konteks).
    │   ├── prd-lookup/SKILL.md    # /prd-lookup — cari & ringkas bagian PRD yang relevan
    │   ├── new-mcp-tool/SKILL.md  # /new-mcp-tool — scaffold tool MCP lengkap (manual)
    │   ├── tenant-audit/SKILL.md  # /tenant-audit — audit isolasi tenant pada perubahan
    │   └── commit/SKILL.md        # /commit — Conventional Commit (manual)
    ├── commands/
    │   └── spec.md                # /spec — ubah bagian PRD jadi rencana implementasi
    └── agents/                    # Subagent khusus.
        ├── tenant-isolation-reviewer.md   # reviewer read-only anti-kebocoran antar-tenant
        ├── mcp-tool-builder.md             # pembangun tool MCP sesuai konvensi
        └── qa-test-writer.md               # penulis test yang fokus pada bug nyata
```

> Catatan: dokumentasi resmi menyatakan kebanyakan project hanya butuh `CLAUDE.md` + `settings.json`. Sisanya opsional. Scaffold ini sengaja dibuat lengkap sesuai permintaan; pangkas yang tidak Anda perlukan.

---

## Apa fungsi tiap bagian

| Bagian | Kapan dimuat | Tujuan |
|---|---|---|
| `CLAUDE.md` | Setiap sesi (penuh) | Identitas project, aturan wajib (isolasi tenant, PP 35/2021, MCP parity, PDP), peta repo. Disengaja ringkas (target < 200 baris). |
| `.claude/rules/*.md` | Saat menyentuh file yang cocok dengan `paths` (kecuali yang tanpa `paths` → selalu) | Aturan teknik mendetail per-topik tanpa membebani konteks setiap saat. |
| `.claude/skills/*` | Saat di-invoke (`/nama`) atau saat Claude menilainya relevan | Workflow & referensi on-demand. Isi penuh hanya masuk konteks ketika dipakai. |
| `.claude/commands/*.md` | Saat di-invoke (`/nama`) | Mekanisme sama dengan skills (versi file tunggal). |
| `.claude/agents/*.md` | Saat tugas cocok dengan deskripsinya | Subagent dengan konteks terpisah, tool terbatas, dan system prompt sendiri. |
| `.claude/settings.json` | Setiap sesi | Permissions (allow/ask/deny), termasuk menolak baca `.env`/`secrets/`. |
| `.mcp.json` | Setiap sesi | Daftar MCP server level project (dibagikan ke tim). |

---

## Cara pakai dengan Claude Code

1. **Install Claude Code** (butuh Node.js). Lihat dokumentasi resmi: <https://code.claude.com/docs/en/overview>. Paket npm: `@anthropic-ai/claude-code`.
2. **Buka folder project** lalu jalankan:
   ```bash
   cd absentra
   claude
   ```
   Saat pertama kali, Claude Code mungkin meminta Anda mempercayai workspace (trust dialog) sebelum permission rules & skills project aktif.
3. **Jalankan `/init`.** Karena `CLAUDE.md` sudah ada, `/init` akan **menyarankan perbaikan, bukan menimpa**. Begitu Anda menambahkan kode nyata (mis. `package.json`), `/init` akan mendeteksi perintah build/test/lint dan memperkaya `CLAUDE.md`.
   - Untuk alur interaktif bertahap (menawarkan setup CLAUDE.md, skills, hooks):
     ```bash
     CLAUDE_CODE_NEW_INIT=1 claude
     /init
     ```
4. **Verifikasi yang termuat:** jalankan `/memory` untuk melihat `CLAUDE.md` + rules yang aktif, dan ketik `/` untuk melihat skills/commands yang tersedia. Jalankan `/agents` untuk mengelola subagent.

### Skills & commands yang tersedia
- `/prd-lookup <topik>` — temukan & ringkas bagian PRD yang relevan sebelum membangun fitur.
- `/spec <fitur atau §bagian>` — ubah bagian PRD menjadi rencana implementasi yang bisa Anda setujui.
- `/new-mcp-tool <nama> <read|write>` — scaffold tool MCP lengkap (Core API + otorisasi + scoping tenant + audit + konfirmasi + test).
- `/tenant-audit` — audit perubahan working-tree untuk pelanggaran isolasi tenant (jalankan sebelum commit perubahan backend/DB/API).
- `/commit` — buat Conventional Commit (tidak melakukan push).

### Subagent
- **tenant-isolation-reviewer** (read-only) — “Pakai tenant-isolation-reviewer untuk meninjau perubahan ini.”
- **mcp-tool-builder** — membangun tool MCP sesuai konvensi.
- **qa-test-writer** — menulis test (utamakan kasus isolasi tenant & kebenaran PP 35/2021).

---

## Mengisi `.mcp.json` (saat MCP server Absentra sudah dibuat)

`.mcp.json` sengaja dikosongkan (`{"mcpServers": {}}`) agar tidak ada koneksi yang gagal. Setelah server MCP Absentra ada, daftarkan, contohnya untuk server lokal saat development:

```json
{
  "mcpServers": {
    "absentra-dev": {
      "type": "stdio",
      "command": "node",
      "args": ["./apps/mcp-server/dist/index.js"]
    }
  }
}
```

Untuk server remote (Streamable HTTP, OAuth 2.1) gunakan `"type": "http"` dengan `"url"` endpoint MCP. Sesuaikan dengan implementasi Anda. Lihat: <https://code.claude.com/docs/en/mcp>.

---

## File personal (jangan di-commit)

Sudah masuk `.gitignore`. Buat manual bila perlu:
- **`CLAUDE.local.md`** (di root) — preferensi pribadi khusus project ini (URL sandbox, data uji). Dimuat berdampingan dengan `CLAUDE.md`.
- **`.claude/settings.local.json`** — override permission/konfigurasi pribadi Anda.

---

## Bahasa

File konfigurasi (CLAUDE.md, rules, skills, agents) ditulis dalam bahasa Inggris sesuai konvensi Claude Code (lebih hemat token, standar industri). Teks produk/UI Absentra menggunakan Bahasa Indonesia. Silakan terjemahkan file konfigurasi bila tim Anda lebih nyaman berbahasa Indonesia.

## Referensi resmi
- Struktur `.claude`: <https://code.claude.com/docs/en/claude-directory>
- Memory / CLAUDE.md: <https://code.claude.com/docs/en/memory>
- Skills: <https://code.claude.com/docs/en/skills>
- Subagents: <https://code.claude.com/docs/en/sub-agents>
- Settings: <https://code.claude.com/docs/en/settings>
