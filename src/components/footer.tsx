import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-ink-950/40">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3">
        <div>
          <div className="text-sm font-semibold">Concept Hub Team</div>
          <p className="mt-3 text-sm text-white/65">
            Media infrastructure for brands & talent: content systems, creator platforms and experience formats.
          </p>
          <p className="mt-4 text-xs text-white/45">© {new Date().getFullYear()} Concept Hub Team SRL</p>
        </div>

        <div className="text-sm">
          <div className="font-semibold">Pages</div>
          <ul className="mt-3 space-y-2 text-white/70">
            <li><Link className="hover:text-white" href="/systems">Systems</Link></li>
            <li><Link className="hover:text-white" href="/studio">Studio</Link></li>
            <li><Link className="hover:text-white" href="/case-studies">Case Studies</Link></li>
            <li><Link className="hover:text-white" href="/pricing">Pricing</Link></li>
            <li><Link className="hover:text-white" href="/about">About</Link></li>
          </ul>
        </div>

        <div className="text-sm">
          <div className="font-semibold">Contact</div>
          <p className="mt-3 text-white/70">For partnerships and subscriptions:</p>
          <p className="mt-2 text-white/80">
            <a className="underline decoration-white/20 hover:decoration-white/60" href="mailto:remus@concepthubteam.ro">
              remus@concepthubteam.ro
            </a>
          </p>
          <p className="mt-4 text-xs text-white/45">Bucharest, RO • Remote-friendly</p>
        </div>
      </div>
    </footer>
  );
}
