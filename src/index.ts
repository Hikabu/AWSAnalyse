import { config } from './config';
import { logger } from './logger';
import { prisma } from './prisma';
import { ProductScraper } from './scrapers/product.scraper';
import { ReviewScraper } from './scrapers/review.scraper';
import { ProductService } from './services/product.service';
import { ReviewService } from './services/review.service';
import { browserClient } from './utils/browser.client';
import { runHealthChecks } from './utils/health.check';

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  await runHealthChecks();

  await browserClient.init();

  try {
    const CATEGORY_URL = config.categoryUrl;

    const productScraper = new ProductScraper();
    const reviewScraper = new ReviewScraper();
    const productService = new ProductService();
    const reviewService = new ReviewService();

    logger.info('Starting Amazon scraper...');

    let products;
    try {
      products = await productScraper.scrape(CATEGORY_URL, { pages: config.maxPages });
    } catch (err) {
      logger.error({ err }, 'Failed to scrape product listing');
      process.exitCode = 1;
      return;
    }

    logger.info({ count: products.length }, `Found ${products.length} products`);

    const stats = {
      productsCreated: 0,
      productsUpdated: 0,
      productsSkipped: 0,
      reviewsCreated: 0,
      reviewsUpdated: 0,
      reviewsSkipped: 0,
      productErrors: 0,
    };

    for (const product of products) {
      try {
        const result = await productService.upsertProduct(product);
        if (result.created) stats.productsCreated++;
        else if (result.updated) stats.productsUpdated++;
        else stats.productsSkipped++;

        const reviews = await reviewScraper.scrape(product.asin);
        for (const review of reviews) {
          const r = await reviewService.upsertReview(review);
          if (r.created) stats.reviewsCreated++;
          else if (r.updated) stats.reviewsUpdated++;
          else stats.reviewsSkipped++;
        }

        await delay(randomBetween(config.requestDelayMinMs, config.requestDelayMaxMs));
      } catch (err) {
        stats.productErrors++;
        logger.error({ err, asin: product.asin }, 'Product pipeline failed; continuing with next product');
      }
    }

    logger.info(stats, 'Scrape complete');
  } finally {
    await browserClient.close();
  }
}

main()
  .catch((err) => {
    logger.error({ err }, 'Fatal error');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    if (process.exitCode != null && process.exitCode !== 0) {
      process.exit(process.exitCode);
    }
  });
