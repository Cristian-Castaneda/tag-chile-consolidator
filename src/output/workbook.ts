// ════════════════════════════════════════════════════════════════════════════
// workbook.ts — write the consolidated data to a single local .xlsx file.
//
// No Google account, no service account, no API. The user gets a plain Excel
// workbook and can do whatever they want with it. Layout (one tab each):
//   📊 Resumen          master pivot: total per car per autopista
//   🚗 <Plate>          all transits for one car, across all autopistas
//   🛣️ <Autopista>      raw normalized data from one portal
// ════════════════════════════════════════════════════════════════════════════

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import type { Profile, ScrapeResult, TransitRecord } from '../types.js';
import { logger } from '../util/logger.js';

const TRANSIT_HEADER = ['Fecha', 'Patente', 'Autopista', 'Pórtico', 'Monto', 'Tipo', 'RUT'];

type Cell = string | number;

/** Build the workbook and write it to `<outDir>/TAG Chile <period>.xlsx`. */
export function writeWorkbook(
  outDir: string,
  period: string,
  results: ScrapeResult[],
  profile: Profile,
): string {
  mkdirSync(outDir, { recursive: true });
  const all = results.flatMap((r) => r.records);

  const portals = unique(all.map((r) => r.portal)).sort();
  const platesInData = unique(all.map((r) => r.plate).filter(Boolean));
  const plates = unique([...profile.plates, ...platesInData]);

  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  appendSheet(wb, used, '📊 Resumen', buildResumen(all, plates, portals, period));
  for (const plate of plates) {
    appendSheet(wb, used, `🚗 ${plate}`, transitTable(all.filter((r) => r.plate === plate)));
  }
  for (const portal of portals) {
    appendSheet(wb, used, `🛣️ ${portal}`, transitTable(all.filter((r) => r.portal === portal)));
  }

  const path = resolve(outDir, `TAG Chile ${period}.xlsx`);
  // Write via buffer (ESM-safe; avoids XLSX.writeFile needing fs injection).
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  writeFileSync(path, buf);

  logger.success(
    `Workbook: ${path} — ${all.length} fila(s), ${plates.length} auto(s), ${portals.length} autopista(s).`,
  );
  return path;
}

// ── tab content builders ────────────────────────────────────────────────────
function transitTable(rows: TransitRecord[]): Cell[][] {
  const body = rows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => [r.date, r.plate, r.portal, r.portico, r.amount, r.type, r.rut] as Cell[]);
  return [TRANSIT_HEADER, ...body];
}

function buildResumen(all: TransitRecord[], plates: string[], portals: string[], period: string): Cell[][] {
  const header: Cell[] = ['Patente', ...portals, 'Total'];
  const rows: Cell[][] = [[`Período: ${period}`], header];

  const columnTotals = new Array<number>(portals.length).fill(0);
  let grandTotal = 0;

  for (const plate of plates) {
    const row: Cell[] = [plate];
    let rowTotal = 0;
    portals.forEach((portal, i) => {
      const sum = all
        .filter((r) => r.plate === plate && r.portal === portal)
        .reduce((s, r) => s + r.amount, 0);
      row.push(sum);
      rowTotal += sum;
      columnTotals[i] = (columnTotals[i] ?? 0) + sum;
    });
    row.push(rowTotal);
    grandTotal += rowTotal;
    rows.push(row);
  }

  rows.push(['Total', ...columnTotals, grandTotal]);
  return rows;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function appendSheet(wb: XLSX.WorkBook, used: Set<string>, rawName: string, rows: Cell[][]): void {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(rawName, used));
}

/** Excel sheet names: ≤31 chars, no : \ / ? * [ ], and must be unique. */
function safeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*\[\]]/g, '-').trim() || 'Hoja').slice(0, 31);
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
