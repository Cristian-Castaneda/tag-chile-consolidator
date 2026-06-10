// ════════════════════════════════════════════════════════════════════════════
// servipag.ts — Servipag "Pago Total TAG" lookup (validation baseline).
//
// Servipag consolidates outstanding TAG debt across adhered autopistas by RUT:
//   https://portal.servipag.com/paymentexpress/category/autopistas/company/pagototaltag
//
// ⚠️  REALITY CHECK (verified 2026-06 against the live site):
// The page sits behind a **mandatory Cloudflare Turnstile "managed" challenge**
// ("Un momento…" / "Verifique que es un ser humano"). A vanilla headless
// browser NEVER reaches the SPA — Cloudflare holds it on the challenge page
// forever — which is why the previous version reported a misleading
// "RUT input not found". The fix is not a selector tweak; it is getting past
// Cloudflare. To do that we:
//   1. drive a REAL Chrome (channel: 'chrome'; bundled Chromium as fallback),
//   2. run HEADED by default so a human can clear the one-time checkbox
//      (override with SERVIPAG_HEADLESS=true once a cookie is cached),
//   3. use a PERSISTENT profile (SERVIPAG_STATE_DIR, default ".servipag") so the
//      cf_clearance cookie is reused on later runs and the challenge is skipped,
//   4. WAIT patiently for the challenge to clear before touching the SPA.
//
// Once past Cloudflare we enter the RUT and read the consolidated balance. Those
// post-challenge selectors are best-effort (the cloud CI used to build this
// cannot pass Turnstile to verify them), so they are backed by the LLM navigator
// fallback and, on any miss, the live DOM is dumped to DOWNLOAD_DIR so selectors
// can be finalized from a real run. On any failure we return { available: false }
// and the main flow continues without a baseline. This produces OUTSTANDING DEBT
// (not monthly charges — see consolidator/validator.ts).
// ════════════════════════════════════════════════════════════════════════════

import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Rut, ServipagBalanceLine, ServipagBaseline } from '../types.js';
import type { ScraperContext } from './base.js';
import { parseClp } from '../consolidator/parser.js';
import { logger } from '../util/logger.js';

const SERVIPAG_URL =
  'https://portal.servipag.com/paymentexpress/category/autopistas/company/pagototaltag';

/** Persistent profile dir — keeps the cf_clearance cookie between runs. */
const STATE_DIR = process.env.SERVIPAG_STATE_DIR ?? '.servipag';
/** Cloudflare managed challenge phrases (page title / body). */
const CHALLENGE_RE = /just a moment|un momento|verificaci[oó]n de seguridad|attention required/i;

/**
 * Servipag runs HEADED by default: the Cloudflare checkbox needs a real,
 * interactive browser. Set SERVIPAG_HEADLESS=true to force headless (only
 * useful once a valid cf_clearance cookie is cached in STATE_DIR).
 */
function servipagHeadless(): boolean {
  return process.env.SERVIPAG_HEADLESS === 'true';
}

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

  const headless = servipagHeadless();
  let context: BrowserContext | undefined;
  try {
    context = await launchServipagContext(headless);
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(45000);

    await page.goto(SERVIPAG_URL, { waitUntil: 'domcontentloaded' });

    // 1. Get past Cloudflare (cached cookie may make this instant).
    const cleared = await waitPastChallenge(page, headless ? 30000 : 180000, headless);
    if (!cleared) {
      await dumpDebug(page, ctx.downloadDir, 'servipag-challenge');
      return unavailable(
        headless
          ? 'Cloudflare bloqueó el navegador headless (challenge sin resolver). ' +
            'Ejecuta con SERVIPAG_HEADLESS=false para resolver el checkbox una vez.'
          : 'Cloudflare challenge no resuelto a tiempo — resuelve el checkbox ' +
            '"Verifique que es un ser humano" en la ventana del navegador.',
      );
    }

    // 2. Enter the RUT and submit.
    const entered = await enterRut(page, rut, ctx);
    if (!entered) {
      await dumpDebug(page, ctx.downloadDir, 'servipag-rut');
      return unavailable(
        'Pasó Cloudflare pero no encontré el campo RUT. ' +
          `Revisa el volcado en ${ctx.downloadDir}/servipag-rut.html para ajustar selectores.`,
      );
    }

    // 3. Read the consolidated balance.
    const result = await scrapeBalance(page);
    if (result.noDebt) {
      return { rut: rut.full, total: 0, lines: [], fetchedAt, available: true, message: 'Sin deuda registrada' };
    }
    if (result.lines.length === 0 && result.total == null) {
      await dumpDebug(page, ctx.downloadDir, 'servipag-results');
      return unavailable(
        'Pasó Cloudflare y envié el RUT, pero no pude leer los montos. ' +
          `Revisa el volcado en ${ctx.downloadDir}/servipag-results.html.`,
      );
    }
    const total = result.total ?? result.lines.reduce((s, l) => s + l.amount, 0);
    return { rut: rut.full, total, lines: result.lines, fetchedAt, available: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Servipag baseline lookup failed:', msg);
    return unavailable(msg);
  } finally {
    await context?.close().catch(() => {});
  }
}

// ── browser ──────────────────────────────────────────────────────────────────
/**
 * Launch a persistent context. Prefer real Chrome (much more likely to clear a
 * Cloudflare managed challenge than bundled Chromium); fall back to bundled
 * Chromium if Chrome isn't installed.
 */
async function launchServipagContext(headless: boolean): Promise<BrowserContext> {
  mkdirSync(STATE_DIR, { recursive: true });
  const common = {
    headless,
    // Escape hatch for corporate MITM proxies / sandboxes that re-sign TLS.
    // Off by default so we keep cert validation on a normal machine.
    ignoreHTTPSErrors: process.env.SERVIPAG_IGNORE_HTTPS_ERRORS === 'true',
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    viewport: { width: 1366, height: 900 },
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  };
  try {
    return await chromium.launchPersistentContext(STATE_DIR, { ...common, channel: 'chrome' });
  } catch (err) {
    logger.debug(
      'Servipag: Chrome real no disponible, uso Chromium incorporado:',
      err instanceof Error ? err.message : String(err),
    );
    return await chromium.launchPersistentContext(STATE_DIR, common);
  }
}

// ── Cloudflare ─────────────────────────────────────────────────────────────────
async function looksLikeChallenge(page: Page): Promise<boolean> {
  const title = (await page.title().catch(() => '')) || '';
  if (CHALLENGE_RE.test(title)) return true;
  const markers = await page
    .locator(
      'iframe[src*="challenges.cloudflare.com"], #challenge-running, .cf-turnstile, input[name="cf-turnstile-response"]',
    )
    .count()
    .catch(() => 0);
  return markers > 0;
}

/** Poll until the challenge clears (and the SPA renders) or the budget elapses. */
async function waitPastChallenge(page: Page, budgetMs: number, headless: boolean): Promise<boolean> {
  const start = Date.now();
  let announced = false;
  while (Date.now() - start < budgetMs) {
    if (!(await looksLikeChallenge(page))) {
      const body = await page.locator('body').innerText().catch(() => '');
      if (body.length > 150) return true;
    } else if (!announced) {
      logger.step(
        headless
          ? 'Servipag: Cloudflare challenge detectado (headless no puede resolverlo)…'
          : 'Servipag: resuelve el checkbox "Verifique que es un ser humano" en la ventana abierta…',
      );
      announced = true;
    }
    await page.waitForTimeout(1500);
  }
  return !(await looksLikeChallenge(page));
}

// ── RUT entry ───────────────────────────────────────────────────────────────────
const RUT_SELECTORS = [
  'input[formcontrolname*="rut" i]',
  'input[name*="rut" i]',
  'input[id*="rut" i]',
  'input[placeholder*="rut" i]',
  'input[aria-label*="rut" i]',
  'input[formcontrolname*="documento" i]',
  'input[placeholder*="documento" i]',
];

const SUBMIT_RE = /consultar|continuar|buscar|pagar|ver deuda|consulta|aceptar/i;

async function enterRut(page: Page, rut: Rut, ctx: ScraperContext): Promise<boolean> {
  let target = await findFirstVisible(page, RUT_SELECTORS);

  // LLM fallback (mirrors BaseScraper.resolveLocator) when selectors miss.
  if (!target && ctx.navigator.active) {
    const r = await ctx.navigator.locate(page, 'el campo de texto para ingresar el RUT del usuario');
    if (r.found && r.selector) {
      const loc = page.locator(r.selector).first();
      if ((await loc.count().catch(() => 0)) > 0) target = loc;
    } else if (r.found && typeof r.x === 'number' && typeof r.y === 'number') {
      const vp = page.viewportSize() ?? { width: 1366, height: 900 };
      await page.mouse.click(r.x * vp.width, r.y * vp.height).catch(() => {});
      const focused = page.locator('input:focus').first();
      if ((await focused.count().catch(() => 0)) > 0) target = focused;
    }
  }

  if (!target || (await target.count().catch(() => 0)) === 0) return false;

  await target.click().catch(() => {});
  await target.fill('').catch(() => {});
  // pressSequentially survives input masks that reject a pre-formatted paste.
  await target.pressSequentially(rut.full, { delay: 30 }).catch(async () => {
    await target!.fill(rut.full).catch(() => {});
  });

  const submit = page.getByRole('button', { name: SUBMIT_RE }).first();
  if ((await submit.count().catch(() => 0)) > 0) {
    await submit.click().catch(() => {});
  } else {
    await target.press('Enter').catch(() => {});
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  return true;
}

async function findFirstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
      return loc;
    }
  }
  return null;
}

// ── balance extraction ──────────────────────────────────────────────────────────
interface Extracted {
  lines: ServipagBalanceLine[];
  /** Authoritative "Total" if the page labels one; otherwise null (sum lines). */
  total: number | null;
  noDebt: boolean;
}

async function scrapeBalance(page: Page): Promise<Extracted> {
  // Wait (poll) for either amounts or a "no debt" message to render.
  const ready = /\$\s?\d|(no\s+(registra|tiene|posee|hay)|sin\s+deuda|al d[ií]a)/i;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const t = await page.locator('body').innerText().catch(() => '');
    if (ready.test(t)) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1000);
  const text = await page.locator('body').innerText().catch(() => '');
  return extractFromText(text);
}

/**
 * Structure-agnostic extraction: scan rendered text lines for CLP amounts and
 * pair each with its label (same line, else the line above). Resilient to the
 * exact (unverified) SPA DOM. The "Total" line, if present, wins as the total.
 */
export function extractFromText(text: string): Extracted {
  const rawLines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const hasPositive = /\$\s?[1-9][\d.]*/.test(text);
  const noDebt =
    !hasPositive && /(no\s+(registra|tiene|posee|hay)|sin\s+deuda|al d[ií]a|no\s+existe)/i.test(text);

  const lines: ServipagBalanceLine[] = [];
  let total: number | null = null;
  const AMOUNT = /\$\s?\d[\d.]*/;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i] as string;
    if (!AMOUNT.test(line)) continue;
    const amount = parseClp(line);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let label = line.replace(/\$\s?[\d.]+/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!label && i > 0) label = rawLines[i - 1] as string;

    if (/total/i.test(label)) {
      total = amount; // a labeled total — don't double-count it as a line
      continue;
    }
    lines.push({ concesionaria: label || 'Servipag', amount });
  }

  return { lines, total, noDebt };
}

// ── diagnostics ─────────────────────────────────────────────────────────────────
/** Save the live DOM + a screenshot so unverified selectors can be finalized. */
async function dumpDebug(page: Page, dir: string, tag: string): Promise<void> {
  try {
    mkdirSync(dir, { recursive: true });
    const html = await page.content().catch(() => '');
    writeFileSync(resolve(dir, `${tag}.html`), html);
    await page.screenshot({ path: resolve(dir, `${tag}.png`), fullPage: true }).catch(() => {});
    logger.debug(`Servipag: volcado de depuración → ${resolve(dir, `${tag}.html`)}`);
  } catch {
    /* page may be closed; ignore */
  }
}
