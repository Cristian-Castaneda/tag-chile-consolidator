// ════════════════════════════════════════════════════════════════════════════
// servipag.ts — Servipag "Pago Total TAG" lookup (validation baseline).
//
// Servipag consolidates outstanding TAG debt across adhered autopistas by RUT:
//   https://portal.servipag.com/paymentexpress/category/autopistas/company/pagototaltag
//
// This produces the session's validation baseline (outstanding debt — NOT the
// same as monthly charges; see consolidator/validator.ts). The page is a SPA;
// selectors below are best-effort and marked TODO. On any failure the function
// returns { available: false } so the main flow continues.
// ════════════════════════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import type { Rut, ServipagBalanceLine, ServipagBaseline } from '../types.js';
import type { ScraperContext } from './base.js';
import { parseClp } from '../consolidator/parser.js';
import { logger } from '../util/logger.js';

const SERVIPAG_URL =
  'https://portal.servipag.com/paymentexpress/category/autopistas/company/pagototaltag';

export async function fetchServipagBaseline(rut: Rut, ctx: ScraperContext): Promise<ServipagBaseline> {
  const fetchedAt = new Date().toISOString();
  const unavailable = (message: string): ServipagBaseline => ({
    rut: rut.full,
    total: 0,
    lines: [],
    fetchedAt,
    available: false,
    message,
  });

  const browser = await chromium.launch({
    headless: ctx.headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({ locale: 'es-CL', timezoneId: 'America/Santiago' });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(SERVIPAG_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    // TODO(verify): map the real RUT input + submit on the Servipag SPA.
    const rutInput = page
      .locator('input[name*="rut" i], input[id*="rut" i], input[placeholder*="rut" i]')
      .first();
    if ((await rutInput.count()) === 0) {
      return unavailable('Servipag RUT input not found (SPA selectors need verification)');
    }
    await rutInput.fill(rut.full);

    const submit = page.getByRole('button', { name: /consultar|continuar|buscar|pagar/i }).first();
    if ((await submit.count()) > 0) {
      await submit.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    const lines = await scrapeBalanceLines(page);
    const total = lines.reduce((s, l) => s + l.amount, 0);
    if (lines.length === 0) {
      return unavailable('Servipag balance rows not parsed (DOM mapping TODO)');
    }
    return { rut: rut.full, total, lines, fetchedAt, available: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Servipag baseline lookup failed:', msg);
    return unavailable(msg);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Extract per-concesionaria balance lines.
 * TODO(verify): map to the real Servipag results DOM. Until then this returns
 * an empty list (baseline marked unavailable), which the validator tolerates.
 */
async function scrapeBalanceLines(_page: import('playwright').Page): Promise<ServipagBalanceLine[]> {
  // Placeholder. Example of the intended shape once the DOM is mapped:
  //   const rows = await _page.locator('.result-row').all();
  //   return Promise.all(rows.map(async (row) => ({
  //     concesionaria: (await row.locator('.name').innerText()).trim(),
  //     amount: parseClp(await row.locator('.amount').innerText()),
  //   })));
  void parseClp; // keep the helper imported for the real implementation
  return [];
}
