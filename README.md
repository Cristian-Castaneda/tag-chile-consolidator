# 🛣️ TAG Chile Consolidator

> Automated monthly statement downloader and consolidator for Chilean toll autopistas.
> Scrapes each concesionaria portal using your RUT and credentials, downloads the monthly data, and consolidates everything into a single Excel (`.xlsx`) workbook — one tab per autopista, one tab per car.

---

## Why this exists

Every month, Chilean drivers with TAG contracts must visit up to 10 different concesionaria portals, log in individually, download a CSV or XLSX, and manually consolidate to understand total spend per vehicle. This tool automates the entire flow end to end.

---

## Features

- RUT-first flow: enter your RUT once, reuse across all portals
- Per-portal login with password only (RUT already known)
- Pre-scrape validation via Servipag to confirm total outstanding balance
- Post-scrape cross-check: alerts if scraped data doesn't match Servipag totals
- Excel (`.xlsx`) output: one tab per autopista + one summary tab per car — **no Google account required**
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
1. Prompt: choose the period (month 1-12, then 4-digit year), then enter your RUT
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
   g. Add this autopista's data as a tab in the consolidated workbook
        │
        ▼
4. Post-loop validation
   → Compare consolidated total against Servipag baseline
   → Alert if discrepancy detected (missing portal, failed download, etc.)
        │
        ▼
5. Generate summary tabs
   → One tab per car/plate with monthly breakdown
   → One master "Resumen" tab across all autopistas and cars
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
│   └── output/
│       └── workbook.ts             # Write the consolidated .xlsx (per-autopista + per-car tabs)
│
├── package.json
├── tsconfig.json
└── .env.example                    # Required environment variables (no secrets, just config)
```

---

## Common Data Schema

Every portal's output is normalized to this shape before writing to the workbook:

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

## Output (Excel workbook)

A single local `.xlsx` is written to `./output/TAG Chile YYYY-MM.xlsx`. No Google
account, API, or service account is involved — open it in Excel, LibreOffice, or
upload it to Google Sheets yourself if you like.

```
[Workbook: TAG Chile YYYY-MM.xlsx]
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

- Node.js 20+ (for the local run) — or just Docker (for the container run)
- No Google Cloud project, spreadsheet, or service account needed — output is a
  local `.xlsx` file
- (Optional) An Anthropic API key, only if you want the LLM navigation fallback

---

## Environment Variables

Defined in `.env` (never committed). See `.env.example` for the full list. Key variables:

- `ANTHROPIC_API_KEY` — **optional**; enables the LLM navigation fallback. Leave empty to use selectors only
- `OUTPUT_DIR` — where the `.xlsx` is written (default `./output`)
- `TAG_PROFILE` — which profile from `config/profiles.yml` to run (default `default`)

No RUTs, passwords, or personal credentials are stored in environment variables or config files.

---

## Configuration Files

### `config/portals.yml`

Defines each autopista: its URL, login field selectors, known download button selectors, and expected file format. The scraper reads this at runtime — adding a new portal requires only a new entry here, no code changes.

### `config/profiles.yml`

Defines user profiles: a label, a RUT, and the list of car plates associated with that RUT. Passwords are never stored here — they are prompted at runtime per session.

---

> **Pick one of the two options below — they are alternatives, not sequential
> steps.** Use the local option if you have Node on your machine; use Docker if
> you'd rather not install Node/npm/Playwright on your host at all.

## Running Locally (Option A — requires Node 20+)

```bash
# 1. Clone the repo
git clone https://github.com/your-org/tag-chile-consolidator
cd tag-chile-consolidator

# 2. Install dependencies
npm install

# 3. Install Playwright browsers
npx playwright install chromium

# 4. Copy and fill in your env file
cp .env.example .env

# 5. Edit config/profiles.yml with your RUT + plates, then run
npm start
```

---

## Running with Docker (Option B — only Docker required)

This path needs **only Docker** — no Node, npm, or Playwright on your machine,
and your global npm config is never touched. The image bundles Node, every
dependency, and Chromium. So you do **not** run `npm install` here.

```bash
# 1. Clone the repo
git clone https://github.com/your-org/tag-chile-consolidator
cd tag-chile-consolidator

# 2. Create your env file (required by compose, even if mostly empty)
cp .env.example .env

# 3. Edit config/profiles.yml with your RUT + plates.
#    The consolidated .xlsx will be written to ./output.

# 4. Build the image once, then run interactively (it prompts for RUT + passwords)
docker compose build
docker compose run --rm consolidator --portal=costanera-norte
```

Use `docker compose run` (not `up`) so the terminal is attached for the prompts.
`config/` and `output/` are bind-mounted, so editing your RUT or reading results
needs no rebuild — only changes under `src/` require `docker compose build` again.

> Headed mode (`--headed`, to watch the browser) needs a desktop/X11 and is
> awkward in Docker — use Option A for that. In headless Docker runs, failure
> screenshots are saved to `./.downloads` instead.

---

## Deploying to Cloud Run (optional)

The Docker image is Cloud Run compatible. Key considerations:

- Playwright requires `--no-sandbox` flag in Cloud Run (already configured in `Dockerfile`)
- Output is a local `.xlsx`. Cloud Run's filesystem is ephemeral, so to keep
  results you must ship the file somewhere (upload to GCS, email it — see the
  roadmap). Otherwise a scheduled run produces nothing durable.
- The flow is interactive by default — see the note in `docs/cloud-run.md`.

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
- Output is a local `.xlsx` file you control — no third-party account, API, or cloud storage is touched

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
- [ ] Historical trend charts in the workbook output

---

## License

MIT
