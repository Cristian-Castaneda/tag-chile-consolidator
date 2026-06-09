# 🛣️ TAG Chile Consolidator

> Automated monthly statement downloader and consolidator for Chilean toll autopistas.
> Scrapes each concesionaria portal using your RUT and credentials, downloads the monthly data, and consolidates everything into a single Google Sheet — one tab per autopista, one tab per car.

---

## Why this exists

Every month, Chilean drivers with TAG contracts must visit up to 10 different concesionaria portals, log in individually, download a CSV or XLSX, and manually consolidate to understand total spend per vehicle. This tool automates the entire flow end to end.

---

## Features

- RUT-first flow: enter your RUT once, reuse across all portals
- Per-portal login with password only (RUT already known)
- Pre-scrape validation via Servipag to confirm total outstanding balance
- Post-scrape cross-check: alerts if scraped data doesn't match Servipag totals
- Google Sheets output: one dedicated sheet per autopista + one summary sheet per car
- No credential storage: RUT and passwords are used in-session only and never persisted
- Multi-profile support: run for different RUTs via config file (no hardcoded values)
- Docker-ready: runs locally or deployable to Cloud Run
- Graceful login failure handling: informs user when a portal login fails or no account exists

---

## Supported Autopistas

| Autopista | Concesionaria | Portal |
|---|---|---|
| Costanera Norte | COPSA | web.costaneranorte.cl |
| Autopista Central | Autopase | autopase.cl |
| Vespucio Norte + Túnel San Cristóbal | Vespucio Norte | vespucionorte.cl |
| Vespucio Sur | Nueva Vespucio Sur | vespuciosur.cl |
| Acceso Vial AMB | AMB | accessamb.cl |
| Autopista Nororiente (AVO) | COPSA | web.costaneranorte.cl |
| Ruta 78 / Autopista del Sol | Autopase | autopase.cl |
| Ruta 68 / Rutas del Pacífico | — | rutasdelpacifico.cl |
| Autopista Los Libertadores (Ruta 57) | — | autopistaloislibertadores.cl |
| Ruta del Maipo (Ruta 5 Sur) | — | rutadelmaipo.cl |
| Survías (Ruta 5: Talca–Chillán) | — | survias.cl |
| Autovía Santiago–Lampa | — | — |

> Portals are defined in `config/portals.yml`. New portals can be added without touching source code.

---

## User Flow

```
1. Prompt: enter your RUT
        │
        ▼
2. Servipag lookup (by RUT)
   → Fetches full outstanding balance across all autopistas
   → This becomes the validation baseline for the session
        │
        ▼
3. For each autopista (loop):
   a. Prompt: enter your password for [Autopista Name]
      (RUT is already known — not asked again)
   b. Attempt login to concesionaria portal
      → If login fails: inform user, skip this autopista, continue loop
      → If no account found: inform user, skip, continue loop
   c. Navigate to monthly statements section
   d. Download CSV / XLSX for the current period
   e. Confirm successful download to user
   f. Parse and normalize file to common schema
   g. Write data to dedicated Google Sheet tab for this autopista
        │
        ▼
4. Post-loop validation
   → Compare consolidated total against Servipag baseline
   → Alert if discrepancy detected (missing portal, failed download, etc.)
        │
        ▼
5. Generate summary sheets
   → One sheet per car/plate with monthly breakdown
   → One master summary sheet across all autopistas and cars
        │
        ▼
6. Session ends — no credentials retained
```

---

## Project Structure

```
tag-chile-consolidator/
│
├── README.md
│
├── docker-compose.yml              # Local Docker orchestration
├── Dockerfile                      # Node + Playwright image
│
├── config/
│   ├── portals.yml                 # Portal URLs, login selectors, download triggers
│   └── profiles.yml                # RUT + car plates per user profile (no passwords stored)
│
├── src/
│   ├── main.ts                     # Orchestrator: runs the full user flow
│   │
│   ├── cli/
│   │   └── prompt.ts               # Interactive CLI prompts (RUT, passwords per portal)
│   │
│   ├── scrapers/
│   │   ├── base.ts                 # Shared Playwright logic: login, download, error handling
│   │   ├── servipag.ts             # Servipag lookup for baseline validation
│   │   └── [portal].ts             # One file per concesionaria (Costanera, Autopase, etc.)
│   │
│   ├── consolidator/
│   │   ├── parser.ts               # Normalize each portal's CSV/XLSX to common schema
│   │   └── validator.ts            # Cross-check scraped totals vs Servipag baseline
│   │
│   └── sheets/
│       ├── client.ts               # Google Sheets API auth and client setup
│       └── writer.ts               # Write per-autopista tabs and per-car summary tabs
│
├── package.json
├── tsconfig.json
└── .env.example                    # Required environment variables (no secrets, just config)
```

---

## Common Data Schema

Every portal's output is normalized to this shape before writing to Sheets:

| Field | Type | Description |
|---|---|---|
| `date` | `YYYY-MM-DD` | Date of transit |
| `plate` | `string` | Vehicle plate |
| `portal` | `string` | Autopista name |
| `portico` | `string` | Portico identifier |
| `amount` | `number` | CLP amount charged |
| `type` | `string` | Regular / PTT / Multa |
| `rut` | `string` | RUT of account holder |

---

## Google Sheets Output Structure

```
[Workbook: TAG Chile YYYY-MM]
│
├── 📊 Resumen                     # Master summary: total per car per autopista
├── 🚗 [Plate 1]                   # All transits for car 1, across all autopistas
├── 🚗 [Plate 2]                   # All transits for car 2
│
├── 🛣️ Costanera Norte             # Raw normalized data from this portal
├── 🛣️ Autopista Central
├── 🛣️ Vespucio Norte
└── ... (one tab per autopista with data)
```

---

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for containerized runs)
- A Google Cloud project with Sheets API enabled
- A Google service account JSON key with write access to your target spreadsheet

---

## Environment Variables

Defined in `.env` (never committed). See `.env.example` for the full list. Key variables:

- `GOOGLE_SHEET_ID` — the target Google Spreadsheet ID
- `GOOGLE_SERVICE_ACCOUNT_PATH` — path to your service account JSON key
- `ANTHROPIC_API_KEY` — used by the LLM navigation layer for resilient portal scraping

No RUTs, passwords, or personal credentials are stored in environment variables or config files.

---

## Configuration Files

### `config/portals.yml`

Defines each autopista: its URL, login field selectors, known download button selectors, and expected file format. The scraper reads this at runtime — adding a new portal requires only a new entry here, no code changes.

### `config/profiles.yml`

Defines user profiles: a label, a RUT, and the list of car plates associated with that RUT. Passwords are never stored here — they are prompted at runtime per session.

---

## Running Locally

```bash
# 1. Clone the repo
git clone https://github.com/your-org/tag-chile-consolidator

# 2. Install dependencies
npm install

# 3. Install Playwright browsers
npx playwright install chromium

# 4. Copy and fill in your env file
cp .env.example .env

# 5. Run
npm start
```

---

## Running with Docker

```bash
# Build and run
docker compose up --build

# The container includes Chromium — no local browser install needed
```

---

## Deploying to Cloud Run (optional)

The Docker image is Cloud Run compatible. Key considerations:

- Playwright requires `--no-sandbox` flag in Cloud Run (already configured in `Dockerfile`)
- Schedule monthly runs via Cloud Scheduler triggering a Cloud Run job
- Store `GOOGLE_SERVICE_ACCOUNT_PATH` content in Secret Manager and mount at runtime
- No persistent storage needed — all output goes directly to Google Sheets

Deployment steps are documented in `docs/cloud-run.md`.

---

## LLM Navigation Layer

Portal UIs change over time. To avoid constant maintenance, the scraper uses a hybrid approach:

- Known, stable selectors (defined in `portals.yml`) are tried first via Playwright directly
- If an element isn't found, a screenshot is taken and sent to Claude via the Anthropic API
- Claude identifies the correct element to interact with and returns a selector or coordinate
- The action is executed and the result is validated before continuing

This makes the tool resilient to minor UI updates without requiring code changes.

---

## Security Notes

- Passwords are prompted interactively at runtime via CLI and held in memory only for the duration of that portal's session
- No credentials are written to disk, logs, environment variables, or config files
- The tool operates in a sandboxed Playwright browser context that is destroyed after each session
- Google Sheets access uses a service account scoped to the specific spreadsheet only

---

## Contributing

Contributions welcome, especially:

- New portal scrapers (follow the pattern in `src/scrapers/base.ts`)
- Additional autopistas in `config/portals.yml`
- Improved normalization for edge cases in `src/consolidator/parser.ts`

Open an issue before starting a large change.

---

## Roadmap

- [ ] WhatsApp delivery of the monthly summary (via Meta Cloud API)
- [ ] Email delivery with PDF summary attachment
- [ ] Web UI for non-technical users (profile + portal management)
- [ ] Multi-RUT batch mode for fleet managers
- [ ] Historical trend charts in the Sheets output

---

## License

MIT
