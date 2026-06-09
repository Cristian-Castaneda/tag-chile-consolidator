// ════════════════════════════════════════════════════════════════════════════
// Interactive CLI prompts. The RUT is asked once; a password is asked per
// portal. Passwords are returned to the caller and never stored here.
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

export async function confirmContinue(message: string, fallback = true): Promise<boolean> {
  return confirm({ message, default: fallback });
}
