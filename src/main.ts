// ════════════════════════════════════════════════════════════════════════════
// main.ts — orchestrator for the full user flow (see README):
//   RUT → Servipag baseline → per-portal login + download + parse →
//   validate vs baseline → write Google Sheets (or local fallback) → summary.
//
// CLI flags:
//   --all                 include portals marked researched:false (best-effort)
//   --portal=a,b,c        run only these portal ids (alias: --only)
//   --profile=<id>        profile id from config/profiles.yml (default: env)
//   --period=YYYY-MM      period to scrape (default: current month)
//   --headed              run the browser headed (debugging)
// ════════════════════════════════════════════════════════════════════════════

import { loadEnv, loadPortals, getProfile } from './config.js';
import { setLogLevel, logger } from './util/logger.js';
import { LlmNavigator } from './llm/navigator.js';
import { createScraper, type ScraperContext } from './scrapers/index.js';
import { fetchServipagBaseline } from './scrapers/servipag.js';
import { validate, type ValidationReport } from './consolidator/validator.js';
import { isSheetsConfigured, getSheetsClient } from './sheets/client.js';
import { writeConsolidated } from './sheets/writer.js';
import { writeLocalOutput } from './util/output.js';
import { promptRut, promptPassword } from './cli/prompt.js';
import type { AppEnv } from './config.js';
import type { PortalConfig, Profile, ScrapeResult, ScrapeStatus } from './types.js';

interface CliArgs {
  all: boolean;
  headed: boolean;
  period?: string;
  profile?: string;
  portals?: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { all: false, headed: false };
  for (const raw of argv) {
    const [key, val] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    switch (key) {
      case '--all':
        args.all = true;
        break;
      case '--headed':
        args.headed = true;
        break;
      case '--period':
        if (val && /^\d{4}-\d{2}$/.test(val)) args.period = val;
        break;
      case '--profile':
        if (val) args.profile = val;
        break;
      case '--portal':
      case '--only':
        if (val) args.portals = val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      default:
        break;
    }
  }
  return args;
}

/** Pick which portals to run, honoring --portal / --all / researched flag. */
function selectTargets(portals: PortalConfig[], args: CliArgs): PortalConfig[] {
  let list = portals.filter((p) => p.enabled);
  if (args.portals?.length) {
    const set = new Set(args.portals);
    list = list.filter((p) => set.has(p.id));
  } else if (!args.all) {
    list = list.filter((p) => p.researched);
  }
  return list;
}

/** Group portals by their scraper so a shared login is performed only once. */
function groupByScraper(portals: PortalConfig[]): Map<string, PortalConfig[]> {
  const groups = new Map<string, PortalConfig[]>();
  for (const p of portals) {
    const arr = groups.get(p.scraper) ?? [];
    arr.push(p);
    groups.set(p.scraper, arr);
  }
  return groups;
}

const STATUS_ICON: Record<ScrapeStatus, string> = {
  success: '✅',
  login_failed: '🔒',
  no_account: '🚫',
  not_implemented: '🚧',
  error: '❌',
  skipped: '⏭️',
};

function reportResult(r: ScrapeResult): void {
  const icon = STATUS_ICON[r.status];
  const tail = r.message ? ` — ${r.message}` : '';
  logger.info(`[${r.portalName}] ${icon} ${r.status}${tail}`);
}

function printValidation(report: ValidationReport): void {
  logger.step('Validación contra Servipag:');
  if (!report.baselineAvailable) {
    logger.info('  (baseline no disponible — sólo se reportan totales raspados)');
  } else {
    logger.info(`  Baseline Servipag (deuda): $${report.baselineTotal.toLocaleString('es-CL')}`);
  }
  logger.info(`  Total raspado (cargos del período): $${report.scrapedTotal.toLocaleString('es-CL')}`);
  for (const w of report.warnings) logger.warn(`  ${w}`);
}

function printSummary(results: ScrapeResult[]): void {
  logger.step('Resumen de la sesión:');
  for (const r of results) {
    const rows = r.records.length ? ` (${r.records.length} filas)` : '';
    logger.info(`  ${STATUS_ICON[r.status]} ${r.portalName}: ${r.status}${rows}`);
  }
  const ok = results.filter((r) => r.status === 'success').length;
  logger.info(`  ${ok}/${results.length} portal(es) con datos.`);
}

async function persist(env: AppEnv, profile: Profile, results: ScrapeResult[]): Promise<void> {
  if (isSheetsConfigured(env.googleSheetId, env.googleServiceAccountPath)) {
    try {
      const sheets = await getSheetsClient(env.googleServiceAccountPath);
      await writeConsolidated(sheets, env.googleSheetId, env.period, results, profile);
      return;
    } catch (err) {
      logger.error('Error escribiendo en Google Sheets:', err instanceof Error ? err.message : String(err));
      logger.warn('Guardando salida local como respaldo…');
    }
  } else {
    logger.warn('Google Sheets no configurado — guardando salida local en ./output.');
  }
  const path = writeLocalOutput('output', env.period, results);
  logger.success(`Salida local escrita: ${path}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  setLogLevel(env.logLevel);
  if (args.period) env.period = args.period;
  if (args.headed) env.headless = false;

  const profile = getProfile(args.profile ?? env.profileId);
  logger.info(`🛣️  TAG Chile Consolidator — perfil "${profile.label}", período ${env.period}`);

  const targets = selectTargets(loadPortals(), args);
  if (targets.length === 0) {
    logger.warn('No hay portales seleccionados. Usa --all o --portal=<id> para incluir más.');
    return;
  }
  logger.info(`Portales objetivo: ${targets.map((p) => p.name).join(', ')}`);

  const navigator = new LlmNavigator({
    apiKey: env.anthropicApiKey,
    model: env.anthropicModel,
    enabled: env.llmFallbackEnabled,
  });
  if (env.llmFallbackEnabled && !navigator.active) {
    logger.warn('LLM fallback habilitado pero falta ANTHROPIC_API_KEY — sólo se usarán selectores.');
  }

  const ctx: ScraperContext = {
    navigator,
    downloadDir: env.downloadDir,
    headless: env.headless,
    period: env.period,
    plates: profile.plates,
  };

  // 1. RUT (once).
  const rut = await promptRut(profile.rut);

  // 2. Servipag baseline.
  logger.step('Consultando saldo total en Servipag…');
  const baseline = await fetchServipagBaseline(rut, ctx);
  if (baseline.available) {
    logger.success(
      `Servipag: deuda total $${baseline.total.toLocaleString('es-CL')} en ${baseline.lines.length} autopista(s).`,
    );
  } else {
    logger.warn(`Servipag no disponible (${baseline.message}). Continúo sin baseline.`);
  }

  // 3. Per-scraper loop (shared logins are performed once).
  const results: ScrapeResult[] = [];
  for (const [, portals] of groupByScraper(targets)) {
    const primary = portals[0];
    if (!primary) continue;
    const label = portals.map((p) => p.name).join(' / ');
    if (!primary.researched) logger.warn(`[${label}] portal sin verificar — intento best-effort.`);

    let password = await promptPassword(label);
    try {
      const result = await createScraper(primary, ctx).run({ rut, password });
      reportResult(result);
      results.push(result);
    } catch (err) {
      logger.error(`[${label}] error inesperado:`, err instanceof Error ? err.message : String(err));
      results.push({
        portalId: primary.id,
        portalName: primary.name,
        scraper: primary.scraper,
        status: 'error',
        records: [],
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      password = ''; // drop from memory
    }
  }

  // 4. Validation.
  printValidation(validate(results, baseline));

  // 5 & 6. Output + summary.
  await persist(env, profile, results);
  printSummary(results);
  logger.success('Sesión finalizada — no se retuvieron credenciales.');
}

main().catch((err) => {
  logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});
