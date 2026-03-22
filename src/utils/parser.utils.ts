/**
 * Parses a currency string like "$12.34" or "12,34 €" into a float, or null if not parseable.
 */
export function parsePrice(text: string | undefined | null): number | null {
  if (!text) return null;
  const normalized = text.replace(/[^\d.,]/g, '').replace(',', '.');
  const match = normalized.match(/\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number.parseFloat(match[0]!);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extracts a star rating (0–5) from an aria-label like "4.5 out of 5 stars".
 */
export function parseRatingFromAria(aria: string | undefined | null): number | null {
  if (!aria) return null;
  const m = aria.match(/(\d+(?:\.\d+)?)\s+out\s+of\s+5/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses review count from text like "1,234" or "1234 ratings".
 */
export function parseReviewCount(text: string | undefined | null): number | null {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses Amazon-style review dates; returns null if parsing fails.
 */
export function parseReviewDate(text: string | undefined | null): Date | null {
  if (!text) return null;
  const trimmed = text.replace(/^Reviewed in .* on\s*/i, '').trim();
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Ensures URL is absolute against Amazon origin.
 */
export function toAmazonAbsoluteUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  if (href.startsWith('http')) return href.split('?')[0] ?? href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `https://www.amazon.com${href}`;
  return `https://www.amazon.com/${href}`;
}
