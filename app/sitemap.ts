import type { MetadataRoute } from "next";
import { GUIDES, PROGRAMS } from "@/lib/site-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const paths = ["", "/programs", "/about", "/resources", "/calculators", "/start", "/disclosures", ...PROGRAMS.map((program) => `/programs/${program.slug}`), ...GUIDES.map((guide) => `/resources/${guide.slug}`)];
  return paths.map((path) => ({ url: `${origin}${path}` }));
}
