import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { config } from '../config';
import { logger } from '../logger';
import type { ProductDto } from '../types/dto';
import { browserClient } from '../utils/browser.client';
import { toAmazonAbsoluteUrl } from '../utils/parser.utils';
import { BaseScraper } from './base.scraper';

export interface ProductScrapeOptions {
  /** Number of search result pages to fetch (default from config). */
  pages?: number;
}

/** Each product card container on Amazon search results. */
const PRODUCT_CARD = 'div[data-component-type="s-search-result"]';

function buildSearchPageUrl(categoryUrl: string, page: number): string {
  const u = new URL(categoryUrl);
  if (page <= 1) {
    u.searchParams.delete('page');
    return u.toString();
  }
  u.searchParams.set('page', String(page));
  return u.toString();
}

function extractAsin($: cheerio.CheerioAPI, el: Element): string | null {
  const fromAttr = ($(el).attr('data-asin') ?? '').trim();
  if (fromAttr.length === 10) return fromAttr;

  const dpLink = $(el).find('a[href*="/dp/"]').attr('href') ?? '';
  const dpMatch = dpLink.match(/\/dp\/([A-Z0-9]{10})/i);
  if (dpMatch) return dpMatch[1]!.toUpperCase();

  const celWidget = $(el).attr('data-cel-widget') ?? '';
  const celMatch = celWidget.match(/([A-Z0-9]{10})/);
  if (celMatch) return celMatch[1]!.toUpperCase();

  let found: string | null = null;
  $(el)
    .find('a[href]')
    .each((_, a) => {
      if (found) return;
      const href = $(a).attr('href') ?? '';
      const m = href.match(/\/dp\/([A-Z0-9]{10})/i);
      if (m) found = m[1]!.toUpperCase();
    });
  return found;
}

function extractTitle($: cheerio.CheerioAPI, el: Element): string | null {
  const selectors = [
    'h2 a span',
    'h2 a',
    'h2 span.a-text-normal',
    'h2 .a-size-medium',
    '[data-cy="title-recipe"] span',
  ];
  for (const sel of selectors) {
    const text = $(el).find(sel).first().text().trim();
    if (text) return text;
  }
  return null;
}

function extractPrice($: cheerio.CheerioAPI, el: Element): number | null {
  const offscreen = $(el).find('.a-price .a-offscreen').first().text().trim();
  if (offscreen) {
    const num = Number.parseFloat(offscreen.replace(/[^0-9.]/g, ''));
    if (!Number.isNaN(num)) return num;
  }

  const whole = $(el).find('.a-price-whole').first().text().replace(/[^0-9]/g, '');
  const frac = $(el).find('.a-price-fraction').first().text().replace(/[^0-9]/g, '') || '00';
  if (whole) {
    const num = Number.parseFloat(`${whole}.${frac}`);
    if (!Number.isNaN(num)) return num;
  }

  return null;
}

function extractRating($: cheerio.CheerioAPI, el: Element): number | null {
  const selectors = ['i[class*="a-star"] span.a-offscreen', 'span[aria-label*="out of 5 stars"]'];
  for (const sel of selectors) {
    const $node = $(el).find(sel).first();
    let text = $node.text().trim();
    if (!text) text = ($node.attr('aria-label') ?? '').trim();
    const m = text.match(/([0-9.]+)\s*out of/i);
    if (m) {
      const n = Number.parseFloat(m[1]!);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function extractReviewCount($: cheerio.CheerioAPI, el: Element): number | null {
  const selectors = [
    'span[aria-label*="stars"] + span',
    'a[href*="customerReviews"] span',
    '.a-size-small .a-link-normal span',
  ];
  for (const sel of selectors) {
    const text = $(el).find(sel).first().text().replace(/,/g, '').trim();
    const num = Number.parseInt(text, 10);
    if (!Number.isNaN(num) && num > 0) return num;
  }
  return null;
}

/**
 * Parses Amazon search / category listing pages into product DTOs.
 * HTML is loaded via Playwright + stealth; cheerio parses the response.
 */
export class ProductScraper extends BaseScraper {
  /**
   * @param categoryUrl Full Amazon search or category URL (from config, not hardcoded).
   * @param options Optional page count override.
   */
  async scrape(categoryUrl: string, options?: ProductScrapeOptions): Promise<ProductDto[]> {
    const pages = options?.pages ?? config.maxPages;
    const categorySlug = config.categorySlug;
    const results: ProductDto[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= pages; page++) {
      const url = buildSearchPageUrl(categoryUrl, page);
      const html = await browserClient.getPageHTML(url, {
        waitForSelector: PRODUCT_CARD,
      });

      const $ = cheerio.load(html);

      const cardCount = $(PRODUCT_CARD).length;
      logger.info({ cardCount, page }, 'Product cards found on page');

      if (cardCount === 0) {
        const dumpPath = path.join(process.cwd(), `debug_page_${page}.html`);
        fs.writeFileSync(dumpPath, html, 'utf-8');
        logger.warn({ path: dumpPath }, 'No cards found — HTML dumped for inspection');
      }

      const firstCard = $(PRODUCT_CARD).first();
      if (firstCard.length) {
        logger.debug(
          { firstCardHtml: firstCard.html()?.slice(0, 1000) },
          'First card raw HTML (truncated)',
        );
      }

      const pageProducts: ProductDto[] = [];
      const skipped = { noAsin: 0, noTitle: 0 };

      $(PRODUCT_CARD).each((i, el) => {
        const rawAsin = $(el).attr('data-asin');

        const asin = extractAsin($, el);
        if (!asin) {
          logger.debug({ cardIndex: i, rawAsin }, 'SKIP: no ASIN found');
          skipped.noAsin++;
          return;
        }

        const title = extractTitle($, el);
        if (!title) {
          logger.debug({ cardIndex: i, asin }, 'SKIP: no title found');
          skipped.noTitle++;
          return;
        }

        const price = extractPrice($, el);
        const rating = extractRating($, el);
        const reviewCount = extractReviewCount($, el);
        const imageSrc = $(el).find('img.s-image').attr('src') ?? null;
        const imageUrl = toAmazonAbsoluteUrl(imageSrc);
        const rawHref = $(el).find('h2 a').attr('href') ?? `/dp/${asin}`;
        const productUrl =
          toAmazonAbsoluteUrl(rawHref) ?? `https://www.amazon.com/dp/${asin}`;

        logger.debug(
          { cardIndex: i, asin, title: title.slice(0, 50), price, rating },
          'ACCEPT: card parsed',
        );

        pageProducts.push({
          asin,
          title,
          url: productUrl,
          price,
          rating,
          reviewCount,
          imageUrl,
          categorySlug,
        });
      });

      logger.info(
        {
          page,
          totalCards: $(PRODUCT_CARD).length,
          accepted: pageProducts.length,
          skippedNoAsin: skipped.noAsin,
          skippedNoTitle: skipped.noTitle,
        },
        'Page parse summary',
      );

      logger.info(
        { page, cardCount, parsed: pageProducts.length },
        `Found ${cardCount} product cards on page, parsed ${pageProducts.length} valid products`,
      );
      logger.info(`Parsed ${pageProducts.length} products from page ${page}`);

      for (const p of pageProducts) {
        if (seen.has(p.asin)) continue;
        seen.add(p.asin);
        results.push(p);
      }
    }

    return results;
  }
}
