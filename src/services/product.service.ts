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
    reviewsUrl: dto.reviewsUrl,
    isActive: true,
    lastScrapedAt,
  };
}

function productChanged(
  existing: {
    title: string;
    url: string;
    reviewsUrl: string | null;
    price: number | null;
    rating: number | null;
    reviewCount: number | null;
    imageUrl: string | null;
    categorySlug: string;
    isActive: boolean;
  },
  dto: ProductDto,
): boolean {
  return (
    existing.title !== dto.title ||
    existing.url !== dto.url ||
    existing.reviewsUrl !== dto.reviewsUrl ||
    existing.price !== dto.price ||
    existing.rating !== dto.rating ||
    existing.reviewCount !== dto.reviewCount ||
    existing.imageUrl !== dto.imageUrl ||
    existing.categorySlug !== dto.categorySlug ||
    existing.isActive === false
  );
}

export class ProductService {
  /**
   * Creates or updates product fields and always refreshes lastScrapedAt/isActive.
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

    const changed = productChanged(existing, dto);

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
          reviewsUrl: dto.reviewsUrl,
          isActive: true,
          lastScrapedAt: now,
        },
      });
      logger.info(
        { asin: dto.asin, outcome: 'updated' },
        'Product upsert: updated',
      );
    } else {
      await prisma.product.update({
        where: { id: dto.asin },
        data: {
          isActive: true,
          lastScrapedAt: now,
        },
      });
      logger.info(
        { asin: dto.asin, outcome: 'skipped' },
        'Product upsert: skipped (no changes)',
      );
    }

    return { created: false, updated: changed };
  }

  async deactivateMissingProducts(categorySlug: string, seenAsins: string[]): Promise<number> {
    const where = {
      categorySlug,
      isActive: true,
      ...(seenAsins.length > 0 ? { id: { notIn: seenAsins } } : {}),
    };

    const result = await prisma.product.updateMany({
      where,
      data: { isActive: false },
    });

    if (result.count > 0) {
      logger.info(
        { categorySlug, count: result.count },
        'Products deactivated (not seen in this run)',
      );
    }
    return result.count;
  }
}
