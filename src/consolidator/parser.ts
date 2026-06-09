// ════════════════════════════════════════════════════════════════════════════
// parser.ts — normalize each portal's CSV/XLSX export to the common schema.
//
// Strategy: portals use Spanish headers that vary slightly (Fecha / Patente /
// Pórtico / Monto / Tipo). We match columns fuzzily (accent- and case-
// insensitive) against candidate names, with optional per-portal overrides.
// PDF parsing is intentionally out of scope here (see note for COPSA).
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parse as parseCsvSync } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import type { FileFormat, PortalConfig, TransitRecord } from '../types.js';

export interface ParseContext {
  rut: string;
  plates: string[];
}

type Row = Record<string, string>;

/** Candidate header names per logical field (lowercased, accent-stripped). */
const COLUMN_CANDIDATES: Record<keyof Omit<TransitRecord, 'portal' | 'rut'>, string[]> = {
  date: ['fecha', 'fecha transito', 'fecha de transito', 'fecha trans', 'dia', 'fecha hora'],
  plate: ['patente', 'placa', 'ppu', 'vehiculo', 'movil'],
  portico: ['portico', 'punto', 'punto de cobro', 'tramo', 'gantry', 'peaje', 'ubicacion', 'lugar'],
  amount: ['monto', 'tarifa', 'valor', 'importe', 'total', 'cargo', 'monto cobrado', 'precio'],
  type: ['tipo', 'categoria', 'clase', 'glosa', 'concepto', 'descripcion'],
};

export function parseStatementFile(portal: PortalConfig, file: string, ctx: ParseContext): TransitRecord[] {
  const rows = readRows(portal, file);
  const records: TransitRecord[] = [];
  for (const row of rows) {
    const rec = normalizeRow(portal, row, ctx);
    if (rec) records.push(rec);
  }
  return records;
}

/** Trust the actual downloaded extension over the configured fileFormat. */
function detectFormat(portal: PortalConfig, file: string): FileFormat {
  const ext = extname(file).toLowerCase();
  if (ext === '.csv' || ext === '.txt') return 'csv';
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
  if (ext === '.pdf') return 'pdf';
  return portal.fileFormat;
}

function readRows(portal: PortalConfig, file: string): Row[] {
  switch (detectFormat(portal, file)) {
    case 'csv':
      return readCsv(file);
    case 'xlsx':
      return readXlsx(file);
    case 'pdf':
      throw new Error(
        `PDF parsing is not implemented. "${portal.name}" exports PDF; ` +
          `prefer a tabular (CSV/XLSX) export from the transit-detail view, ` +
          `or add a PDF table extractor.`,
      );
    default:
      throw new Error(`Unknown fileFormat "${portal.fileFormat}" for ${portal.name}`);
  }
}

/** Decode as UTF-8, falling back to latin1 when invalid bytes appear. */
function decodeBuffer(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  // U+FFFD = replacement char → the bytes weren't valid UTF-8 (likely latin1,
  // which Chilean toll exports commonly use).
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

function readCsv(file: string): Row[] {
  const buf = readFileSync(file);
  // Chilean exports are frequently latin1 + ';' separated. csv-parse auto-detects
  // the delimiter when given a small candidate set.
  const text = decodeBuffer(buf);
  return parseCsvSync(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    delimiter: [';', ',', '\t'],
    trim: true,
  }) as Row[];
}

function readXlsx(file: string): Row[] {
  // Read via buffer (ESM-safe; avoids XLSX.readFile needing fs injection).
  const wb = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: false });
}

function normalizeRow(portal: PortalConfig, row: Row, ctx: ParseContext): TransitRecord | null {
  const index = buildHeaderIndex(row);

  const rawDate = pick(row, index, COLUMN_CANDIDATES.date);
  const rawAmount = pick(row, index, COLUMN_CANDIDATES.amount);
  // A real transit row must have a date and an amount; otherwise it is a
  // header/footer/summary line — skip it.
  if (!rawDate || !rawAmount) return null;

  const date = toIsoDate(rawDate);
  const amount = parseClp(rawAmount);
  if (!date || Number.isNaN(amount)) return null;

  const plate = normalizePlate(pick(row, index, COLUMN_CANDIDATES.plate) ?? '');
  const portico = (pick(row, index, COLUMN_CANDIDATES.portico) ?? '').trim();
  const type = classifyType(pick(row, index, COLUMN_CANDIDATES.type) ?? '');

  return {
    date,
    plate,
    portal: portal.name,
    portico,
    amount,
    type,
    rut: ctx.rut,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normHeader(s: string): string {
  return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Map normalized header → original key, so we can look rows up fuzzily. */
function buildHeaderIndex(row: Row): Map<string, string> {
  const idx = new Map<string, string>();
  for (const key of Object.keys(row)) idx.set(normHeader(key), key);
  return idx;
}

function pick(row: Row, index: Map<string, string>, candidates: string[]): string | undefined {
  // Exact normalized match first, then "contains" match.
  for (const c of candidates) {
    const key = index.get(c);
    if (key !== undefined) return String(row[key] ?? '').trim() || undefined;
  }
  for (const [norm, key] of index) {
    if (candidates.some((c) => norm.includes(c))) {
      const val = String(row[key] ?? '').trim();
      if (val) return val;
    }
  }
  return undefined;
}

/** Parse "12-05-2026", "12/05/2026", "2026-05-12", "12-05-2026 08:30" → YYYY-MM-DD. */
export function toIsoDate(input: string): string | null {
  const s = input.trim().split(/[ T]/)[0] ?? '';
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}`;
  return null;
}

function pad(n: string): string {
  return n.padStart(2, '0');
}

/** Parse a CLP amount: "$1.234", "1.234", "1234", "-$ 2.500" → integer CLP. */
export function parseClp(input: string): number {
  const neg = /-/.test(input);
  const digits = input.replace(/[^\d]/g, '');
  if (!digits) return Number.NaN;
  const value = Number(digits);
  return neg ? -value : value;
}

function normalizePlate(input: string): string {
  return input.toUpperCase().replace(/[\s.-]/g, '').trim();
}

/** Map a free-form type/glosa to the schema's Regular | PTT | Multa. */
export function classifyType(input: string): string {
  const s = stripAccents(input).toLowerCase();
  if (!s) return 'Regular';
  if (s.includes('multa') || s.includes('infraccion')) return 'Multa';
  if (s.includes('ptt') || s.includes('paso') || s.includes('sin tag') || s.includes('no facturad')) return 'PTT';
  return input.trim() || 'Regular';
}
