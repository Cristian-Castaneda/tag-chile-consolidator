// ════════════════════════════════════════════════════════════════════════════
// Local output fallback. When Google Sheets is not configured, the consolidated
// data is written to ./output as JSON + CSV so a run is still useful end-to-end.
// ════════════════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScrapeResult } from '../types.js';

export function writeLocalOutput(dir: string, period: string, results: ScrapeResult[]): string {
  mkdirSync(dir, { recursive: true });
  const all = results.flatMap((r) => r.records);

  const jsonPath = resolve(dir, `tag-${period}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        period,
        generatedAt: new Date().toISOString(),
        portals: results.map((r) => ({
          portal: r.portalName,
          status: r.status,
          message: r.message,
          rows: r.records.length,
        })),
        records: all,
      },
      null,
      2,
    ),
  );

  const csvPath = resolve(dir, `tag-${period}.csv`);
  const header = 'date,plate,portal,portico,amount,type,rut';
  const lines = all.map((r) =>
    [r.date, r.plate, r.portal, r.portico, r.amount, r.type, r.rut].map(csvCell).join(','),
  );
  writeFileSync(csvPath, [header, ...lines].join('\n'));

  return jsonPath;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
