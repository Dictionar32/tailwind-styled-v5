# @tailwind-styled/vite

Plugin Vite untuk tailwind-styled-v4 dengan transformasi compile-time, generasi safelist, dan integrasi engine untuk membangun CSS.

## Instalasi

```bash
npm install @tailwind-styled/vite
```

Pastikan juga dependencies yang diperlukan sudah terinstal:

```bash
npm install @tailwind-styled/compiler @tailwind-styled/engine @tailwind-styled/scanner
```

## Konfigurasi Minimal

Buat atau modifikasi file `vite.config.ts` di root project:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tailwindStyledPlugin } from '@tailwind-styled/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindStyledPlugin()
  ]
})
```

## Daftar Opsi Lengkap

| Opsi | Tipe | Default | Keterangan |
|------|------|---------|------------|
| `include` | `RegExp` | `/\.(tsx\|ts\|jsx\|js)$/` | Filter file yang diproses |
| `exclude` | `RegExp` | `/node_modules/` | File yang diabaikan |
| `scanDirs` | `string[]` | `['src']` | Direktori untuk safelist generation |
| `safelistOutput` | `string` | `.tailwind-styled-safelist.json` | Path output safelist |
| `generateSafelist` | `boolean` | `true` | Aktifkan safelist generation |
| `scanReportOutput` | `string` | `.tailwind-styled-scan-report.json` | Path output scan report |
| `useEngineBuild` | `boolean` | `true` | Gunakan engine untuk build CSS |
| `analyze` | `boolean` | `false` | Aktifkan semantic report |

## Zero-Runtime Mode

Plugin ini beroperasi dalam mode **zero-runtime**, yang berarti:

- Tidak ada runtime CSS yang diinjeksi ke aplikasi pada saat development maupun production
- Semua class seperti `tw()` ditransformasi menjadi string class pada saat compile-time
- Styling dilakukan sepenuhnya saat build, bukan saat runtime

Cara kerja plugin:
1. **Transform Phase**: Pada saat Vite melakukan transformasi file, plugin memproses semua file yang cocok dengan pola `include` dan mengecualikan `exclude`. Setiap pemanggilan `tw()`, `styled()`, atau fungsi lainnya ditransformasi menjadi string class biasa.

2. **Build End Phase**: Setelah transformasi selesai, plugin menjalankan:
   - Generasi safelist untuk memastikan semua class yang digunakan tidak di-purge oleh Tailwind
   - Scan workspace untuk analisis file
   - Build CSS menggunakan engine (jika `useEngineBuild: true`)

## Engine Build

Plugin menggunakan `@tailwind-styled/engine` untuk menghasilkan CSS final pada hook `buildEnd`. Berikut alur kerja engine:

1. **Inisialisasi Engine**: Engine dibuat dengan konfigurasi root project, opsi compile CSS, dan pengaturan scanner.

2. **Scanning**: Engine memindai workspace untuk menemukan semua file yang relevan berdasarkan ekstensi (`tsx`, `ts`, `jsx`, `js`).

3. **Analisis Class**: Engine menganalisis semua class yang digunakan dalam project.

4. **CSS Generation**: Engine menghasilkan file CSS final berdasarkan:
   - Safelist yang digenerate (untuk memastikan class tidak di-purge)
   - Konfigurasi Tailwind
   - File CSS yang di-import

Pada proses build, engine menghasilkan output yang dikonfirmasi dengan pesan: `[tailwind-styled-v4] ✓ Engine build complete`.

## Cara Menggunakan `analyze`

Opsi `analyze` digunakan untuk mengaktifkan semantic report yang memberikan informasi lebih detail tentang styling yang digunakan dalam project.

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tailwindStyledPlugin } from '@tailwind-styled/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindStyledPlugin({
      analyze: true
    })
  ]
})
```

Ketika `analyze` diaktifkan:
- Engine akan melakukan analisis lebih mendalam terhadap struktur styling
- Informasi yang lebih lengkap akan tersedia dalam scan report
- Berguna untuk debugging dan optimasi styling pada project besar

## Contoh Output Safelist

Safelist digenerate ke file `.tailwind-styled-safelist.json` dengan format:

```json
{
  "safelist": [
    "bg-red-500",
    "text-white",
    "p-4",
    "flex",
    "items-center",
    "hover:bg-blue-500",
    "md:flex-row"
  ]
}
```

Safelist ini berfungsi untuk:
- Mencegah Tailwind mem-purge class yang digunakan secara dinamik (string interpolation, kondisi dinamis, dll)
- Memastikan semua styling yang digunakan tetap ada di CSS final
- Berguna saat menggunakan pattern seperti `tw\`class-${variant}\`` atau conditional class

## Catatan Migrasi dari v4 ke v5

### Breaking Changes

Berikut adalah opsi yang di-deprecated di v5:

| Opsi Deprecated | Status |
|-----------------|--------|
| `mode` | Di-deprecate - selalu zero-runtime |
| `routeCss` | Di-deprecate - ditangani oleh engine |
| `deadStyleElimination` | Di-deprecate - gunakan `analyze: true` |
| `addDataAttr` | Di-deprecate - ditangani secara internal |
| `autoClientBoundary` | Di-deprecate - ditangani secara internal |
| `hoist` | Di-deprecate - ditangani secara internal |
| `incremental` | Di-deprecate - tidak diperlukan lagi |

### Console Warning

Jika Anda menggunakan opsi yang di-deprecate, plugin akan menampilkan warning di console:

```
[tailwind-styled-v4] Warning: 'mode' is deprecated in v5. Only zero-runtime is supported.
```

### Penjelasan Perubahan

1. **Mode Selalu Zero-Runtime**: Di v5, mode selalu `zero-runtime`. Tidak ada opsi untuk menggunakan mode runtime. Styling ditransformasi sepenuhnya pada compile-time.

2. **useEngineBuild Default True**: Engine build sekarang diaktifkan secara default. Engine menangani generasi CSS, analisis class, dan optimasi. Untuk menonaktifkan, gunakan `useEngineBuild: false`.

## Clarifikasi scanDirs

**Penting**: `scanDirs` HANYA relevan untuk safelist generation, bukan untuk engine build.

- **Safelist Generation**: `scanDirs` menentukan direktori mana yang dipindai untuk menemukan class yang digunakan secara dinamik. Nilai defaultnya adalah `['src']`.

- **Engine Build**: Engine menggunakan scanner internal dengan konfigurasi yang berbeda. Engine mengabaikan direktori yang ada di `scanDirs` saat melakukan scanning untuk build CSS (lihat `scanner.ignoreDirectories: scanDirs` di kode plugin).

Ini berarti perubahan pada `scanDirs` akan mempengaruhi:
- File yang dipindai untuk generasi safelist
- Tapi TIDAK mempengaruhi direktori yang dipindai oleh engine untuk build CSS

Jika Anda ingin mengubah direktori yang dipindai engine, Anda perlu menyesuaikan konfigurasi engine secara internal atau menghubungi dokumentasi `@tailwind-styled/engine` untuk informasi lebih lanjut.