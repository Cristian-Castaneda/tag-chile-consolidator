// ════════════════════════════════════════════════════════════════════════════
// Interactive CLI prompts. The RUT is asked once; a password is asked per
// portal; the period is asked as month + year with strict validation.
// Passwords are returned to the caller and never stored here.
// ════════════════════════════════════════════════════════════════════════════

import { input, password as passwordPrompt, confirm } from '@inquirer/prompts';
import { isValidRut, parseRut } from '../util/rut.js';
import type { Rut } from '../types.js';

export async function promptRut(defaultRut?: string): Promise<Rut> {
  const value = await input({
    message: 'Ingresa tu RUT (formato 12.345.678-9):',
    default: defaultRut && isValidRut(defaultRut) ? defaultRut : undefined,
    validate: (v) => (isValidRut(v) ? true : 'RUT inválido — revisa el dígito verificador.'),
  });
  return parseRut(value);
}

export async function promptPassword(portalLabel: string): Promise<string> {
  return passwordPrompt({ message: `Contraseña para ${portalLabel}:`, mask: '•' });
}

/**
 * Ask for month (1-12) then year (4 digits) with validation, re-prompting on
 * bad input. Returns the period as "YYYY-MM". Defaults to the current month.
 */
export async function promptPeriod(): Promise<string> {
  const now = new Date();

  const month = await input({
    message: 'Mes del período (1-12):',
    default: String(now.getMonth() + 1),
    validate: (v) => {
      const t = v.trim();
      if (!/^\d{1,2}$/.test(t)) return 'Ingresa sólo el número del mes (1-12).';
      const n = Number(t);
      return n >= 1 && n <= 12 ? true : 'El mes debe estar entre 1 y 12.';
    },
  });

  const year = await input({
    message: 'Año del período (4 dígitos, ej. 2026):',
    default: String(now.getFullYear()),
    validate: (v) => {
      const t = v.trim();
      if (!/^\d{4}$/.test(t)) return 'El año debe tener exactamente 4 dígitos.';
      const n = Number(t);
      return n >= 2000 && n <= 2100 ? true : 'Ingresa un año entre 2000 y 2100.';
    },
  });

  const mm = String(Number(month.trim())).padStart(2, '0');
  return `${year.trim()}-${mm}`;
}

export async function confirmContinue(message: string, fallback = true): Promise<boolean> {
  return confirm({ message, default: fallback });
}
