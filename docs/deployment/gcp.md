# GCP Deployment Runbook

This service is designed for Cloud Run, private Cloud Storage, and Firestore.

## Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com
```

## Environment

```bash
export GCP_PROJECT_ID="your-gcp-project"
export GCP_REGION="asia-southeast1"
export CLOUD_RUN_SERVICE="artifact-share"
export GCS_BUCKET="${GCP_PROJECT_ID}-artifact-share"
export APP_BASE_URL="https://share.example.com"
export SESSION_SECRET_NAME="artifact-share-session-secret"
export CLEANUP_SECRET_NAME="artifact-share-cleanup-secret"
export CLEANUP_JOB_NAME="artifact-share-cleanup"
export CUSTOM_DOMAIN="share.example.com"
```

For a Cloud Run custom domain, create the mapping first, then add the DNS records shown by Google Cloud. A typical CNAME target is:

```text
Type: CNAME
Host: share
Answer: ghs.googlehosted.com.
```

Verify DNS, certificate, and service health:

```bash
dig +short "${CUSTOM_DOMAIN}"
curl -fsS "https://${CUSTOM_DOMAIN}/healthz/"
```

After the custom domain health check succeeds, switch generated artifact URLs to the custom domain:

```bash
gcloud run services update "${CLOUD_RUN_SERVICE}" \
  --project "${GCP_PROJECT_ID}" \
  --region "${GCP_REGION}" \
  --update-env-vars APP_BASE_URL="https://${CUSTOM_DOMAIN}"
```

## Storage Bucket

Create a private bucket. Do not make objects public.

```bash
gcloud storage buckets create "gs://${GCS_BUCKET}" \
  --project "${GCP_PROJECT_ID}" \
  --location "${GCP_REGION}" \
  --uniform-bucket-level-access
```

## Firestore

Create a Firestore Native database if the project does not already have one:

```bash
gcloud firestore databases create \
  --database="(default)" \
  --location="${GCP_REGION}"
```

The service uses these collections:

- `artifacts`
- `publisherTokens`

## Secret Manager

Create a random session secret:

```bash
openssl rand -base64 48 | gcloud secrets create "${SESSION_SECRET_NAME}" \
  --data-file=- \
  --replication-policy="automatic"
```

Create a random cleanup secret. Cloud Scheduler sends this as a bearer token when it calls the internal cleanup endpoint:

```bash
openssl rand -base64 48 | gcloud secrets create "${CLEANUP_SECRET_NAME}" \
  --data-file=- \
  --replication-policy="automatic"
```

Publisher tokens are Argon2 hashes stored in Firestore. Generate a token record for each allowed publisher:

```bash
npm run admin -- generate-token --owner-id owner-1 --label "Example Publisher"
```

The command prints the raw `token` once and a `record` object that can be inserted into the `publisherTokens` collection. If your local shell has GCP application-default credentials, the CLI can write the record directly:

```bash
gcloud auth application-default login
GOOGLE_CLOUD_PROJECT="${GCP_PROJECT_ID}" \
FIRESTORE_TOKENS_COLLECTION=publisherTokens \
npm run admin -- generate-token --owner-id owner-1 --label "Example Publisher" --write-firestore
```

Avoid storing raw publisher tokens in Cloud Run environment variables in production.

## Runtime Service Account Access

Grant the default Cloud Run runtime service account access:

```bash
PROJECT_NUMBER="$(gcloud projects describe "${GCP_PROJECT_ID}" --format='value(projectNumber)')"
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding "gs://${GCS_BUCKET}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/datastore.user"

gcloud secrets add-iam-policy-binding "${SESSION_SECRET_NAME}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding "${CLEANUP_SECRET_NAME}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"
```

## Deploy

```bash
chmod +x scripts/deploy-cloud-run.sh
./scripts/deploy-cloud-run.sh
```

## Expired Artifact Cleanup

Expired links are blocked at request time. To also remove private HTML objects after expiry, create a Cloud Scheduler job:

```bash
CLOUD_RUN_URL="$(gcloud run services describe "${CLOUD_RUN_SERVICE}" \
  --project "${GCP_PROJECT_ID}" \
  --region "${GCP_REGION}" \
  --format='value(status.url)')"
CLEANUP_SECRET="$(gcloud secrets versions access latest \
  --project "${GCP_PROJECT_ID}" \
  --secret "${CLEANUP_SECRET_NAME}")"

gcloud scheduler jobs create http "${CLEANUP_JOB_NAME}" \
  --project "${GCP_PROJECT_ID}" \
  --location "${GCP_REGION}" \
  --schedule "*/30 * * * *" \
  --uri "${CLOUD_RUN_URL}/internal/cleanup/expired-artifacts" \
  --http-method POST \
  --headers "Authorization=Bearer ${CLEANUP_SECRET}" \
  >/dev/null
```

The cleanup endpoint deletes stored HTML objects for expired artifacts and keeps metadata so expired viewer URLs continue to render an expiry page.

## Domain

Map your custom domain to the Cloud Run service:

```bash
gcloud run domain-mappings create \
  --service "${CLOUD_RUN_SERVICE}" \
  --domain "${CUSTOM_DOMAIN}" \
  --region "${GCP_REGION}"
```

Then add the DNS records shown by Google Cloud.

## Local Smoke Test

Run with memory storage:

```bash
BOOTSTRAP_PUBLISHER_TOKEN="dev-token" \
DATA_BACKEND=memory \
SESSION_SECRET=dev-secret-change-me \
APP_BASE_URL=http://localhost:8080 \
npm run dev
```

Publish:

```bash
KLOVR_SHARE_API_URL=http://localhost:8080 \
KLOVR_SHARE_TOKEN=dev-token \
npm run share -- publish examples/sample-artifact.html --slug sample --title "Sample Artifact" --expires-in 1d --password demo --upsert
```

Open `http://localhost:8080/a/sample` and enter password `demo`.
