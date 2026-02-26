import { Section } from "@/components/section";
import { Card, Badge } from "@/components/ui";
import { CTA } from "@/components/cta";

export const metadata = { title: "Studio" };

export default function StudioPage() {
  return (
    <>
      <Section>
        <Badge>Studio</Badge>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Broadcast-level, AI-assisted.</h1>
        <p className="mt-4 max-w-2xl text-sm text-white/70">
          Leverage high-end production resources and AI workflows to compress timelines and multiply outputs.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Card className="p-6"><div className="text-xs text-white/60">Production</div><div className="mt-2 text-lg font-semibold">Fast capture</div><p className="mt-2 text-sm text-white/70">Modular setups, repeatable lighting, consistent aesthetics.</p></Card>
          <Card className="p-6"><div className="text-xs text-white/60">Post</div><div className="mt-2 text-lg font-semibold">AI workflows</div><p className="mt-2 text-sm text-white/70">Cuts, subtitles, formats, variants — accelerated.</p></Card>
          <Card className="p-6"><div className="text-xs text-white/60">Distribution</div><div className="mt-2 text-lg font-semibold">Performance loop</div><p className="mt-2 text-sm text-white/70">Iterate based on retention & engagement patterns.</p></Card>
        </div>

        <Card className="mt-10 overflow-hidden">
          <div className="bg-grid p-8 md:p-10">
            <div className="text-xs text-white/60">Replace this</div>
            <div className="mt-2 text-sm text-white/75">
              Add real studio photos/videos here. Swap with a gallery or embedded reels.
            </div>
          </div>
        </Card>
      </Section>
      <CTA />
    </>
  );
}
