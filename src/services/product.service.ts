import { prisma } from '../prisma';
import { logger } from '../logger';
import type { ProductDto } from '../types/dto';
import { Decimal } from '@prisma/client/runtime/library';

const MARKETPLACE = 'amazon_us';

function productChanged(
  existing: {
    title: string;
    productUrl: string;
    reviewsUrl: string | null;
    currentPrice: Decimal | null;
    currentRating: Decimal | null;
    reviewCount: number | null;
    imageUrl: string | null;
    isActive: boolean;
  },
  dto: ProductDto,
): boolean {
  return (
    existing.title !== dto.title ||
    existing.productUrl !== dto.url ||
    existing.reviewsUrl !== dto.reviewsUrl ||
    existing.currentPrice?.toNumber() !== (dto.price ?? undefined) ||
    existing.currentRating?.toNumber() !== (dto.rating ?? undefined) ||
    existing.reviewCount !== dto.reviewCount ||
    existing.imageUrl !== dto.imageUrl ||
    existing.isActive === false
  );
}

export class ProductService {
  /**
   * Ensures the category row exists before products are inserted.
   * Call this once per scrape run before upsertProduct.
   */
  async ensureCategory(slug: string, name: string): Promise<string> {
    const category = await prisma.category.upsert({
      where: { slug_marketplace: { slug, marketplace: MARKETPLACE } },
      create: { slug, name, marketplace: MARKETPLACE },
      update: {},
    });
    return category.id;
  }

  async upsertProduct(
    dto: ProductDto,
    categoryId: string,
  ): Promise<{ created: boolean; updated: boolean; productId: string }> {
    const now = new Date();

    const existing = await prisma.product.findUnique({
      where: { asin_marketplace: { asin: dto.asin, marketplace: MARKETPLACE } },
    });

    if (!existing) {
      const created = await prisma.product.create({
        data: {
          asin: dto.asin,
          marketplace: MARKETPLACE,
          title: dto.title,
          currentPrice: dto.price !== null ? new Decimal(dto.price) : null,
          currentRating: dto.rating !== null ? new Decimal(dto.rating) : null,
          reviewCount: dto.reviewCount,
          imageUrl: dto.imageUrl,
          productUrl: dto.url,
          reviewsUrl: dto.reviewsUrl,
          categoryId,
          isActive: true,
          lastScrapedAt: now,
        },
      });
      logger.info({ asin: dto.asin, outcome: 'created' }, 'Product upsert: created');
      return { created: true, updated: false, productId: created.id };
    }

    const changed = productChanged(existing, dto);

    if (changed) {
      await prisma.product.update({
        where: { asin_marketplace: { asin: dto.asin, marketplace: MARKETPLACE } },
        data: {
          title: dto.title,
          currentPrice: dto.price !== null ? new Decimal(dto.price) : null,
          currentRating: dto.rating !== null ? new Decimal(dto.rating) : null,
          reviewCount: dto.reviewCount,
          imageUrl: dto.imageUrl,
          productUrl: dto.url,
          reviewsUrl: dto.reviewsUrl,
          isActive: true,
          lastScrapedAt: now,
        },
      });
      logger.info({ asin: dto.asin, outcome: 'updated' }, 'Product upsert: updated');
    } else {
      await prisma.product.update({
        where: { asin_marketplace: { asin: dto.asin, marketplace: MARKETPLACE } },
        data: { isActive: true, lastScrapedAt: now },
      });
      logger.info({ asin: dto.asin, outcome: 'skipped' }, 'Product upsert: skipped (no changes)');
    }

    return { created: false, updated: changed, productId: existing.id };
  }

  async deactivateMissingProducts(categorySlug: string, seenAsins: string[]): Promise<number> {
    const result = await prisma.product.updateMany({
      where: {
        marketplace: MARKETPLACE,
        category: { slug: categorySlug, marketplace: MARKETPLACE },
        isActive: true,
        ...(seenAsins.length > 0 ? { asin: { notIn: seenAsins } } : {}),
      },
      data: { isActive: false },
    });

    if (result.count > 0) {
      logger.info({ categorySlug, count: result.count }, 'Products deactivated (not seen in this run)');
    }
    return result.count;
  }
}