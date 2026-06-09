# Deploying to Cloud Run

The Docker image is Cloud Run compatible. Chromium is launched with
`--no-sandbox` (see `src/scrapers/base.ts`), which Cloud Run requires.

## ⚠️ Two things make a scheduled Cloud Run job tricky

1. **Interactive by design.** The flow prompts for your RUT once and a password
   per portal, and never stores credentials — fundamentally at odds with an
   unattended job. For a scheduled run you'd need to inject credentials at
   runtime (e.g. from Secret Manager) and add a non-interactive credential
   source to `src/cli/prompt.ts`. That trades the "no credential storage"
   guarantee for automation — choose deliberately.
2. **Output is a local file.** The tool writes `./output/TAG Chile YYYY-MM.xlsx`.
   Cloud Run's filesystem is ephemeral, so a scheduled run must **ship the file
   somewhere** or it's lost. Options: upload to a GCS bucket, or wire up the
   email/WhatsApp delivery on the roadmap.

For most people, the **local / on-demand** run (or `docker compose run --rm`) is
the right mode, and Cloud Run is only worth it once you've added both a
non-interactive credential source and a delivery step.

## Build & push the image

```bash
PROJECT=your-gcp-project
REGION=us-central1
IMAGE="$REGION-docker.pkg.dev/$PROJECT/tag/consolidator:latest"

gcloud builds submit --tag "$IMAGE"
```

## Persisting the output to GCS (example)

If you go the scheduled route, mount/copy the result to a bucket after the run,
e.g. add a `gsutil cp ./output/*.xlsx gs://<your-bucket>/tag/` step in an entry
wrapper, or run the container in a job that uploads on completion.

```bash
gcloud run jobs create tag-consolidator \
  --image "$IMAGE" \
  --region "$REGION" \
  --set-env-vars "HEADLESS=true,OUTPUT_DIR=/app/output"
```

`ANTHROPIC_API_KEY` is optional; set it (ideally via Secret Manager) only if you
want the LLM navigation fallback.
