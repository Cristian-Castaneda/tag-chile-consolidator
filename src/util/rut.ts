// ════════════════════════════════════════════════════════════════════════════
// Chilean RUT parsing / validation.
// A RUT looks like "12.345.678-9": a numeric body plus a verifier digit (DV)
// computed with modulo-11. Some portals (e.g. Costanera Norte) split body and
// DV into separate fields, so we always keep them separable.
// ════════════════════════════════════════════════════════════════════════════

import type { Rut } from '../types.js';

/** Compute the modulo-11 verifier digit for a RUT body. */
export function computeDv(body: string): string {
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const res = 11 - (sum % 11);
  if (res === 11) return '0';
  if (res === 10) return 'K';
  return String(res);
}

/** Parse free-form RUT input ("12.345.678-9", "123456789", "12345678-K"). */
export function parseRut(input: string): Rut {
  const clean = input.replace(/[.\s]/g, '').replace(/–/g, '-').toUpperCase();
  const m = /^(\d+)-?([0-9K])$/.exec(clean);
  if (!m) throw new Error(`RUT inválido: "${input}"`);
  const body = m[1] as string;
  const dv = m[2] as string;
  return { body, dv, full: `${body}-${dv}` };
}

/** True if the input is a well-formed RUT with a correct verifier digit. */
export function isValidRut(input: string): boolean {
  try {
    const r = parseRut(input);
    return computeDv(r.body) === r.dv;
  } catch {
    return false;
  }
}

/** Pretty-print with thousands separators: "12.345.678-9". */
export function formatRutPretty(rut: Rut): string {
  const withDots = rut.body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${rut.dv}`;
}
