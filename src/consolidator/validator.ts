// ════════════════════════════════════════════════════════════════════════════
// validator.ts — cross-check scraped data against the Servipag baseline.
//
// IMPORTANT semantics: Servipag's "Pago Total TAG" reports OUTSTANDING DEBT,
// while a scraped monthly statement reports CHARGES for the period. They are
// not expected to be equal (already-paid transits carry no debt). So this is a
// coverage / sanity check, not an equality assertion:
//   • flag concesionarias that show debt in Servipag but produced NO scraped
//     data (likely a failed login/download or a missing portal entry);
//   • surface totals side-by-side for human review.
// ════════════════════════════════════════════════════════════════════════════

import type { ScrapeResult, ServipagBaseline } from '../types.js';

export interface PortalCheck {
  concesionaria: string;
  baselineDebt: number;
  scraped: boolean;
  scrapedTotal: number;
}

export interface ValidationReport {
  baselineAvailable: boolean;
  baselineTotal: number;
  scrapedTotal: number;
  perConcesionaria: PortalCheck[];
  warnings: string[];
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function validate(results: ScrapeResult[], baseline: ServipagBaseline): ValidationReport {
  const warnings: string[] = [];

  const scrapedTotal = results
    .flatMap((r) => r.records)
    .reduce((sum, rec) => sum + (Number.isFinite(rec.amount) ? rec.amount : 0), 0);

  // Index scraped totals by concesionaria.
  const byConcesionaria = new Map<string, { total: number; hasData: boolean }>();
  for (const r of results) {
    const total = r.records.reduce((s, rec) => s + rec.amount, 0);
    const existing = byConcesionaria.get(norm(r.scraper)) ?? { total: 0, hasData: false };
    existing.total += total;
    existing.hasData = existing.hasData || r.status === 'success';
    byConcesionaria.set(norm(r.scraper), existing);
  }

  const perConcesionaria: PortalCheck[] = [];

  if (!baseline.available) {
    warnings.push('Servipag baseline unavailable — cross-check skipped.');
    return { baselineAvailable: false, baselineTotal: 0, scrapedTotal, perConcesionaria, warnings };
  }

  for (const line of baseline.lines) {
    // Best-effort name match between Servipag's label and our scraper/portal.
    const key = norm(line.concesionaria);
    let match: { total: number; hasData: boolean } | undefined;
    for (const [scraperKey, data] of byConcesionaria) {
      if (key.includes(scraperKey) || scraperKey.includes(key)) {
        match = data;
        break;
      }
    }
    const scraped = Boolean(match?.hasData);
    perConcesionaria.push({
      concesionaria: line.concesionaria,
      baselineDebt: line.amount,
      scraped,
      scrapedTotal: match?.total ?? 0,
    });
    if (line.amount > 0 && !scraped) {
      warnings.push(
        `Servipag shows debt of $${line.amount.toLocaleString('es-CL')} for "${line.concesionaria}" ` +
          `but no data was scraped — check that portal's login/download.`,
      );
    }
  }

  return {
    baselineAvailable: true,
    baselineTotal: baseline.total,
    scrapedTotal,
    perConcesionaria,
    warnings,
  };
}
