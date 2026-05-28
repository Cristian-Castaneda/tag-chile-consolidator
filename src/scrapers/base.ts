// ════════════════════════════════════════════════════════════════════════════
// BaseScraper — shared Playwright logic for every portal.
//
// Provides: browser lifecycle, a generic config-driven login (split or combined
// RUT), selector resolution with LLM fallback, download capture, screenshots,
// and error classification. Portal subclasses override navigateToStatements()
// and downloadStatement() (and login()/assertLoggedIn() when a portal is special).
// ════════════════════════════════════════════════════════════════════════════

import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PortalConfig, Credentials, ScrapeResult, ScrapeStatus, TransitRecord } from '../types.js';
import { LlmNavigator } from '../llm/navigator.js';
import { parseStatementFile } from '../consolidator/parser.js';
import { logger } from '../util/logger.js';

export class LoginError extends Error {
  constructor(message = 'Login failed') {
    super(message);
    this.name = 'LoginError';
  }
}
export class NoAccountError extends Error {
  constructor(message = 'No account found for this RUT') {
    super(message);
    this.name = 'NoAccountError';
  }
}
export class NotImplementedError extends Error {
  constructor(message = 'Not implemented') {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export interface ScraperContext {
  navigator: LlmNavigator;
  downloadDir: string;
  headless: boolean;
  /** Period to scrape, YYYY-MM. */
  period: string;
  /** Plates registered to the active profile (for attribution). */
  plates: string[];
}

export abstract class BaseScraper {
  protected browser?: Browser;
  protected context?: BrowserContext;
  protected page!: Page;

  constructor(
    protected readonly portal: PortalConfig,
    protected readonly ctx: ScraperContext,
  ) {}

  /** Autopistas this scraper attributes data to (override when it covers many). */
  get coveredPortals(): string[] {
    return [this.portal.name];
  }

  /** Template method: launch → login → navigate → download → parse. */
  async run(creds: Credentials): Promise<ScrapeResult> {
    const base = {
      portalId: this.portal.id,
      portalName: this.portal.name,
      scraper: this.portal.scraper,
    };
    try {
      await this.launch();
      logger.step(`[${this.portal.name}] logging in…`);
      await this.login(creds);
      logger.success(`[${this.portal.name}] login OK`);

      await this.navigateToStatements();
      const file = await this.downloadStatement();
      logger.success(`[${this.portal.name}] downloaded statement → ${file}`);

      const records = await this.parse(file, creds);
      logger.success(`[${this.portal.name}] parsed ${records.length} transit rows`);
      return { ...base, status: 'success', records, downloadedFile: file, message: `${records.length} rows` };
    } catch (err) {
      const { status, message } = this.classify(err);
      if (status === 'error' || status === 'login_failed') {
        await this.snapshot('failure');
      }
      return { ...base, status, message, records: [] };
    } finally {
      await this.close();
    }
  }

  private classify(err: unknown): { status: ScrapeStatus; message: string } {
    if (err instanceof NoAccountError) return { status: 'no_account', message: err.message };
    if (err instanceof LoginError) return { status: 'login_failed', message: err.message };
    if (err instanceof NotImplementedError) return { status: 'not_implemented', message: err.message };
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`[${this.portal.name}] error:`, message);
    return { status: 'error', message };
  }

  // ── browser lifecycle ──────────────────────────────────────────────────────
  protected async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.ctx.headless,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      acceptDownloads: true,
      locale: 'es-CL',
      timezoneId: 'America/Santiago',
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.portal.timeoutMs);
  }

  protected async close(): Promise<void> {
    // Destroying the context drops all cookies/credentials from memory.
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }

  // ── generic login (override per portal if needed) ───────────────────────────
  protected async login(creds: Credentials): Promise<void> {
    if (!this.portal.loginUrl) throw new LoginError('No loginUrl configured for this portal');
    await this.page.goto(this.portal.loginUrl, { waitUntil: 'domcontentloaded' });
    await this.fillRut(creds.rut);
    await this.type(this.portal.selectors.password, creds.password, 'password field');
    await this.click(this.portal.selectors.submit, 'submit / "Ingresar" button');
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.assertLoggedIn();
  }

  protected async fillRut(rut: Credentials['rut']): Promise<void> {
    if (this.portal.rutFormat === 'split') {
      await this.type(this.portal.selectors.rut, rut.body, 'RUT body field (no dots, no verifier)');
      await this.type(this.portal.selectors.rutDv, rut.dv, 'RUT verifier-digit field');
    } else {
      await this.type(this.portal.selectors.rut, rut.full, 'RUT field');
    }
  }

  /** Heuristic post-login check. Portals with richer signals should override. */
  protected async assertLoggedIn(): Promise<void> {
    const errSel = this.portal.selectors.loginError;
    if (errSel) {
      const txt = await this.page.locator(errSel).first().textContent().catch(() => null);
      if (txt && txt.trim().length > 0) {
        throw new LoginError(`Portal reported: ${txt.trim().slice(0, 160)}`);
      }
    }
    const pwSel = this.portal.selectors.password;
    if (pwSel) {
      const stillOnForm = await this.page.locator(pwSel).first().isVisible().catch(() => false);
      if (stillOnForm) {
        throw new LoginError('Still on the login form after submit (wrong credentials or captcha required)');
      }
    }
  }

  // ── portal-specific steps (override) ────────────────────────────────────────
  protected async navigateToStatements(): Promise<void> {
    throw new NotImplementedError(
      `navigateToStatements() not implemented for "${this.portal.name}" — portal needs research`,
    );
  }

  protected async downloadStatement(): Promise<string> {
    throw new NotImplementedError(
      `downloadStatement() not implemented for "${this.portal.name}" — portal needs research`,
    );
  }

  /** Default parse delegates to the consolidator (per-portal column mapping). */
  protected async parse(file: string, creds: Credentials): Promise<TransitRecord[]> {
    return parseStatementFile(this.portal, file, { rut: creds.rut.full, plates: this.ctx.plates });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  /** Resolve a selector, falling back to the LLM navigator on a miss. */
  protected async resolveLocator(selector: string | undefined, description: string): Promise<Locator> {
    if (selector) {
      const loc = this.page.locator(selector).first();
      if ((await loc.count()) > 0) return loc;
      logger.debug(`[${this.portal.name}] selector miss for ${description}: ${selector}`);
    }
    if (this.portal.llmFallback && this.ctx.navigator.active) {
      const r = await this.ctx.navigator.locate(this.page, description);
      if (r.found && r.selector) {
        const loc = this.page.locator(r.selector).first();
        if ((await loc.count()) > 0) {
          logger.debug(`[${this.portal.name}] LLM resolved "${description}" → ${r.selector}`);
          return loc;
        }
      }
    }
    throw new Error(`Could not locate ${description}${selector ? ` (selector: ${selector})` : ''}`);
  }

  protected async type(selector: string | undefined, value: string, description: string): Promise<void> {
    const loc = await this.resolveLocator(selector, description);
    await loc.fill(value);
  }

  protected async click(selector: string | undefined, description: string): Promise<void> {
    const loc = await this.resolveLocator(selector, description);
    await loc.click();
  }

  /** Try clicking a link/button by visible text (with LLM fallback). */
  protected async clickByText(text: string | RegExp, description = String(text)): Promise<void> {
    const byText = this.page.getByText(text, { exact: false }).first();
    if ((await byText.count()) > 0) {
      await byText.click();
      return;
    }
    const byRole = this.page.getByRole('link', { name: text }).first();
    if ((await byRole.count()) > 0) {
      await byRole.click();
      return;
    }
    await this.click(undefined, description); // LLM fallback
  }

  /** Run `trigger`, capture the resulting download, and save it under downloadDir. */
  protected async captureDownload(trigger: () => Promise<void>): Promise<string> {
    mkdirSync(this.ctx.downloadDir, { recursive: true });
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: this.portal.timeoutMs }),
      trigger(),
    ]);
    const suggested = download.suggestedFilename() || `${this.portal.id}.${this.portal.fileFormat}`;
    const dest = resolve(this.ctx.downloadDir, `${this.portal.id}-${this.ctx.period}-${suggested}`);
    await download.saveAs(dest);
    return dest;
  }

  protected async snapshot(name: string): Promise<void> {
    try {
      mkdirSync(this.ctx.downloadDir, { recursive: true });
      const path = resolve(this.ctx.downloadDir, `${this.portal.id}-${name}.png`);
      await this.page.screenshot({ path, fullPage: true });
      logger.debug(`[${this.portal.name}] screenshot saved → ${path}`);
    } catch {
      /* page may be closed; ignore */
    }
  }
}
