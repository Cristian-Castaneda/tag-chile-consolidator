// ════════════════════════════════════════════════════════════════════════════
// writer.ts — write per-autopista tabs, per-car tabs, and a master summary.
//
// Output layout (see README):
//   📊 Resumen          master pivot: total per car per autopista
//   🚗 <Plate>          all transits for one car, across all autopistas
//   🛣️ <Autopista>      raw normalized data from one portal
// ════════════════════════════════════════════════════════════════════════════

import type { sheets_v4 } from 'googleapis';
import type { Profile, ScrapeResult, TransitRecord } from '../types.js';
import { logger } from '../util/logger.js';

const TRANSIT_HEADER = ['Fecha', 'Patente', 'Autopista', 'Pórtico', 'Monto', 'Tipo', 'RUT'];

type Cell = string | number;

export async function writeConsolidated(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  period: string,
  results: ScrapeResult[],
  profile: Profile,
): Promise<void> {
  const all = results.flatMap((r) => r.records);

  const portals = unique(all.map((r) => r.portal)).sort();
  const platesInData = unique(all.map((r) => r.plate).filter(Boolean));
  const plates = unique([...profile.plates, ...platesInData]);

  const resumenTitle = '📊 Resumen';
  const carTitles = plates.map(carTab);
  const portalTitles = portals.map(portalTab);

  await ensureSheets(sheets, spreadsheetId, [resumenTitle, ...carTitles, ...portalTitles]);

  // Master summary.
  await writeTab(sheets, spreadsheetId, resumenTitle, buildResumen(all, plates, portals, period));

  // Per-car tabs.
  for (const plate of plates) {
    const rows = all.filter((r) => r.plate === plate);
    await writeTab(sheets, spreadsheetId, carTab(plate), transitTable(rows));
  }

  // Per-autopista tabs.
  for (const portal of portals) {
    const rows = all.filter((r) => r.portal === portal);
    await writeTab(sheets, spreadsheetId, portalTab(portal), transitTable(rows));
  }

  logger.success(
    `Wrote ${all.length} rows to Google Sheet: Resumen + ${plates.length} car tab(s) + ${portals.length} autopista tab(s).`,
  );
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

// ── Sheets API plumbing ───────────────────────────────────────────────────────
async function ensureSheets(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  titles: string[],
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[],
  );
  const toAdd = titles.filter((t) => !existing.has(t));
  if (toAdd.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: toAdd.map((title) => ({ addSheet: { properties: { title } } })),
    },
  });
}

async function writeTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  values: Cell[][],
): Promise<void> {
  const range = `'${title.replace(/'/g, "''")}'`;
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${range}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

// ── small utils ─────────────────────────────────────────────────────────────
function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
function carTab(plate: string): string {
  return `🚗 ${plate}`;
}
function portalTab(portal: string): string {
  return `🛣️ ${portal}`;
}
