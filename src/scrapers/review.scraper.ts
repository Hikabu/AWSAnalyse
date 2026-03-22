import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { config } from '../config';
import { logger } from '../logger';
import type { ReviewDto } from '../types/dto';
import { browserClient } from '../utils/browser.client';
import { parseReviewDate } from '../utils/parser.utils';
import { BaseScraper } from './base.scraper';

const REVIEW_CONTAINER = 'div[data-hook="review"]';

/** Increments each time `scrape` runs — used for adaptive delay between products (Fix 4) without changing `index.ts`. */
let scrapeInvocationIndex = 0;

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function reviewUrlFormats(asin: string, pageNum: number): string[] {
  return [
    `https://www.amazon.com/product-reviews/${encodeURIComponent(asin)}/ref=cm_cr_arp_d_viewopt_srt?ie=UTF8&reviewerType=all_reviews&sortBy=recent&pageNumber=${pageNum}`,
    `https://www.amazon.com/product-reviews/${encodeURIComponent(asin)}?reviewerType=all_reviews&sortBy=recent&pageNumber=${pageNum}`,
    `https://www.amazon.com/dp/${encodeURIComponent(asin)}?th=1#customerReviews`,
    `https://www.amazon.com/review/product/${encodeURIComponent(asin)}?pageNumber=${pageNum}`,
  ];
}

async function fetchReviewPageHtml(asin: string, pageNum: number, productUrl: string): Promise<string> {
  const formats = reviewUrlFormats(asin, pageNum);
  const referer = productUrl;

  for (const url of formats) {
    const html = await browserClient.getPageHTML(url, {
      referer,
      delayMs: randomBetween(2000, 4000),
    });

    const $ = cheerio.load(html);
    const hasReviews = $(REVIEW_CONTAINER).length > 0;
    const hasLoginWall = html.includes('ap/signin') || html.includes('sign-in');
    const hasEmptyState =
      html.includes('no customer reviews') || html.includes('Be the first');

    if (hasReviews) {
      logger.info({ asin, url, pageNum }, 'Review URL format worked');
      return html;
    }

    if (hasLoginWall) {
      logger.warn({ asin, url }, 'Review page hit login wall — trying next format');
      continue;
    }

    if (hasEmptyState) {
      logger.info({ asin }, 'Product has no reviews yet');
      return html;
    }

    logger.warn({ asin, url, pageNum }, 'Review format returned no results — trying next');
  }

  logger.warn({ asin, pageNum }, 'All review URL formats failed — skipping reviews for this page');
  return '';
}

/**
 * Parses Amazon product review listing pages (HTML from Playwright).
 */
export class ReviewScraper extends BaseScraper {
  /**
   * Fetches the first N pages of reviews for an ASIN (N from config.reviewPages).
   * Failures are logged and an empty array is returned so the product pipeline is not aborted (Fix 6).
   */
  async scrape(asin: string): Promise<ReviewDto[]> {
    try {
      const productIndex = scrapeInvocationIndex++;
      const baseDelay = randomBetween(4000, 8000);
      const fatigueDelay = Math.floor(productIndex / 5) * 2000;
      const totalDelay = baseDelay + fatigueDelay;
      logger.info({ asin, productIndex, totalDelay }, 'Waiting before review scrape (adaptive)');
      await delay(totalDelay);

      const productUrl = `https://www.amazon.com/dp/${encodeURIComponent(asin)}`;

      logger.info({ asin }, 'Warming up session on product page');
      await browserClient.getPageHTML(productUrl, {
        delayMs: randomBetween(1500, 3000),
      });

      const out: ReviewDto[] = [];
      const seen = new Set<string>();
      const maxPages = config.reviewPages;

      const REVIEW_ID = ($: cheerio.CheerioAPI, el: Element) => $(el).attr('id')?.trim() ?? '';
      const AUTHOR = ($: cheerio.CheerioAPI, el: Element) =>
        $(el).find('span.a-profile-name').text().trim();
      const RATING_R = ($: cheerio.CheerioAPI, el: Element): number => {
        const text = $(el)
          .find(
            'i[data-hook="review-star-rating"] span.a-offscreen, i[data-hook="cmps-review-star-rating"] span.a-offscreen',
          )
          .first()
          .text()
          .replace(' out of 5 stars', '')
          .trim();
        const n = Number.parseInt(text, 10);
        return Number.isFinite(n) ? n : NaN;
      };
      const TITLE_R = ($: cheerio.CheerioAPI, el: Element) =>
        $(el).find('a[data-hook="review-title"] span:not(.a-icon-alt)').text().trim();
      const BODY_R = ($: cheerio.CheerioAPI, el: Element) =>
        $(el).find('span[data-hook="review-body"] span').text().trim();
      const DATE_R = ($: cheerio.CheerioAPI, el: Element) => {
        const raw = $(el).find('span[data-hook="review-date"]').text().trim();
        const stripped = raw.replace('Reviewed in the United States on ', '').trim();
        return { raw, stripped };
      };
      const VERIFIED_R = ($: cheerio.CheerioAPI, el: Element) =>
        $(el).find('span[data-hook="avp-badge"]').length > 0;

      for (let page = 1; page <= maxPages; page++) {
        if (page > 1) {
          await delay(randomBetween(2000, 4000));
        }

        const html = await fetchReviewPageHtml(asin, page, productUrl);
        if (!html) {
          continue;
        }

        const $ = cheerio.load(html);
        const reviewCount = $(REVIEW_CONTAINER).length;
        const likelyEmptyProduct =
          html.includes('no customer reviews') || html.includes('Be the first');

        if (reviewCount === 0 && !likelyEmptyProduct) {
          const dumpPath = path.join(process.cwd(), `debug_reviews_${asin}_page${page}.html`);
          fs.writeFileSync(dumpPath, html, 'utf-8');
          logger.warn({ asin, page, dumpPath }, 'No reviews found — HTML dumped for inspection');
        }

        $(REVIEW_CONTAINER).each((_, el) => {
          let id = REVIEW_ID($, el);
          const author = AUTHOR($, el) || null;
          const title = TITLE_R($, el) || null;
          const body = BODY_R($, el) || null;
          const { raw: dateRawFull, stripped: dateStripped } = DATE_R($, el);
          const date =
            parseReviewDate(dateStripped) ?? parseReviewDate(dateRawFull);

          if (!id || !/^R[A-Z0-9]+$/i.test(id)) {
            id = stableReviewId(asin, author, title, body, date);
          }

          if (seen.has(id)) return;
          seen.add(id);

          let ratingVal = RATING_R($, el);
          if (!Number.isFinite(ratingVal) || ratingVal < 1 || ratingVal > 5) {
            ratingVal = 3;
          }

          const verified = VERIFIED_R($, el) || /verified\s+purchase/i.test($(el).text());

          out.push({
            id,
            productId: asin,
            author,
            rating: ratingVal,
            title,
            body,
            date,
            verified,
          });
        });
      }

      return out;
    } catch (err) {
      logger.warn(
        { asin, err },
        'Review scrape failed — skipping reviews for this product (product already saved if pipeline ran)',
      );
      return [];
    }
  }
}
