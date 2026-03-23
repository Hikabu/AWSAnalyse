import { config } from './config';
import { logger } from './logger';
import { prisma } from './prisma';
import { ProductScraper } from './scrapers/product.scraper';
import { ReviewScraper } from './scrapers/review.scraper';
import { ProductService } from './services/product.service';
import { ReviewService } from './services/review.service';
import { ScrapeRunService } from './services/scrape-run.service';
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
  const scrapeRunService = new ScrapeRunService();
  let runId: string | null = null;

  try {
    const CATEGORY_URL = config.categoryUrl;

    const productScraper = new ProductScraper();
    const reviewScraper = new ReviewScraper();
    const productService = new ProductService();
    const reviewService = new ReviewService();
    runId = await scrapeRunService.startScrapeRun(config.categorySlug);

    logger.info('Starting Amazon scraper...');

    // Ensure the category row exists once before the product loop.
    // ensureCategory returns the internal cuid used as categoryId FK.
    const categoryId = await productService.ensureCategory(
      config.categorySlug,
      config.categorySlug, // use slug as display name fallback; update if you have a human name
    );

    let products: Awaited<ReturnType<ProductScraper['scrape']>>;
    try {
      products = await productScraper.scrape(CATEGORY_URL, { pages: config.maxPages });
    } catch (err) {
      logger.error({ err }, 'Failed to scrape product listing');
      await scrapeRunService.failScrapeRun(
        runId,
        err instanceof Error ? err.message : String(err),
      );
      process.exitCode = 1;
      return;
    }

    logger.info({ count: products.length }, `Found ${products.length} products`);

    const stats = {
      productsCreated: 0,
      productsUpdated: 0,
      productsSkipped: 0,
      productsDeactivated: 0,
      reviewsCreated: 0,
      reviewsUpdated: 0,
      reviewsSkipped: 0,
      productErrors: 0,
    };

    const seenAsins: string[] = [];
    for (const product of products) {
      seenAsins.push(product.asin);
      try {
        const { created, updated, productId } = await productService.upsertProduct(product, categoryId);
        if (created) stats.productsCreated++;
        else if (updated) stats.productsUpdated++;
        else stats.productsSkipped++;

        const reviews = await reviewScraper.scrape(product.asin, product.reviewsUrl);
        const seenReviewIds: string[] = [];
        for (const review of reviews) {
          seenReviewIds.push(review.id);
          // Pass the internal productId (cuid) — required for the compound unique lookup
          const r = await reviewService.upsertReview(review, productId);
          if (r.created) stats.reviewsCreated++;
          else if (r.updated) stats.reviewsUpdated++;
          else stats.reviewsSkipped++;
        }
        await reviewService.deactivateMissingReviews(productId, seenReviewIds);

        await delay(randomBetween(config.requestDelayMinMs, config.requestDelayMaxMs));
      } catch (err) {
        stats.productErrors++;
        logger.error({ err, asin: product.asin }, 'Product pipeline failed; continuing with next product');
      }
    }

    stats.productsDeactivated = await productService.deactivateMissingProducts(
      config.categorySlug,
      seenAsins,
    );

    await scrapeRunService.finishScrapeRun(runId, {
      productsCreated: stats.productsCreated,
      productsUpdated: stats.productsUpdated,
      productsSkipped: stats.productsSkipped,
      productsDeactivated: stats.productsDeactivated,
      reviewsCreated: stats.reviewsCreated,
      reviewsUpdated: stats.reviewsUpdated,
      reviewsSkipped: stats.reviewsSkipped,
    });

    logger.info(stats, 'Scrape complete');
  } catch (err) {
    if (runId) {
      await scrapeRunService.failScrapeRun(
        runId,
        err instanceof Error ? err.message : String(err),
      );
    }
    logger.error({ err }, 'Fatal scrape error');
    process.exitCode = 1;
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