import { PrismaClient } from '@prisma/client';
import { logger } from '../logger';

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

export async function runHealthChecks(): Promise<void> {
  await checkDatabaseConnection();
  await runPrismaMigrations();
  logger.info('All health checks passed. Starting scraper...');
}

async function checkDatabaseConnection(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const prisma = new PrismaClient();
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      logger.info({ attempt }, 'Database connection OK');
      return;
    } catch (err) {
      logger.warn(
        { attempt, maxRetries: MAX_RETRIES, err },
        `Database not ready (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${RETRY_DELAY_MS / 1000}s...`,
      );
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Cannot connect to database after ${MAX_RETRIES} attempts. Is PostgreSQL running?\n${String(err)}`,
        );
      }
      await delay(RETRY_DELAY_MS);
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }
}

async function runPrismaMigrations(): Promise<void> {
  logger.info('Running Prisma migrations...');
  const { execSync } = await import('node:child_process');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
    logger.info('Migrations applied successfully.');
  } catch (err) {
    throw new Error(`Prisma migration failed: ${String(err)}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
