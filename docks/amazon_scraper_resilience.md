# Amazon Scraper Resilience Guide

---

## State Machine: The Smart Retry Flow

The central idea is that every URL is not just a link — it's a **task with a lifecycle**. Instead of bots picking URLs at random and silently dying on failure, a central database tracks each URL through a defined set of states.

```
                        ┌─────────────────────────────────────────────────────┐
                        │                CENTRAL TASK DATABASE                │
                        └─────────────────────────────────────────────────────┘

   ┌──────────┐    Bot leases URL    ┌─────────────┐    Success    ┌───────────┐
   │ PENDING  │ ──────────────────►  │ IN-PROGRESS │ ───────────►  │ COMPLETED │
   └──────────┘                      └─────────────┘               └───────────┘
        ▲                                   │
        │                          403 / timeout / CAPTCHA
        │                                   │
        │   cooldown expires                ▼
        │   (≥10 min)             ┌──────────────────┐    fail_count ≥ 5    ┌─────────────┐
        └──────────────────────── │ FAILED-RETRYING  │ ──────────────────►  │ DEAD LETTER │
                                  └──────────────────┘                       └─────────────┘
                                  (log proxy + UA that                       (manual review)
                                   failed, increment
                                   fail_count)
```

### State Transition Table

| Step | Bot Action | Proxy State | DB Update |
|:-----|:-----------|:------------|:----------|
| **1** | Request URL | Proxy A — Active | `Status: In-Progress` |
| **2** | Hit 403 Forbidden | Proxy A — Burnt / Rotate | `Status: Failed · fail_count: 1` |
| **3** | Cooldown (5–15 min) | N/A | `Status: Failed-Retrying` |
| **4** | New bot wakes, leases URL | Proxy B — Fresh | `Status: In-Progress` |
| **5** | Success | Proxy B — Keep | `Status: Completed` |
| **…** | Still failing after 5 attempts | All proxies rotated | `Status: Dead Letter` |

> **Dead Letter Queue** — If a URL fails 5× across 5 different proxies, the problem is likely structural (product delisted, URL changed) rather than a proxy issue. Move it aside for manual inspection rather than burning expensive residential proxy credits on a zombie link.

---

## 1 · Rate Limiting & Ban Evasion

Amazon tracks *patterns*, not just IPs. The goal is to mimic human browsing behavior across every dimension Amazon can observe.

**Proxy rotation** — Use a pool of **residential proxies**, not data-center IPs. Residential IPs appear as real home users and are far harder to blacklist in bulk.

**User-Agent rotation** — Rotate through a list of current browser strings (Chrome, Firefox, Safari on different OS). Never reuse the same UA + proxy pair after a failure — the state machine logs *which fingerprint failed* so a fresh combination is always used on retry.

**Request jitter** — Fixed-interval requests (every 2 s) look robotic. Add random delays of **3–10 seconds** between requests to break the pattern.

**Cookie strategy** — Clear cookies between sessions to appear as a new visitor. For flows that require browsing multiple pages, maintaining a session for a few clicks better mimics a real shopper.

---

## 2 · Network Errors & Timeouts

The internet is unreliable, and Amazon deliberately uses "tarpit" responses to exhaust scrapers.

**Exponential backoff** — On failure, wait $2^n$ seconds before retrying (where $n$ = number of consecutive failures). This prevents hammering a flagged endpoint.

**Smart timeouts** — Set a hard timeout of **15–30 seconds**. Pages that hang longer than this are almost certainly tarpits designed to tie up your threads.

**HTTP status handling:**

| Code | Meaning | Action |
|:-----|:--------|:-------|
| `403 Forbidden` | IP is flagged | Switch proxy immediately |
| `429 Too Many Requests` | Rate limit hit | Slow crawl rate; back off |
| `503 Service Unavailable` | Throttled or detected as bot | Cool down; retry via state machine |

All of these trigger a transition to **Failed-Retrying** in the state machine, with the failing proxy fingerprint logged.

---

## 3 · HTML Breakage (Structural Changes)

Amazon rotates randomized CSS class names to break CSS-selector-based scrapers. Selectors that worked yesterday may return nothing today.

**Robust XPath selectors** — Avoid brittle CSS paths like `div > div > span`. Use XPath to find elements by stable attributes or visible text (e.g., `//span[contains(text(),'Customer Reviews')]`). Text labels change far less often than class names.

**JSON-LD / Schema.org metadata** — Check for `<script type="application/ld+json">` tags. Amazon embeds structured product data here for search-engine indexing; it is much more stable than the visible HTML.

**Validation layer** — Before saving, assert that critical fields (`Price`, `Title`, `ASIN`) are non-empty. An empty result is the signal that structure has changed — log it, save the raw HTML snapshot, and raise an alert rather than silently writing nulls to your database.

---

## 4 · Logging & Observability

Flying blind means you won't know you're banned until your database is empty.

**Log levels** — Use structured, leveled logging:
- `INFO` — normal progress (URL leased, page fetched)
- `WARNING` — retries, slow responses, unexpected status codes
- `ERROR` — total failure, empty parse results, structure breakage

**Success rate monitoring** — Track the ratio of `200 OK` vs. non-200 responses as a rolling metric. A sudden spike in `403`s should trigger an automatic **kill switch** that pauses the crawl and preserves remaining proxy credits.

**HTML snapshots on error** — When a critical failure occurs, save the raw `.html` response to disk. This lets you see exactly what Amazon returned to your bot (CAPTCHA page, "Robot Check" page, 404) without guessing from log lines alone.

**State machine audit trail** — Because every URL transition is written to the central DB (`fail_count`, `proxy_used`, `ua_used`, `timestamp`), you have a full history of *why* each URL failed and *what was tried* — invaluable for debugging bans and detecting structural changes.

---

## Pro Tip: When to Go Headless

If `GET` requests consistently return CAPTCHA or empty pages, Amazon may require JavaScript execution for the content you need. A headless browser (**Playwright** or **Puppeteer**) renders JS and behaves much more like a real browser — at the cost of higher CPU/RAM usage. Treat headless as a fallback tier in your proxy/bot rotation, not the default.
