import { prisma } from '../prisma';
import { logger } from '../logger';
import type { ProductDto } from '../types/dto';

function dtoToCreateData(dto: ProductDto, lastScrapedAt: Date) {
  return {
    id: dto.asin,
    title: dto.title,
    price: dto.price,
    rating: dto.rating,
    reviewCount: dto.reviewCount,
    imageUrl: dto.imageUrl,
    categorySlug: dto.categorySlug,
    url: dto.url,
    lastScrapedAt,
  };
}

export class ProductService {
  /**
   * Creates or updates a product only when price, rating, or reviewCount changed.
   */
  async upsertProduct(dto: ProductDto): Promise<{ created: boolean; updated: boolean }> {
    const existing = await prisma.product.findUnique({ where: { id: dto.asin } });
    const now = new Date();

    if (!existing) {
      await prisma.product.create({ data: dtoToCreateData(dto, now) });
      logger.info(
        { asin: dto.asin, outcome: 'created' },
        'Product upsert: created',
      );
      return { created: true, updated: false };
    }

    const changed =
      existing.price !== dto.price ||
      existing.rating !== dto.rating ||
      existing.reviewCount !== dto.reviewCount;

    if (changed) {
      await prisma.product.update({
        where: { id: dto.asin },
        data: {
          title: dto.title,
          price: dto.price,
          rating: dto.rating,
          reviewCount: dto.reviewCount,
          imageUrl: dto.imageUrl,
          categorySlug: dto.categorySlug,
          url: dto.url,
          lastScrapedAt: now,
        },
      });
      logger.info(
        { asin: dto.asin, outcome: 'updated' },
        'Product upsert: updated',
      );
    } else {
      logger.info(
        { asin: dto.asin, outcome: 'skipped' },
        'Product upsert: skipped (no scalar changes)',
      );
    }

    return { created: false, updated: changed };
  }
}
