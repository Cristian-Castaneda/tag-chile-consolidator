// ════════════════════════════════════════════════════════════════════════════
// COPSA portal — Costanera Norte & Autopista Nororiente (AVO).
// web.costaneranorte.cl, backed by a legacy Delphi `convenios.dll` app.
//
// LOGIN — verified against the live login page (2026-05):
//   • RUT is SPLIT: #RUT (body, ≤8 digits, no dots) + #RUTDV (verifier digit)
//   • #PASSWORD
//   • Submit is <a id="send" href="javascript:sendPOST()"> → posts the form to
//     https://www.costaneranorte.cl/convenios.dll/dologin
//   • Cloudflare Turnstile is ADAPTIVE: enforced only when localStorage
//     "loginCaptchaRequired" === "1" (set after failed/suspicious attempts).
//     A fresh automated login normally submits with NO captcha.
//
// POST-LOGIN navigation + download are BEST-EFFORT and marked TODO — they need
// one authenticated test pass to finalize routes/selectors. The dashboard
// exposes "Ver boleta y detalle de tránsitos"; boletas are PDF, but the
// transit-detail view may offer a tabular export (preferred).
// ════════════════════════════════════════════════════════════════════════════

import { BaseScraper, LoginError } from './base.js';

export class CostaneraNorteScraper extends BaseScraper {
  /** Costanera Norte and AVO Nororiente share this login/account. */
  override get coveredPortals(): string[] {
    return ['Costanera Norte', 'Autopista Nororiente (AVO)'];
  }

  protected override async assertLoggedIn(): Promise<void> {
    // A successful POST leaves login.html. If we're still there, decide whether
    // it's bad credentials or an adaptive Turnstile challenge.
    const url = this.page.url();
    if (/login\.html/i.test(url)) {
      const body = (await this.page.locator('body').innerText().catch(() => '')) || '';
      if (/clave|contrase|incorrect|inv[aá]lid|no\s+existe/i.test(body)) {
        throw new LoginError('Credenciales inválidas (Costanera Norte / COPSA)');
      }
      throw new LoginError(
        'Login no completó — posible Cloudflare Turnstile activo (Costanera Norte / COPSA)',
      );
    }
  }

  protected override async navigateToStatements(): Promise<void> {
    // TODO(authenticated test): confirm the exact convenios.dll route / menu label.
    await this.clickByText(
      /detalle de tr[aá]nsitos|ver boleta|tr[aá]nsitos/i,
      'menú "Ver boleta y detalle de tránsitos"',
    );
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  protected override async downloadStatement(): Promise<string> {
    // TODO(authenticated test): prefer the tabular (Excel/CSV) export of the
    // transit detail; if only PDF boletas exist, parsing will report clearly.
    return this.captureDownload(async () => {
      await this.clickByText(
        /excel|exportar|descargar|csv|xlsx/i,
        'botón de exportar/descargar el detalle de tránsitos',
      );
    });
  }
}
