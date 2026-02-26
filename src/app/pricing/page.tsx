import { Section } from "@/components/section";
import { Badge, Card, Button } from "@/components/ui";
import Link from "next/link";
import { CTA } from "@/components/cta";

export const metadata = { title: "Pricing" };

const tiers = [
  { name: "FOUNDERS", price: "1.800€ / month", note: "For SMEs that need consistency.",
    items: ["12–16 assets", "1 mini session / month", "Vertical-first", "Basic reporting"] },
  { name: "CORPORATE", price: "3.500€ / month", note: "Best fit in RO: always-on system.", highlight: true,
    items: ["40–80 assets", "1 filming day / month", "Ads + organic variants", "Performance loop"] },
  { name: "TALENT", price: "5.500€ / month", note: "For creators, CEOs, experts.",
    items: ["Podcast + shorts engine", "Channel packaging", "Sponsor kit", "Monetization support"] }
];

export default function PricingPage() {
  return (
    <>
      <Section>
        <Badge>Pricing</Badge>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Subscription packages</h1>
        <p className="mt-4 max-w-2xl text-sm text-white/70">
          Transparent pricing. We prioritize monthly systems. One‑off projects are rarely accepted.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <Card key={t.name} className={"p-6 md:p-7 " + (t.highlight ? "ring-1 ring-accent-500/40 bg-white/[0.05]" : "")}>
              <div className="text-xs text-white/60">PACKAGE</div>
              <div className="mt-2 text-xl font-semibold">{t.name}</div>
              <div className="mt-3 text-2xl font-semibold tracking-tight">{t.price}</div>
              <div className="mt-2 text-sm text-white/70">{t.note}</div>
              <ul className="mt-5 space-y-2 text-sm text-white/75">{t.items.map((i) => <li key={i}>• {i}</li>)}</ul>
              <div className="mt-6">
                <Link href="/contact">
                  <Button className="w-full" variant={t.highlight ? "primary" : "outline"}>Apply</Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </Section>
      <CTA />
    </>
  );
}
