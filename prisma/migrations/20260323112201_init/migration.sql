-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'amazon_us',
    "browseNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'amazon_us',
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "imageUrl" TEXT,
    "productUrl" TEXT NOT NULL,
    "reviewsUrl" TEXT,
    "currentPrice" DECIMAL(10,2),
    "currentRating" DECIMAL(3,2),
    "reviewCount" INTEGER,
    "categoryId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScrapedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "amazonReviewId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "starRating" INTEGER NOT NULL,
    "title" TEXT,
    "body" VARCHAR(2000),
    "reviewDate" TIMESTAMP(3) NOT NULL,
    "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "helpfulVotes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'amazon_us',
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "productsCreated" INTEGER NOT NULL DEFAULT 0,
    "productsUpdated" INTEGER NOT NULL DEFAULT 0,
    "productsSkipped" INTEGER NOT NULL DEFAULT 0,
    "productsDeactivated" INTEGER NOT NULL DEFAULT 0,
    "reviewsCreated" INTEGER NOT NULL DEFAULT 0,
    "reviewsUpdated" INTEGER NOT NULL DEFAULT 0,
    "reviewsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeError" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "asin" TEXT,
    "errorType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "url" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScrapeError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_marketplace_idx" ON "Category"("marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_marketplace_key" ON "Category"("slug", "marketplace");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_lastScrapedAt_idx" ON "Product"("lastScrapedAt");

-- CreateIndex
CREATE INDEX "Product_isActive_categoryId_idx" ON "Product"("isActive", "categoryId");

-- CreateIndex
CREATE INDEX "Product_isActive_lastScrapedAt_idx" ON "Product"("isActive", "lastScrapedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_asin_marketplace_key" ON "Product"("asin", "marketplace");

-- CreateIndex
CREATE INDEX "Review_productId_reviewDate_idx" ON "Review"("productId", "reviewDate" DESC);

-- CreateIndex
CREATE INDEX "Review_productId_starRating_idx" ON "Review"("productId", "starRating");

-- CreateIndex
CREATE INDEX "Review_starRating_productId_idx" ON "Review"("starRating", "productId");

-- CreateIndex
CREATE INDEX "Review_ingestedAt_idx" ON "Review"("ingestedAt");

-- CreateIndex
CREATE INDEX "Review_isActive_productId_idx" ON "Review"("isActive", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_amazonReviewId_productId_key" ON "Review"("amazonReviewId", "productId");

-- CreateIndex
CREATE INDEX "ScrapeRun_categorySlug_startedAt_idx" ON "ScrapeRun"("categorySlug", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ScrapeRun_status_startedAt_idx" ON "ScrapeRun"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "ScrapeError_productId_idx" ON "ScrapeError"("productId");

-- CreateIndex
CREATE INDEX "ScrapeError_errorType_occurredAt_idx" ON "ScrapeError"("errorType", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ScrapeError_asin_idx" ON "ScrapeError"("asin");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeError" ADD CONSTRAINT "ScrapeError_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
