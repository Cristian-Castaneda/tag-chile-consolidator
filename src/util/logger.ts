// ════════════════════════════════════════════════════════════════════════════
// Minimal leveled logger. Credential-safe: callers must never pass passwords.
// A `redactRut` helper is provided for the rare case a RUT must appear in logs.
// ════════════════════════════════════════════════════════════════════════════

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

let threshold: LogLevel = 'info';

export function setLogLevel(level: string | undefined): void {
  if (level && level in ORDER) threshold = level as LogLevel;
}

function emit(level: LogLevel, prefix: string, args: unknown[]): void {
  if (ORDER[level] > ORDER[threshold]) return;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(prefix, ...args);
}

/** Mask a RUT to "12·····-9" so the body never appears in full in logs. */
export function redactRut(rut: string): string {
  const m = /^(\d{1,2})\d*([-–])?([0-9kK])$/.exec(rut.replace(/\./g, ''));
  if (!m) return '••••••';
  return `${m[1]}·····-${m[3]}`;
}

export const logger = {
  error: (...args: unknown[]) => emit('error', '❌', args),
  warn: (...args: unknown[]) => emit('warn', '⚠️ ', args),
  info: (...args: unknown[]) => emit('info', 'ℹ️ ', args),
  success: (...args: unknown[]) => emit('info', '✅', args),
  step: (...args: unknown[]) => emit('info', '▶️ ', args),
  debug: (...args: unknown[]) => emit('debug', '🐛', args),
};
