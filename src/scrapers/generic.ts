// ════════════════════════════════════════════════════════════════════════════
// GenericScraper — used for portals that have no dedicated implementation yet.
// It attempts the config-driven login, then reports navigateToStatements() /
// downloadStatement() as "not implemented" so the orchestrator skips gracefully.
// ════════════════════════════════════════════════════════════════════════════

import { BaseScraper } from './base.js';

export class GenericScraper extends BaseScraper {}
