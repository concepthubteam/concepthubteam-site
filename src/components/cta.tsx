import Link from "next/link";
import { Button, Card } from "@/components/ui";

export function CTA() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      <Card className="relative overflow-hidden p-8 md:p-10">
        <div className="absolute inset-0 bg-grid opacity-[0.10]" aria-hidden />
        <div className="relative">
          <div className="text-sm text-white/70">Limited capacity</div>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Build your media infrastructure.</h3>
          <p className="mt-3 max-w-2xl text-sm text-white/70">
            Monthly systems, not one-off projects. If you want constant output with broadcast-level quality, start here.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/contact"><Button>Start a Conversation</Button></Link>
            <Link href="/pricing"><Button variant="outline">See Packages</Button></Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
