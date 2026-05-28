# Deploying to Cloud Run

The Docker image is Cloud Run compatible. Chromium is launched with
`--no-sandbox` (see `src/scrapers/base.ts`), which Cloud Run requires.

## ⚠️ Interactive vs. scheduled runs

The default flow is **interactive**: it prompts for your RUT once and a password
per portal, and — by design — never stores credentials. That is fundamentally at
odds with an unattended, scheduled Cloud Run job.

You have two realistic options:

1. **Interactive / on-demand (recommended).** Run locally or via
   `docker compose run --rm consolidator`. Cloud Run is then only useful for the
   Sheets-writing/processing portions, not for headless scheduled scraping.
2. **Non-interactive (advanced).** If you accept supplying credentials to a
   scheduled job, inject them at runtime from **Secret Manager** (never bake them
   into the image or repo) and add a non-interactive credential source to
   `src/cli/prompt.ts`. This trades the "no credential storage" guarantee for
   automation — choose deliberately.

## Build & push the image

```bash
PROJECT=your-gcp-project
REGION=us-central1
IMAGE="$REGION-docker.pkg.dev/$PROJECT/tag/consolidator:latest"

gcloud builds submit --tag "$IMAGE"
```

## Secrets

Store the Google service-account JSON in Secret Manager and mount it at runtime:

```bash
gcloud secrets create tag-sa-key --data-file=./secrets/service-account.json
```

Mount the secret as a file and point `GOOGLE_SERVICE_ACCOUNT_PATH` at the mount
path. Set `GOOGLE_SHEET_ID` and `ANTHROPIC_API_KEY` as env vars (the latter
ideally also from Secret Manager).

## Deploy a job

```bash
gcloud run jobs create tag-consolidator \
  --image "$IMAGE" \
  --region "$REGION" \
  --set-secrets "/secrets/service-account.json=tag-sa-key:latest" \
  --set-env-vars "GOOGLE_SERVICE_ACCOUNT_PATH=/secrets/service-account.json,GOOGLE_SHEET_ID=...,HEADLESS=true"
```

## Schedule (only meaningful for a non-interactive build)

```bash
gcloud scheduler jobs create http tag-monthly \
  --schedule "0 9 1 * *" \
  --uri "https://<region>-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/tag-consolidator:run" \
  --http-method POST \
  --oauth-service-account-email "<runner-sa>@$PROJECT.iam.gserviceaccount.com"
```

No persistent storage is needed — all output goes directly to Google Sheets.
