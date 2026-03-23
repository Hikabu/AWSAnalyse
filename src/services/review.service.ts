import { prisma } from '../prisma';
import { logger } from '../logger';
import type { ReviewDto } from '../types/dto';

function reviewChanged(
  existing: {
    starRating: number;
    title: string | null;
    body: string | null;
    reviewDate: Date;
    verifiedPurchase: boolean;
    helpfulVotes: number;
    isActive: boolean;
  },
  dto: ReviewDto,
): boolean {
  return (
    existing.starRating !== dto.rating ||
    existing.title !== dto.title ||
    existing.body !== dto.body ||
    existing.reviewDate.getTime() !== (dto.date?.getTime() ?? 0) ||
    existing.verifiedPurchase !== dto.verified ||
    existing.isActive === false
  );
}

export class ReviewService {
  async upsertReview(
    dto: ReviewDto,
    productId: string, // internal Product.id (cuid), not the ASIN
  ): Promise<{ created: boolean; updated: boolean; skipped: boolean }> {
    // Compound unique: amazonReviewId + productId
    const existing = await prisma.review.findUnique({
      where: {
        amazonReviewId_productId: {
          amazonReviewId: dto.id,
          productId,
        },
      },
    });

    // reviewDate is NOT NULL in schema — fall back to now() if scraper couldn't parse it
    const reviewDate = dto.date ?? new Date();

    if (!existing) {
      await prisma.review.create({
        data: {
          amazonReviewId: dto.id,
          productId,
          starRating: dto.rating,
          title: dto.title,
          body: dto.body,
          reviewDate,
          verifiedPurchase: dto.verified,
          helpfulVotes: 0,
          isActive: true,
        },
      });
      logger.info(
        { reviewId: dto.id, productId, outcome: 'created' },
        'Review upsert: created',
      );
      return { created: true, updated: false, skipped: false };
    }

    if (!reviewChanged(existing, dto)) {
      logger.info(
        { reviewId: dto.id, productId, outcome: 'skipped' },
        'Review upsert: skipped (unchanged)',
      );
      return { created: false, updated: false, skipped: true };
    }

    await prisma.review.update({
      where: {
        amazonReviewId_productId: {
          amazonReviewId: dto.id,
          productId,
        },
      },
      data: {
        starRating: dto.rating,
        title: dto.title,
        body: dto.body,
        reviewDate,
        verifiedPurchase: dto.verified,
        isActive: true,
      },
    });
    logger.info(
      { reviewId: dto.id, productId, outcome: 'updated' },
      'Review upsert: updated',
    );
    return { created: false, updated: true, skipped: false };
  }

  async deactivateMissingReviews(productId: string, seenReviewIds: string[]): Promise<number> {
    const result = await prisma.review.updateMany({
      where: {
        productId,
        isActive: true,
        ...(seenReviewIds.length > 0
          ? { amazonReviewId: { notIn: seenReviewIds } }
          : {}),
      },
      data: { isActive: false },
    });

    if (result.count > 0) {
      logger.info({ productId, count: result.count }, 'Reviews deactivated (not seen in this run)');
    }
    return result.count;
  }
}