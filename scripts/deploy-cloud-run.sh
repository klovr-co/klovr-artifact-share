#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GCP_REGION:=asia-southeast1}"
: "${CLOUD_RUN_SERVICE:=klovr-artifact-share}"
: "${GCS_BUCKET:?Set GCS_BUCKET}"
: "${APP_BASE_URL:?Set APP_BASE_URL, for example https://share.example.com}"
: "${SESSION_SECRET_NAME:=klovr-artifact-share-session-secret}"
: "${CLEANUP_SECRET_NAME:=klovr-artifact-share-cleanup-secret}"
: "${CLEANUP_BATCH_SIZE:=100}"

gcloud config set project "${GCP_PROJECT_ID}" >/dev/null

gcloud run deploy "${CLOUD_RUN_SERVICE}" \
  --source . \
  --region "${GCP_REGION}" \
  --allow-unauthenticated \
  --set-env-vars "APP_BASE_URL=${APP_BASE_URL},DATA_BACKEND=gcp,GCS_BUCKET=${GCS_BUCKET},FIRESTORE_ARTIFACTS_COLLECTION=artifacts,FIRESTORE_TOKENS_COLLECTION=publisherTokens,MAX_HTML_BYTES=5242880,CLEANUP_BATCH_SIZE=${CLEANUP_BATCH_SIZE}" \
  --set-secrets "SESSION_SECRET=${SESSION_SECRET_NAME}:latest,CLEANUP_SECRET=${CLEANUP_SECRET_NAME}:latest"
