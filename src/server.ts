import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { createApp } from "./app";
import { readConfig, type AppConfig } from "./config";
import { hashSecret } from "./security/hash";
import type { ArtifactRepository } from "./storage/artifactRepository";
import { MemoryArtifactRepository } from "./storage/artifactRepository";
import { FirestoreArtifactRepository } from "./storage/gcpArtifactRepository";
import { CloudStorageObjectStore } from "./storage/gcpObjectStore";
import { MemoryObjectStore, type ObjectStore } from "./storage/objectStore";

async function main(): Promise<void> {
  const config = readConfig();
  const { repo, objectStore } = await buildAdapters(config);
  await seedBootstrapPublisher(repo, config);

  const app = createApp({ repo, objectStore, config });
  app.listen(config.port, () => {
    console.log(`Klovr Artifact Share listening on ${config.port}`);
  });
}

async function buildAdapters(config: AppConfig): Promise<{ repo: ArtifactRepository; objectStore: ObjectStore }> {
  if (config.dataBackend === "gcp") {
    if (!config.gcsBucket) {
      throw new Error("GCS_BUCKET is required when DATA_BACKEND=gcp");
    }
    const firestore = new Firestore();
    const storage = new Storage();
    return {
      repo: new FirestoreArtifactRepository({
        firestore,
        artifactsCollection: config.firestoreArtifactsCollection ?? "artifacts",
        tokensCollection: config.firestoreTokensCollection ?? "publisherTokens"
      }),
      objectStore: new CloudStorageObjectStore(storage, config.gcsBucket)
    };
  }

  return {
    repo: new MemoryArtifactRepository(),
    objectStore: new MemoryObjectStore()
  };
}

async function seedBootstrapPublisher(repo: ArtifactRepository, config: AppConfig): Promise<void> {
  const tokenHash = config.bootstrapPublisherTokenHash ?? (
    config.bootstrapPublisherToken ? await hashSecret(config.bootstrapPublisherToken) : undefined
  );
  if (!tokenHash) {
    return;
  }

  await repo.putPublisherToken({
    id: "bootstrap",
    ownerId: "bootstrap",
    tokenHash,
    label: "Bootstrap Publisher",
    createdAt: new Date().toISOString(),
    revokedAt: null
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
