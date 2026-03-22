# Amazon parser

Node.js (TypeScript) scraper that collects products from a configurable Amazon search/category URL, fetches reviews per product, and stores everything in PostgreSQL with **Prisma**. Subsequent runs only write **new or changed** rows where the logic below applies.

On startup, the app runs **pre-flight health checks**: it retries the database connection (up to 10 times, 3s apart) and runs **`prisma migrate deploy`**. The scraper body does not run until both succeed.

## Stack

- Node.js 18+, TypeScript (strict)
- **Playwright** + **playwright-extra** + **puppeteer-extra-plugin-stealth** (Chromium) for page loads
- **cheerio** for HTML parsing
- Prisma + PostgreSQL
- `pino` for logging
- Docker Compose (optional): PostgreSQL, pgAdmin, scraper container (`mcr.microsoft.com/playwright` base + `shm_size: 1gb` for Chromium)

## Running with Docker (recommended)

1. **Copy env file**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` if needed. Use matching `POSTGRES_*` values and a `DATABASE_URL` that points at `localhost` when you run tools on the host (e.g. `npx prisma studio`). The **scraper service** gets `DATABASE_URL` with host **`db`** automatically from Compose. Set **`PGADMIN_EMAIL`** and **`PGADMIN_PASSWORD`** for pgAdmin (defaults in `.env.example` are fine for local dev).

2. **Start database, pgAdmin, and the scraper**

   ```bash
   docker compose up --build
   ```

   The scraper image installs Chromium and system libraries from the official Playwright Jammy image; Compose allocates **1GB shared memory** for the browser.

3. **Later runs** (database already has data; only new/changed rows are updated)

   ```bash
   docker compose up
   ```

Startup order: Postgres starts → health check passes → pgAdmin and scraper can start → scraper runs `runHealthChecks()` (DB probe + migrations) → browser launches → scraper logic.

### pgAdmin (browse the database in a browser)

After `docker compose up`:

1. Open [http://localhost:5050](http://localhost:5050).
2. Sign in with `PGADMIN_EMAIL` / `PGADMIN_PASSWORD` from `.env` (e.g. `admin@admin.com` / `admin`).
3. In the tree: **Servers → Amazon Parser DB** (pre-registered via `pgadmin/servers.json`).
4. If prompted for the database password, use **`POSTGRES_PASSWORD`** from `.env` (e.g. `strongpassword123`).
5. Navigate: **Databases → amazon_parser → Schemas → public → Tables** — right-click a table → **View/Edit Data → All Rows**.

If you change **`POSTGRES_USER`**, **`POSTGRES_DB`**, or host/port, update `pgadmin/servers.json` to match.

When **no product cards** are parsed, the scraper writes **`debug_page_<n>.html`** under the process working directory (`/app` in the container). Example copy to host:

`docker cp amazon_parser_scraper:/app/debug_page_1.html ./debug_page_1.html`

### Prisma Studio (no Docker UI)

On the host, with `DATABASE_URL` pointing at your DB:

```bash
npx prisma studio
```

Opens [http://localhost:5555](http://localhost:5555) for quick table browsing without pgAdmin.

## Running locally (without Docker)

1. **PostgreSQL** must be listening on `localhost:5432` (or adjust `DATABASE_URL`).

2. **Install dependencies and Chromium for Playwright**

   ```bash
   npm install
   npm run playwright:install
   ```

3. **Migrations**

   You can create or evolve the schema with:

   ```bash
   npx prisma migrate dev --name init
   ```

   When you start the app (`ts-node` or `node dist/index.js`), the health check also runs **`prisma migrate deploy`**, so pending migrations are applied before scraping.

4. **Start the scraper**

   ```bash
   npx ts-node src/index.ts
   ```

   Or after `npm run build`:

   ```bash
   node dist/index.js
   ```

## Project layout

- `docker-compose.yml` — `db` (Postgres 16), `pgAdmin`, `scraper` (depends on healthy `db`, `shm_size: 1gb`)
- `pgadmin/servers.json` — pre-registered server for pgAdmin (`Host: db`)
- `Dockerfile` — build on Playwright Jammy; runner installs Chromium via `playwright install`
- `prisma/schema.prisma` — `Product` and `Review` models
- `prisma/migrations/` — SQL migrations for `migrate deploy` in Docker
- `src/utils/health.check.ts` — connection retries + `prisma migrate deploy`
- `src/utils/browser.client.ts` — Playwright + stealth, polite delays, optional selector wait
- `src/scrapers/` — cheerio parsers for listing and reviews
- `src/services/` — persistence with change detection
- `src/config.ts` — env-driven settings (category URL is not hardcoded in scrapers)
- `src/index.ts` — health checks, browser init/close, orchestration

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run `ts-node src/index.ts` |
| `npm run build` | Compile to `dist/` |
| `npm run start` | Run `node dist/index.js` |
| `npm run playwright:install` | `playwright install chromium` |
| `npm run prisma:migrate` | `prisma migrate dev` |

## Notes

- **Datacenter IPs** (many cloud hosts and some Docker environments) are still often blocked even with a real browser. If Playwright + stealth is not enough, try running from a **home/office network**, or add a **residential proxy** via `browser.newContext({ proxy: { server, username, password } })` in `browser.client.ts`, or use a third-party scraping API.
- Amazon HTML changes often; empty results may require selector updates. Use dumped `debug_page_*.html` files to inspect the live DOM.
- Respect Amazon’s terms of service and robots rules for your use case.
