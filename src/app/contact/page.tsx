import { Section } from "@/components/section";
import { Badge, Button, Card } from "@/components/ui";

export const metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <Section>
      <Badge>Contact</Badge>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Start a conversation</h1>
      <p className="mt-4 max-w-2xl text-sm text-white/70">
        Short form. Clear intent. If you want a one‑off video, say it upfront — we usually decline.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-12">
        <Card className="p-6 md:col-span-7">
          <form action="https://formspree.io/f/your_form_id" method="POST" className="space-y-4">
            <div>
              <label className="text-sm text-white/70">Name</label>
              <input name="name" required className="mt-2 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20" />
            </div>
            <div>
              <label className="text-sm text-white/70">Email</label>
              <input type="email" name="email" required className="mt-2 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20" />
            </div>
            <div>
              <label className="text-sm text-white/70">What are you building?</label>
              <textarea name="message" rows={6} required className="mt-2 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20" placeholder="Brand / talent / platform. Goal. Budget. Timeline." />
            </div>
            <Button type="submit">Send</Button>
            <p className="text-xs text-white/50">Replace the Formspree URL with your real form endpoint, or switch to mailto.</p>
          </form>
        </Card>

        <Card className="p-6 md:col-span-5">
          <div className="text-xs text-white/60">Direct</div>
          <div className="mt-2 text-sm text-white/80">
            <a className="underline decoration-white/20 hover:decoration-white/60" href="mailto:remus@concepthubteam.ro">remus@concepthubteam.ro</a>
          </div>

          <div className="mt-8 text-xs text-white/60">What we prefer</div>
          <ul className="mt-3 space-y-2 text-sm text-white/75">
            <li>• Monthly subscriptions</li>
            <li>• Repeatable formats</li>
            <li>• IP-friendly deals</li>
          </ul>

          <div className="mt-8 text-xs text-white/60">Capacity</div>
          <div className="mt-2 text-sm text-white/75">Limited. We take a small number of partners at a time.</div>
        </Card>
      </div>
    </Section>
  );
}
