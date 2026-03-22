import 'dotenv/config';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

/**
 * Derives a short slug from the category URL (query/path) for storage when CATEGORY_SLUG is not set.
 */
function slugFromCategoryUrl(url: string): string {
  try {
    const u = new URL(url);
    const rh = u.searchParams.get('rh');
    if (rh) {
      const encoded = Buffer.from(rh).toString('base64url').slice(0, 32);
      return `rh-${encoded}`;
    }
    const path = u.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    return path || 'amazon-category';
  } catch {
    return 'amazon-category';
  }
}

const categoryUrl = requireEnv('CATEGORY_URL');

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  categoryUrl,
  categorySlug: process.env.CATEGORY_SLUG?.trim() || slugFromCategoryUrl(categoryUrl),
  requestDelayMinMs: parseIntEnv('REQUEST_DELAY_MIN', 2000),
  requestDelayMaxMs: parseIntEnv('REQUEST_DELAY_MAX', 4000),
  maxPages: parseIntEnv('MAX_PAGES', 2),
  /** Number of review listing pages per product (default 2). */
  reviewPages: parseIntEnv('REVIEW_PAGES', 2),
} as const;
