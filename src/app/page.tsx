import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import { Section } from "@/components/section";
import { CTA } from "@/components/cta";

const systems = [
  { title: "Always‑On Content Engine", desc: "Subscription content system: filming + post + multi‑platform output.", href: "/systems#always-on" },
  { title: "Creator & Celebrity Studio", desc: "A production + monetization stack for talent, founders and experts.", href: "/systems#creator-studio" },
  { title: "Experience Formats", desc: "Repeatable live concepts built as formats, not one‑offs.", href: "/systems#experience" },
  { title: "Format Development Lab", desc: "TV & digital IP development with fast prototyping.", href: "/systems#format-lab" }
];

export default function Page() {
  return (
    <>
      <Section className="pt-12 md:pt-16">
        <div className="grid gap-10 md:grid-cols-12 md:items-center">
          <div className="md:col-span-7">
            <Badge>Media Infrastructure • Bucharest</Badge>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl">
              Media Infrastructure <span className="text-white/70">for Brands & Talent</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-white/70">
              Concept Hub Team builds scalable content systems, creator platforms and experiential formats.
              Broadcast-level production powered by AI workflows.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/contact"><Button>Enter the Studio</Button></Link>
              <Link href="/systems"><Button variant="outline">Explore Systems</Button></Link>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              <Card className="p-4"><div className="text-xs text-white/60">Output</div><div className="mt-1 text-sm font-semibold">Always‑on cadence</div></Card>
              <Card className="p-4"><div className="text-xs text-white/60">Quality</div><div className="mt-1 text-sm font-semibold">Broadcast-level</div></Card>
              <Card className="p-4"><div className="text-xs text-white/60">Speed</div><div className="mt-1 text-sm font-semibold">AI‑assisted</div></Card>
            </div>
          </div>

          <div className="md:col-span-5">
            <Card className="relative overflow-hidden p-6">
              <div className="absolute inset-0 bg-grid opacity-[0.12]" aria-hidden />
              <div className="relative">
                <div className="text-xs text-white/60">How it works</div>
                <div className="mt-3 space-y-2 text-sm text-white/75">
                  <div>IDEA → AI PRODUCTION → MULTI‑PLATFORM</div>
                  <div>AUDIENCE DATA → MONETIZATION</div>
                </div>

                <div className="mt-6 rounded-lg border border-white/10 bg-black/30 p-4">
                  <div className="text-xs text-white/60">Typical monthly package</div>
                  <ul className="mt-2 space-y-1 text-sm text-white/75">
                    <li>• 1 filming day</li>
                    <li>• 40–80 assets (vertical-first)</li>
                    <li>• ads + organic variants</li>
                    <li>• performance feedback loop</li>
                  </ul>
                </div>

                <div className="mt-6 text-xs text-white/55">Not for one-off projects. We run systems.</div>
              </div>
            </Card>
          </div>
        </div>
      </Section>

      <Section className="pt-0">
        <div className="grid gap-6 md:grid-cols-12">
          <div className="md:col-span-4">
            <h2 className="text-2xl font-semibold tracking-tight">What we build</h2>
            <p className="mt-3 text-sm text-white/70">Services don’t scale. Systems do.</p>
          </div>
          <div className="md:col-span-8">
            <div className="grid gap-4 sm:grid-cols-2">
              {systems.map((s) => (
                <Link key={s.title} href={s.href}>
                  <Card className="h-full p-5 hover:bg-white/[0.05] transition">
                    <div className="text-sm font-semibold">{s.title}</div>
                    <div className="mt-2 text-sm text-white/70">{s.desc}</div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section className="pt-0">
        <Card className="p-7 md:p-10">
          <div className="grid gap-8 md:grid-cols-12 md:items-center">
            <div className="md:col-span-7">
              <div className="text-xs text-white/60">Reality</div>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
                Every company is becoming a media company.
              </h3>
              <p className="mt-3 text-sm text-white/70">
                Most fail because they lack infrastructure: consistent production, workflows, distribution and feedback loops.
                We provide the system.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/case-studies"><Button variant="outline">See proof</Button></Link>
                <Link href="/pricing"><Button>See packages</Button></Link>
              </div>
            </div>
            <div className="md:col-span-5">
              <div className="rounded-xl border border-white/12 bg-black/30 p-5 text-sm text-white/75">
                <div className="text-xs text-white/60">Core loops</div>
                <ul className="mt-3 space-y-2">
                  <li>• Production loop (weekly)</li>
                  <li>• Performance loop (daily)</li>
                  <li>• Monetization loop (monthly)</li>
                </ul>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <CTA />
    </>
  );
}
