// ════════════════════════════════════════════════════════════════════════════
// Scraper registry + factory. Maps a portal's `scraper` id (from portals.yml)
// to its implementation class. Unknown ids fall back to GenericScraper.
// ════════════════════════════════════════════════════════════════════════════

import type { PortalConfig } from '../types.js';
import { BaseScraper, type ScraperContext } from './base.js';
import { GenericScraper } from './generic.js';
import { CostaneraNorteScraper } from './costaneranorte.js';
import { AutopaseScraper } from './autopase.js';
import { VespucioNorteScraper } from './vespucionorte.js';
import { VespucioSurScraper } from './vespuciosur.js';
import { AmbScraper } from './amb.js';
import { RutasDelPacificoScraper } from './rutasdelpacifico.js';
import { LosLibertadoresScraper } from './loslibertadores.js';
import { RutaDelMaipoScraper } from './rutadelmaipo.js';
import { SurviasScraper } from './survias.js';

type ScraperCtor = new (portal: PortalConfig, ctx: ScraperContext) => BaseScraper;

const REGISTRY: Record<string, ScraperCtor> = {
  generic: GenericScraper,
  costaneranorte: CostaneraNorteScraper,
  autopase: AutopaseScraper,
  vespucionorte: VespucioNorteScraper,
  vespuciosur: VespucioSurScraper,
  amb: AmbScraper,
  rutasdelpacifico: RutasDelPacificoScraper,
  loslibertadores: LosLibertadoresScraper,
  rutadelmaipo: RutaDelMaipoScraper,
  survias: SurviasScraper,
};

export function createScraper(portal: PortalConfig, ctx: ScraperContext): BaseScraper {
  const Ctor = REGISTRY[portal.scraper] ?? GenericScraper;
  return new Ctor(portal, ctx);
}

export { BaseScraper } from './base.js';
export type { ScraperContext } from './base.js';
