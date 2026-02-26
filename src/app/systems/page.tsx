import { Section } from "@/components/section";
import { Card, Badge } from "@/components/ui";
import { CTA } from "@/components/cta";

export const metadata = { title: "Systems" };

const blocks = [
  { id: "always-on", title: "Always‑On Content Engine",
    bullets: ["Monthly subscription (not one‑off).","1 filming day → 40–80 assets (vertical-first).","Ads + organic variants, fast iterations.","Performance feedback loop."],
    useFor: "Brands that need constant output + consistency." },
  { id: "creator-studio", title: "Creator & Celebrity Studio",
    bullets: ["Podcast + shortform engine.","Channel packaging + publishing cadence.","Brand deals + sponsorship packaging.","IP-friendly structure (series)."],
    useFor: "Founders, experts, talent building owned media." },
  { id: "experience", title: "Experience Formats",
    bullets: ["Events built as repeatable formats.","Modular setpieces & activations.","Sponsor-friendly packages.","Content capture baked-in."],
    useFor: "Brands that want IRL attention + online distribution." },
  { id: "format-lab", title: "Format Development Lab",
    bullets: ["Rapid prototyping (pilot assets fast).","TV + digital format bible.","Pitch decks + sizzle workflows.","Licensing/ownership-friendly."],
    useFor: "Platforms, broadcasters, brands funding IP." }
];

export default function SystemsPage() {
  return (
    <>
      <Section>
        <Badge>Systems</Badge>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">What we build</h1>
        <p className="mt-4 max-w-2xl text-sm text-white/70">
          Concept Hub sells systems. If you want a one‑off video, we’re not a fit.
        </p>

        <div className="mt-10 grid gap-4">
          {blocks.map((b) => (
            <Card key={b.id} id={b.id} className="p-6 md:p-8 scroll-mt-24">
              <div className="grid gap-6 md:grid-cols-12 md:items-start">
                <div className="md:col-span-4">
                  <div className="text-xs text-white/60">SYSTEM</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">{b.title}</div>
                </div>
                <div className="md:col-span-5">
                  <ul className="space-y-2 text-sm text-white/75">
                    {b.bullets.map((x) => <li key={x}>• {x}</li>)}
                  </ul>
                </div>
                <div className="md:col-span-3">
                  <div className="text-xs text-white/60">Use for</div>
                  <div className="mt-2 text-sm text-white/75">{b.useFor}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>
      <CTA />
    </>
  );
}
