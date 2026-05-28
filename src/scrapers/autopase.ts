// ════════════════════════════════════════════════════════════════════════════
// Autopase — Autopista Central & Ruta 78 / Autopista del Sol (autopase.cl).
// NEEDS RESEARCH: verify login selectors in portals.yml, then override
// navigateToStatements() and downloadStatement() here.
// ════════════════════════════════════════════════════════════════════════════

import { BaseScraper } from './base.js';

export class AutopaseScraper extends BaseScraper {
  override get coveredPortals(): string[] {
    return ['Autopista Central', 'Ruta 78 / Autopista del Sol'];
  }
}
