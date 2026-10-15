/**
 * Auto-synced registry of publicly-crawlable routes. Consumed by the
 * /sitemap.xml handler in src/server/entry.ts.
 *
 * DO NOT add or remove paths by hand. Static paths are mirrored here from
 * src/routes.tsx automatically whenever that file is edited (any manual
 * path edit would be overwritten on the next routes.tsx change). For sync
 * to pick up a route, its `path` must be a literal string starting with "/";
 * template literals and identifier refs are skipped, and dynamic-param routes
 * like "/products/:id" are excluded.
 *
 * The only fields safe to hand-edit are the per-entry metadata below, after a
 * sync:
 * - `priority` (0.0–1.0): Home = 1.0, main sections = 0.8, deep pages = 0.5.
 * - `changefreq` and `lastmod`.
 */

export interface SeoRoute {
  path: string;
  changefreq?:
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";
  priority?: number;
  lastmod?: string;
}

export const seoRoutes: SeoRoute[] = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/solutions", changefreq: "monthly", priority: 0.8 },
  { path: "/how-it-works", changefreq: "monthly", priority: 0.8 },
  { path: "/get-started", changefreq: "monthly", priority: 0.8 },
  { path: "/onboarding", changefreq: "monthly", priority: 0.8 },
  { path: "/welcome", changefreq: "monthly", priority: 0.8 },
  { path: "/features", changefreq: "monthly", priority: 0.8 },
  { path: "/pricing", changefreq: "monthly", priority: 0.8 },
  { path: "/about", changefreq: "monthly", priority: 0.8 },
  { path: "/dashboard", changefreq: "monthly", priority: 0.8 },
  { path: "/assistant", changefreq: "monthly", priority: 0.8 },
  { path: "/calendar", changefreq: "monthly", priority: 0.8 },
  { path: "/pilot", changefreq: "monthly", priority: 0.8 },
  { path: "/ai-receptionist", changefreq: "monthly", priority: 0.8 },
  { path: "/customer-management", changefreq: "monthly", priority: 0.8 },
  { path: "/faqs", changefreq: "monthly", priority: 0.8 },
  { path: "/dashboard/ai-receptionist", changefreq: "monthly", priority: 0.5 },
  { path: "/notifications", changefreq: "monthly", priority: 0.8 },
  { path: "/customers", changefreq: "monthly", priority: 0.8 },
  { path: "/leads", changefreq: "monthly", priority: 0.8 },
  { path: "/jobs", changefreq: "monthly", priority: 0.8 },
  { path: "/finance", changefreq: "monthly", priority: 0.8 },
  { path: "/connections", changefreq: "monthly", priority: 0.8 },
  { path: "/employees", changefreq: "monthly", priority: 0.8 },
  { path: "/scheduling", changefreq: "monthly", priority: 0.8 },
  { path: "/subscription", changefreq: "monthly", priority: 0.8 },
  { path: "/business-profile", changefreq: "monthly", priority: 0.5 },
  { path: "/dashboard/booking-rules", changefreq: "monthly", priority: 0.5 },
  { path: "/phone-connection", changefreq: "monthly", priority: 0.8 },
  { path: "/profile", changefreq: "monthly", priority: 0.8 },
  { path: "/settings", changefreq: "monthly", priority: 0.8 },
  { path: "/messages", changefreq: "monthly", priority: 0.8 },
  { path: "/help", changefreq: "monthly", priority: 0.8 },
  { path: "/dashboard/help", changefreq: "monthly", priority: 0.5 },
  { path: "/cart", changefreq: "monthly", priority: 0.8 },
  { path: "/checkout/success", changefreq: "monthly", priority: 0.5 },
  { path: "/checkout/cancel", changefreq: "monthly", priority: 0.5 },
  { path: "/marketing", changefreq: "monthly", priority: 0.8 },
  { path: "/contact", changefreq: "monthly", priority: 0.8 },
  { path: "/login", changefreq: "monthly", priority: 0.8 },
  { path: "/signup", changefreq: "monthly", priority: 0.8 },
  { path: "/forgot-password", changefreq: "monthly", priority: 0.8 },
  { path: "/reset-password", changefreq: "monthly", priority: 0.8 },
];
