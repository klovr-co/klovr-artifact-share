# Klovr Artifact Share

Klovr Artifact Share hosts HTML artifacts behind Klovr-owned infrastructure. Publishers use an API token through the Node CLI or `skills/klovr-share` agent skill; viewers get a clean URL with optional password protection and expiry enforcement.

Images and videos work as public/absolute URLs, inline `data:` URLs, or bundled private assets. For local sidecar files, put them in an assets directory and reference them from the HTML under `assets/...`; the service stores them privately and serves them through the same password/expiry gate.

## Local Quickstart

Install dependencies:

```bash
npm install
```

Start the service with in-memory storage and a dev publisher token:

```bash
BOOTSTRAP_PUBLISHER_TOKEN="dev-token" \
DATA_BACKEND=memory \
SESSION_SECRET=dev-secret-change-me \
APP_BASE_URL=http://localhost:8080 \
npm run dev
```

`DATA_BACKEND=memory` is only for local development and tests. Production deployments should use `DATA_BACKEND=gcp`, which stores artifact files in private Cloud Storage and metadata in Firestore.

Publish the sample artifact from another shell:

```bash
KLOVR_SHARE_API_URL=http://localhost:8080 \
KLOVR_SHARE_TOKEN=dev-token \
npm run share -- publish examples/sample-artifact.html --slug sample --title "Sample Artifact" --expires-in 1d --password demo --upsert
```

Open `http://localhost:8080/a/sample`, enter password `demo`, and the artifact renders in a sandboxed iframe.

Delete the link:

```bash
KLOVR_SHARE_API_URL=http://localhost:8080 \
KLOVR_SHARE_TOKEN=dev-token \
npm run share -- delete --slug sample
```

## Agent Skill

The repo-local skill lives at `skills/klovr-share`. It uses the portable Python script:

```bash
python skills/klovr-share/scripts/klovr_share.py publish ./artifact.html --slug demo --title "Demo" --expires-in 7d --password "viewer-secret"
```

For an HTML file that references local assets such as `<img src="assets/hero.png">` or `<video src="assets/demo.mp4">`, publish with:

```bash
python skills/klovr-share/scripts/klovr_share.py publish ./artifact.html --assets-dir ./assets --slug demo --expires-in 7d --password "viewer-secret"
```

Required environment:

```bash
export KLOVR_SHARE_API_URL=https://share.example.com
export KLOVR_SHARE_TOKEN="<publisher-token>"
```

Inject `KLOVR_SHARE_TOKEN` through your secret manager or local agent environment. Do not commit raw publisher tokens.

## Publisher Credentials

Generate an allowed publisher token and hashed Firestore record:

```bash
npm run admin -- generate-token --owner-id owner-1 --label "Example Publisher"
```

The raw token is shown once. Store the `record` object in the `publisherTokens` Firestore collection, or write it directly when authenticated with GCP application-default credentials:

```bash
GOOGLE_CLOUD_PROJECT=your-gcp-project \
FIRESTORE_TOKENS_COLLECTION=publisherTokens \
npm run admin -- generate-token --owner-id owner-1 --label "Example Publisher" --write-firestore
```

## GCP Deployment

See `docs/deployment/gcp.md`.

Production uses:

- Cloud Run for the Node service.
- Private Cloud Storage for HTML objects.
- Firestore for artifact and publisher-token metadata.
- Secret Manager for the viewer session signing secret and cleanup bearer token.
- Cloud Scheduler for expired artifact object cleanup.

## Verification

```bash
npm test
npm run build
npm audit --omit=dev
python3 /path/to/quick_validate.py skills/klovr-share
```
