import "./globals.css";
import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.concepthubteam.ro"),
  title: {
    default: "Concept Hub Team — Media Infrastructure for Brands & Talent",
    template: "%s — Concept Hub Team"
  },
  description:
    "Concept Hub Team builds scalable content systems, creator platforms and experiential formats. Broadcast-level production powered by AI workflows.",
  openGraph: {
    title: "Concept Hub Team",
    description:
      "Media infrastructure for brands & talent: content systems, creator platforms, experience formats.",
    url: "https://www.concepthubteam.ro",
    siteName: "Concept Hub Team",
    locale: "ro_RO",
    type: "website"
  },
  robots: { index: true, follow: true },
  icons: [{ rel: "icon", url: "/favicon.svg" }]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body className="min-h-screen">
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
