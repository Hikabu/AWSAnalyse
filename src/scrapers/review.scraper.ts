import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { logger } from '../logger';
import type { ReviewDto } from '../types/dto';
import { browserClient } from '../utils/browser.client';
import { parseReviewDate } from '../utils/parser.utils';
import { BaseScraper } from './base.scraper';

const REVIEW_CARD_SELECTOR = 'div[id^="customer_review-"]';

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function stableReviewId(
  asin: string,
  author: string | null,
  title: string | null,
  body: string | null,
  date: Date | null,
): string {
  const payload = [asin, author ?? '', title ?? '', body ?? '', date?.toISOString() ?? ''].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 40);
}

function parseUsReviewCard(
  $: cheerio.CheerioAPI,
  el: Element,
  asin: string,
  rawId: string,
  dateText: string,
): ReviewDto | null {
  // Filtered to US already, but keep date extraction consistent.
  const author = $(el).find('span.a-profile-name').first().text().trim() || null;

  // Rating: either hook can appear; parse "4.0 out of 5 stars"
  const ratingText =
    $(el)
      .find(
        'i[data-hook="review-star-rating"] .a-offscreen, i[data-hook="cmps-review-star-rating"] .a-offscreen, i[data-hook="review-star-rating"] .a-icon-alt, i[data-hook="cmps-review-star-rating"] .a-icon-alt',
      )
      .first()
      .text()
      .trim() || '';

  const ratingMatch = ratingText.match(/([0-9.]+)\s*out of/i);
  const rating = ratingMatch ? Math.round(parseFloat(ratingMatch[1]!)) : 3;

  // Title: pick the first span in [data-hook="review-title"] that is NOT inside an <i> star icon.
  let title: string | null = null;
  $(el)
    .find('[data-hook="review-title"] span')
    .each((_, spanEl) => {
      if (title) return;
      if ($(spanEl).parents('i').length > 0) return; // skip star-rating alt/icon spans
      const text = $(spanEl).text().trim();
      if (text) title = text;
    });

  // Body: the real text is the innermost span inside review-collapsed.
  const body =
    $(el).find('[data-hook="review-collapsed"] span').first().text().trim() ||
    $(el).find('[data-hook="review-body"] span').first().text().trim() ||
    null;

  const date = parseReviewDate(dateText);

  const verified =
    $(el).find('[data-hook="avp-badge"]').length > 0 ||
    /verified\s+purchase/i.test($(el).text());

  const cleanId = rawId.replace('customer_review-', '');
  const id = cleanId || stableReviewId(asin, author, title, body, date);

  return {
    id,
    productId: asin,
    author,
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, rating)) : 3,
    title,
    body,
    date,
    verified,
  };
}

/**
 * Parses Amazon product pages to extract the first 3 US reviews.
 * Reviews are lazy-loaded, so we must scroll to the bottom to force the DOM to render them.
 */
export class ReviewScraper extends BaseScraper {
  async scrape(asin: string, reviewsUrl: string | null): Promise<ReviewDto[]> {
    try {
      const productUrl = `https://www.amazon.com/dp/${encodeURIComponent(asin)}`;
      // Prefer the card-provided reviewsUrl (usually ends with #customerReviews),
      // but always fall back to the clean dp URL.
      const targetUrl = reviewsUrl
        ? reviewsUrl.startsWith('http://') || reviewsUrl.startsWith('https://')
          ? reviewsUrl
          : `https://www.amazon.com${reviewsUrl}`
        : productUrl;
      const finalTargetUrl = targetUrl.includes('#') ? targetUrl : `${productUrl}#customerReviews`;

      logger.info({ asin, url: finalTargetUrl }, 'Fetching product page for top US reviews');

      const html = await browserClient.getPageHTML(finalTargetUrl, {
        referer: 'https://www.amazon.com/',
        delayMs: randomBetween(1500, 3000),
        scrollToBottom: true,
        waitForSelector: '[data-hook="review-date"]',
        waitTimeoutMs: 12_000,
      });

      const $ = cheerio.load(html);
      const out: ReviewDto[] = [];

      $(REVIEW_CARD_SELECTOR).each((_, el) => {
        if (out.length >= 3) return;

        const rawId = $(el).attr('id')?.trim() ?? '';
        if (!rawId || !rawId.startsWith('customer_review-')) return;

        // Foreign reviews have ids like "customer_review_foreign-R..."
        if (rawId.includes('_foreign')) return;

        const dateText = $(el).find('[data-hook="review-date"]').first().text().trim();
        if (!dateText.includes('United States')) return;

        const review = parseUsReviewCard($, el, asin, rawId, dateText);
        if (review) out.push(review);
      });

      if (out.length === 0) {
        const dumpPath = path.join(process.cwd(), 'debug', `reviews_${asin}.html`);
        fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
        fs.writeFileSync(dumpPath, html, 'utf-8');
        logger.warn({ asin, dumpPath }, '0 US reviews extracted — HTML dumped for inspection');
      }

      logger.info({ asin, count: out.length }, 'Reviews scraped');
      return out;
    } catch (err) {
      logger.warn({ asin, err }, 'Review scrape failed — returning empty list');
      return [];
    }
  }
}
