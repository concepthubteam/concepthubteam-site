import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.concepthubteam.ro";
  const routes = ["", "/systems", "/studio", "/case-studies", "/pricing", "/about", "/contact"];
  return routes.map((r) => ({ url: base + r, lastModified: new Date() }));
}
