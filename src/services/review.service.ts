import { prisma } from '../prisma';
import { logger } from '../logger';
import type { ReviewDto } from '../types/dto';

function reviewChanged(
  existing: {
    author: string | null;
    rating: number;
    title: string | null;
    body: string | null;
    date: Date | null;
    verified: boolean;
    isActive: boolean;
  },
  dto: ReviewDto,
): boolean {
  return (
    existing.author !== dto.author ||
    existing.rating !== dto.rating ||
    existing.title !== dto.title ||
    existing.body !== dto.body ||
    existing.date?.getTime() !== dto.date?.getTime() ||
    existing.verified !== dto.verified ||
    existing.isActive === false
  );
}

export class ReviewService {
  /**
   * Inserts or updates a review by stable review id; logs created / updated / skipped.
   */
  async upsertReview(dto: ReviewDto): Promise<{ created: boolean; updated: boolean; skipped: boolean }> {
    const existing = await prisma.review.findUnique({ where: { id: dto.id } });

    if (!existing) {
      await prisma.review.create({
        data: {
          id: dto.id,
          productId: dto.productId,
          author: dto.author,
          rating: dto.rating,
          title: dto.title,
          body: dto.body,
          date: dto.date,
          verified: dto.verified,
          isActive: true,
        },
      });
      logger.info(
        { reviewId: dto.id, productId: dto.productId, outcome: 'created' },
        'Review upsert: created',
      );
      return { created: true, updated: false, skipped: false };
    }

    if (!reviewChanged(existing, dto)) {
      logger.info(
        { reviewId: dto.id, productId: dto.productId, outcome: 'skipped' },
        'Review upsert: skipped (unchanged)',
      );
      return { created: false, updated: false, skipped: true };
    }

    await prisma.review.update({
      where: { id: dto.id },
      data: {
        author: dto.author,
        rating: dto.rating,
        title: dto.title,
        body: dto.body,
        date: dto.date,
        verified: dto.verified,
        isActive: true,
      },
    });
    logger.info(
      { reviewId: dto.id, productId: dto.productId, outcome: 'updated' },
      'Review upsert: updated',
    );
    return { created: false, updated: true, skipped: false };
  }

  async deactivateMissingReviews(productId: string, seenReviewIds: string[]): Promise<number> {
    const where = {
      productId,
      isActive: true,
      ...(seenReviewIds.length > 0 ? { id: { notIn: seenReviewIds } } : {}),
    };

    const result = await prisma.review.updateMany({
      where,
      data: { isActive: false },
    });

    if (result.count > 0) {
      logger.info(
        { productId, count: result.count },
        'Reviews deactivated (not seen in this run)',
      );
    }
    return result.count;
  }
}
