import * as crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { config } from '../config';
import type { ReviewDto } from '../types/dto';
import { browserClient } from '../utils/browser.client';
import { parseReviewDate } from '../utils/parser.utils';
import { BaseScraper } from './base.scraper';

const REVIEW_CONTAINER = 'div[data-hook="review"]';

function reviewPageUrl(asin: string, pageNumber: number): string {
  const base = `https://www.amazon.com/product-reviews/${encodeURIComponent(asin)}/ref=cm_cr_arp_d_viewopt_srt`;
  const params = new URLSearchParams({
    ie: 'UTF8',
    reviewerType: 'all_reviews',
    sortBy: 'recent',
    pageNumber: String(pageNumber),
  });
  return `${base}?${params.toString()}`;
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

/**
 * Parses Amazon product review listing pages (HTML from Playwright).
 */
export class ReviewScraper extends BaseScraper {
  /**
   * Fetches the first N pages of reviews for an ASIN (N from config.reviewPages).
   */
  async scrape(asin: string): Promise<ReviewDto[]> {
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
      const url = reviewPageUrl(asin, page);
      const html = await browserClient.getPageHTML(url, {
        waitForSelector: REVIEW_CONTAINER,
      });
      const $ = cheerio.load(html);

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
  }
}
