import type { MetadataRoute } from "next";
import { COUNTIES } from "@/lib/counties";
import { GUIDES, PROGRAMS } from "@/lib/site-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const paths = ["", "/programs", "/rates", "/rewards", "/about", "/resources", "/calculators", "/start", "/book", "/payoff", "/disclosures", ...PROGRAMS.map((program) => `/programs/${program.slug}`), ...GUIDES.map((guide) => `/resources/${guide.slug}`), "/florida", ...COUNTIES.map((county) => `/florida/${county.slug}`)];
  return paths.map((path) => ({ url: `${origin}${path}` }));
}
