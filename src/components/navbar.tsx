import Link from "next/link";
import { Button } from "@/components/ui";

const nav = [
  { href: "/systems", label: "Systems" },
  { href: "/studio", label: "Studio" },
  { href: "/case-studies", label: "Case Studies" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" }
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-ink-950/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="Concept Hub Team" className="h-8 w-auto" />
          <div className="leading-none">
            <div className="font-semibold tracking-tight">Concept Hub</div>
            <div className="text-xs text-white/60">Media Infrastructure</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-5 md:flex">
          {nav.map((i) => (
            <Link key={i.href} href={i.href} className="text-sm text-white/75 hover:text-white transition">
              {i.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/contact" className="hidden md:block">
            <Button variant="ghost">Contact</Button>
          </Link>
          <Link href="/contact">
            <Button>Enter the Studio</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
