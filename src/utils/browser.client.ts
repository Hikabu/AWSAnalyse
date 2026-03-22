import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from '../config';
import { logger } from '../logger';

chromium.use(StealthPlugin());

export type GetPageHtmlOptions = {
  /** Post-navigation wait; defaults to random delay from config REQUEST_DELAY_* */
  delayMs?: number;
  /** Wait for this selector before reading HTML; omit to skip waiting */
  waitForSelector?: string;
  /** Timeout for waitForSelector (ms). */
  waitTimeoutMs?: number;
  /** Referrer for navigation (e.g. product page before reviews). */
  referer?: string;
};

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BrowserClient {
  private browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });
    logger.info('Browser launched');
  }

  private getRandomUserAgent(): string {
    const agents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ];
    return agents[Math.floor(Math.random() * agents.length)]!;
  }

  /**
   * Opens a fresh browser context per request, loads the URL, optionally waits for a selector, then returns document HTML.
   */
  async getPageHTML(url: string, options?: GetPageHtmlOptions): Promise<string> {
    if (!this.browser) {
      throw new Error('Browser not initialized. Call init() first.');
    }

    const referer = options?.referer;
    const context = await this.browser.newContext({
      userAgent: this.getRandomUserAgent(),
      locale: 'en-US',
      timezoneId: 'America/New_York',
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
        ...(referer ? { Referer: referer } : {}),
      },
    });

    const page = await context.newPage();

    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    const delayMs =
      options?.delayMs ?? randomBetween(config.requestDelayMinMs, config.requestDelayMaxMs);
    const waitTimeout = options?.waitTimeoutMs ?? 8_000;

    logger.info({ url, delayMs }, 'Browser GET starting');

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      if (options?.waitForSelector) {
        try {
          await page.waitForSelector(options.waitForSelector, { timeout: waitTimeout });
        } catch {
          logger.warn(
            { url, selector: options.waitForSelector },
            'Expected selector did not appear — may be bot page, empty results, or slow load',
          );
        }
      }

      await sleep(delayMs);

      const html = await page.content();
      logger.info({ url }, 'Browser GET completed');
      return html;
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    logger.info('Browser closed');
  }
}

export const browserClient = new BrowserClient();
