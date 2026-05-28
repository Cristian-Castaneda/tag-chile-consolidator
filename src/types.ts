// ════════════════════════════════════════════════════════════════════════════
// Shared types for the TAG Chile Consolidator.
// The TransitRecord is the common schema every portal normalizes to.
// ════════════════════════════════════════════════════════════════════════════

/** A single normalized toll transit — the common schema (see README). */
export interface TransitRecord {
  /** Date of transit, YYYY-MM-DD. */
  date: string;
  /** Vehicle plate (patente). */
  plate: string;
  /** Autopista name (becomes the Sheet tab). */
  portal: string;
  /** Portico / gantry identifier. */
  portico: string;
  /** CLP amount charged. */
  amount: number;
  /** Transit class: "Regular" | "PTT" | "Multa" | other portal-specific label. */
  type: string;
  /** RUT of the account holder, normalized as "BODY-DV". */
  rut: string;
}

export type RutFormat = 'split' | 'combined';
export type FileFormat = 'xlsx' | 'csv' | 'pdf';

/** CSS selectors for a portal's login form. Extra keys allowed per portal. */
export interface PortalSelectors {
  rut?: string;
  rutDv?: string;
  password?: string;
  submit?: string;
  loginError?: string;
  [key: string]: string | undefined;
}

/** One autopista portal, as defined in config/portals.yml (defaults merged in). */
export interface PortalConfig {
  id: string;
  name: string;
  concesionaria: string;
  scraper: string;
  enabled: boolean;
  researched: boolean;
  loginUrl: string;
  rutFormat: RutFormat;
  fileFormat: FileFormat;
  selectors: PortalSelectors;
  backend?: Record<string, string>;
  notes?: string;
  timeoutMs: number;
  llmFallback: boolean;
}

/** A user profile from config/profiles.yml (never holds passwords). */
export interface Profile {
  id: string;
  label: string;
  rut: string;
  plates: string[];
}

/** A parsed Chilean RUT. */
export interface Rut {
  /** Full normalized RUT, e.g. "12345678-9". */
  full: string;
  /** Body without dots or verifier, e.g. "12345678". */
  body: string;
  /** Verifier digit, uppercase, e.g. "9" or "K". */
  dv: string;
}

/** In-session credentials for a single portal. Never persisted. */
export interface Credentials {
  rut: Rut;
  password: string;
}

export type ScrapeStatus =
  | 'success'
  | 'login_failed'
  | 'no_account'
  | 'not_implemented'
  | 'error'
  | 'skipped';

/** Outcome of running one scraper (which may cover several autopistas). */
export interface ScrapeResult {
  portalId: string;
  portalName: string;
  scraper: string;
  status: ScrapeStatus;
  records: TransitRecord[];
  downloadedFile?: string;
  message?: string;
}

/** One line of the Servipag consolidated balance. */
export interface ServipagBalanceLine {
  concesionaria: string;
  amount: number;
}

/** The Servipag "Pago Total TAG" lookup result — the validation baseline. */
export interface ServipagBaseline {
  rut: string;
  total: number;
  lines: ServipagBalanceLine[];
  fetchedAt: string;
  available: boolean;
  message?: string;
}
