import { Section } from "@/components/section";
import { Badge, Card } from "@/components/ui";
import { CTA } from "@/components/cta";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <Section>
        <Badge>About</Badge>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Led by Remus Enuș</h1>
        <p className="mt-4 max-w-2xl text-sm text-white/70">
          Producer • Media strategist • Experience builder. Concept Hub is built to own systems, not just deliver projects.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-12">
          <Card className="p-6 md:col-span-7">
            <div className="text-xs text-white/60">Positioning</div>
            <div className="mt-2 text-lg font-semibold">Architect &gt; Vendor</div>
            <p className="mt-3 text-sm text-white/75">
              The market is drowning in content. The advantage is infrastructure: repeatable workflows, cadence, distribution and IP.
            </p>
          </Card>

          <Card className="p-6 md:col-span-5">
            <div className="text-xs text-white/60">Focus</div>
            <ul className="mt-3 space-y-2 text-sm text-white/75">
              <li>• Subscription systems</li>
              <li>• Creator platforms</li>
              <li>• Experience formats</li>
              <li>• IP development</li>
            </ul>
          </Card>
        </div>
      </Section>
      <CTA />
    </>
  );
}
