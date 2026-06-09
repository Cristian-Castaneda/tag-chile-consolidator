// ════════════════════════════════════════════════════════════════════════════
// Configuration loading: portals.yml, profiles.yml, and environment (.env).
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import 'dotenv/config';
import type { PortalConfig, Profile } from './types.js';

const ROOT = process.cwd();
const CONFIG_DIR = resolve(ROOT, 'config');

interface PortalsFile {
  defaults?: Record<string, unknown>;
  portals?: Array<Record<string, unknown>>;
}

interface ProfilesFile {
  profiles?: Profile[];
}

/** Load and normalize all portals, merging in the `defaults` block. */
export function loadPortals(): PortalConfig[] {
  const raw = load(readFileSync(resolve(CONFIG_DIR, 'portals.yml'), 'utf8')) as PortalsFile;
  const d = raw.defaults ?? {};
  return (raw.portals ?? []).map((p) => ({
    id: String(p.id),
    name: String(p.name),
    concesionaria: String(p.concesionaria ?? '—'),
    scraper: String(p.scraper ?? 'generic'),
    enabled: p.enabled !== false,
    researched: p.researched === true,
    loginUrl: String(p.loginUrl ?? ''),
    rutFormat: (p.rutFormat ?? d.rutFormat ?? 'combined') as PortalConfig['rutFormat'],
    fileFormat: (p.fileFormat ?? d.fileFormat ?? 'xlsx') as PortalConfig['fileFormat'],
    selectors: (p.selectors ?? {}) as PortalConfig['selectors'],
    backend: p.backend as Record<string, string> | undefined,
    notes: typeof p.notes === 'string' ? p.notes.trim() : undefined,
    timeoutMs: Number(p.timeoutMs ?? d.timeoutMs ?? 45000),
    llmFallback: (p.llmFallback ?? d.llmFallback ?? true) as boolean,
  }));
}

export function loadProfiles(): Profile[] {
  const raw = load(readFileSync(resolve(CONFIG_DIR, 'profiles.yml'), 'utf8')) as ProfilesFile;
  return (raw.profiles ?? []).map((p) => ({
    id: String(p.id),
    label: String(p.label ?? p.id),
    rut: String(p.rut ?? ''),
    plates: Array.isArray(p.plates) ? p.plates.map(String) : [],
  }));
}

export function getProfile(id: string): Profile {
  const profiles = loadProfiles();
  const found = profiles.find((p) => p.id === id);
  if (!found) {
    const ids = profiles.map((p) => p.id).join(', ') || '(none)';
    throw new Error(`Profile "${id}" not found in config/profiles.yml. Available: ${ids}`);
  }
  return found;
}

export interface AppEnv {
  anthropicApiKey: string;
  anthropicModel: string;
  llmFallbackEnabled: boolean;
  profileId: string;
  headless: boolean;
  downloadDir: string;
  outputDir: string;
  logLevel: string;
}

export function loadEnv(): AppEnv {
  const e = process.env;
  return {
    anthropicApiKey: e.ANTHROPIC_API_KEY ?? '',
    anthropicModel: e.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    llmFallbackEnabled: e.LLM_FALLBACK_ENABLED !== 'false',
    profileId: e.TAG_PROFILE ?? 'default',
    headless: e.HEADLESS !== 'false',
    downloadDir: e.DOWNLOAD_DIR ?? './.downloads',
    outputDir: e.OUTPUT_DIR ?? './output',
    logLevel: e.LOG_LEVEL ?? 'info',
  };
}
