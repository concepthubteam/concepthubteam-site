import { Section } from "@/components/section";
import { Card, Badge, Button } from "@/components/ui";
import Link from "next/link";
import { CTA } from "@/components/cta";

export const metadata = { title: "Case Studies" };

const cases = [
  { title: "Always‑On Engine — FMCG", problem: "Inconsistent presence. One‑off campaigns. Low retention.",
    system: "Monthly content engine + hook testing + vertical-first pipeline.",
    result: "Replace with your numbers: views, CTR, leads, or sales lift." },
  { title: "Creator Studio — Expert", problem: "No packaging. No cadence. No monetization.",
    system: "Podcast + shorts engine, channel identity, sponsor kit.",
    result: "Replace with your numbers: episodes/month, views, deals." },
  { title: "Experience Format — Corporate", problem: "Event value ends when the lights go off.",
    system: "Event built as format + content capture baked-in.",
    result: "Replace with your numbers: reach, UGC, PR, sponsor value." }
];

export default function CaseStudiesPage() {
  return (
    <>
      <Section>
        <Badge>Proof</Badge>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Case Studies</h1>
        <p className="mt-4 max-w-2xl text-sm text-white/70">Keep this ruthless: problem → system → measurable result.</p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {cases.map((c) => (
            <Card key={c.title} className="p-6">
              <div className="text-lg font-semibold">{c.title}</div>
              <div className="mt-4 text-xs text-white/60">Problem</div>
              <div className="mt-1 text-sm text-white/75">{c.problem}</div>
              <div className="mt-4 text-xs text-white/60">System built</div>
              <div className="mt-1 text-sm text-white/75">{c.system}</div>
              <div className="mt-4 text-xs text-white/60">Result</div>
              <div className="mt-1 text-sm text-white/75">{c.result}</div>
            </Card>
          ))}
        </div>

        <div className="mt-10">
          <Link href="/contact"><Button>Discuss your case</Button></Link>
        </div>
      </Section>
      <CTA />
    </>
  );
}
