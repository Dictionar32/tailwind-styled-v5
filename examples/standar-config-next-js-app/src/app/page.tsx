/**
 * Showcase — demonstrasi semua components tailwind-styled-v4
 *
 * Menggunakan:
 *  - tw template literal
 *  - tw({ base, variants }) object config
 *  - tw(Component) extend
 *  - cv() class variant function
 *  - cx() conditional merge
 *  - tw.server server-only component
 */

import { tw, server } from "tailwind-styled-v4"
import { Button } from "@/components/Button"
import { Card, CardHeader, CardTitle, CardBadge, CardBody, CardFooter } from "@/components/Card"
import { Badge } from "@/components/Badge"
import { Alert } from "@/components/Alert"
import { Avatar, AvatarGroup } from "@/components/Avatar"
import { Input, Textarea } from "@/components/Input"

// ── Layout (RSC, module-level) ────────────────────────────────────────────────
const Page = tw.div`mx-auto max-w-4xl px-6 py-10 space-y-12`
const SectionTitle = server.h2`
  text-lg font-semibold text-gray-900 mb-4 pb-2
  border-b border-gray-100
`
const Row = tw.div`flex flex-wrap items-center gap-3`
const Grid = tw.div`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`

// ── Data ──────────────────────────────────────────────────────────────────────
const teamMembers = [
  { name: "Ahmad Rizky" },
  { name: "Budi Santoso" },
  { name: "Clara Dewi" },
  { name: "Dian Pratama" },
  { name: "Eka Surya" },
  { name: "Fajar Nugroho" },
  { name: "Gita Maharani" },
]

const products = [
  { name: "Pro Plan",   price: "$29/mo", badge: "Popular",    color: "blue" as const,   desc: "Untuk tim kecil hingga 10 orang." },
  { name: "Team Plan",  price: "$79/mo", badge: "New",        color: "green" as const,  desc: "Kolaborasi tak terbatas." },
  { name: "Enterprise", price: "Custom", badge: "Contact us", color: "purple" as const, desc: "SLA, SSO, dan dedicated support." },
]

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ShowcasePage() {
  return (
    <Page>

      {/* ── Button ─────────────────────────────────────── */}
      <section>
        <SectionTitle>Button — cv() variants + compoundVariants</SectionTitle>
        <Row>
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </Row>
        <Row className="mt-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Row>
        <Row className="mt-3">
          <Button loading>Loading...</Button>
          <Button disabled>Disabled</Button>
          <Button variant="outline" size="lg">Outline + Large (compound)</Button>
        </Row>
      </section>

      {/* ── Badge ──────────────────────────────────────── */}
      <section>
        <SectionTitle>Badge — tw({"{"}base, variants{"}"}) object config</SectionTitle>
        <Row>
          <Badge>Default</Badge>
          <Badge color="blue">Blue</Badge>
          <Badge color="green" dot>Active</Badge>
          <Badge color="yellow" dot>Pending</Badge>
          <Badge color="red" dot>Error</Badge>
          <Badge color="purple" size="lg">Large Purple</Badge>
        </Row>
      </section>

      {/* ── Alert ──────────────────────────────────────── */}
      <section>
        <SectionTitle>Alert — cx() conditional merge + dismissible</SectionTitle>
        <div className="space-y-3">
          <Alert type="info" title="Informasi">
            Komponen ini menggunakan cx() untuk merge class secara kondisional.
          </Alert>
          <Alert type="success" title="Berhasil!" dismissible>
            Data berhasil disimpan. Klik tanda X untuk menutup alert ini.
          </Alert>
          <Alert type="warning" title="Perhatian">
            Sisa kuota API kamu tinggal 10%. Upgrade sekarang.
          </Alert>
          <Alert type="error" title="Terjadi Error" dismissible>
            Gagal memuat data. Silakan coba lagi.
          </Alert>
        </div>
      </section>

      {/* ── Avatar ─────────────────────────────────────── */}
      <section>
        <SectionTitle>Avatar — tw.server RSC-only + AvatarGroup</SectionTitle>
        <Row>
          <Avatar name="Ahmad Rizky" size="xs" />
          <Avatar name="Budi Santoso" size="sm" />
          <Avatar name="Clara Dewi" size="md" />
          <Avatar name="Dian Pratama" size="lg" />
          <Avatar name="Eka Surya" size="xl" />
        </Row>
        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">AvatarGroup — overflow +N</p>
          <AvatarGroup users={teamMembers} max={4} size="md" />
        </div>
      </section>

      {/* ── Input ──────────────────────────────────────── */}
      <section>
        <SectionTitle>Input + Textarea — tw(Component) extend + error state</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Email"
            type="email"
            placeholder="hello@example.com"
            hint="Kami tidak akan spam."
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            error="Password minimal 8 karakter."
          />
          <Input
            label="Search"
            type="search"
            placeholder="Cari produk..."
            prefix="🔍"
          />
          <Input
            label="Harga"
            type="number"
            placeholder="0"
            prefix="Rp"
            suffix="IDR"
          />
          <div className="sm:col-span-2">
            <Textarea
              label="Pesan"
              rows={3}
              placeholder="Tulis pesan kamu di sini..."
              hint="Maksimal 500 karakter."
            />
          </div>
        </div>
      </section>

      {/* ── Card ───────────────────────────────────────── */}
      <section>
        <SectionTitle>Card — tw(Component) extend + komponen komposisi</SectionTitle>
        <Grid>
          {products.map((p) => (
            <Card key={p.name} hoverable>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardBadge>{p.badge}</CardBadge>
              </CardHeader>
              <CardBody>{p.desc}</CardBody>
              <CardFooter>
                <span className="text-xl font-bold text-gray-900">{p.price}</span>
                <Button size="sm" className="ml-auto">Pilih</Button>
              </CardFooter>
            </Card>
          ))}
        </Grid>
      </section>

    </Page>
  )
}
