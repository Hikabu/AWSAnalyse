import { prisma } from '../prisma';

export interface ScrapeRunStats {
  productsCreated: number;
  productsUpdated: number;
  productsSkipped: number;
  productsDeactivated: number;
  reviewsCreated: number;
  reviewsUpdated: number;
  reviewsSkipped: number;
}

export class ScrapeRunService {
  async startScrapeRun(categorySlug: string): Promise<string> {
    const run = await prisma.scrapeRun.create({
      data: {
        categorySlug,
        status: 'running',
      },
    });
    return run.id;
  }

  async finishScrapeRun(runId: string, stats: ScrapeRunStats): Promise<void> {
    await prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        ...stats,
        status: 'success',
        finishedAt: new Date(),
      },
    });
  }

  async failScrapeRun(runId: string, errorMessage: string): Promise<void> {
    await prisma.scrapeRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage,
      },
    });
  }
}
