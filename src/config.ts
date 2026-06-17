export type AppConfig = {
  appBaseUrl: string;
  dataBackend: "memory" | "gcp";
  maxHtmlBytes: number;
  nodeEnv: string;
  port: number;
  sessionSecret: string;
  cleanupSecret?: string;
  cleanupBatchSize?: number;
  gcsBucket?: string;
  firestoreArtifactsCollection?: string;
  firestoreTokensCollection?: string;
  bootstrapPublisherToken?: string;
  bootstrapPublisherTokenHash?: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    appBaseUrl: env.APP_BASE_URL ?? `http://localhost:${env.PORT ?? 8080}`,
    dataBackend: env.DATA_BACKEND === "gcp" ? "gcp" : "memory",
    maxHtmlBytes: Number(env.MAX_HTML_BYTES ?? 5 * 1024 * 1024),
    nodeEnv: env.NODE_ENV ?? "development",
    port: Number(env.PORT ?? 8080),
    sessionSecret: env.SESSION_SECRET ?? "dev-secret-change-me",
    cleanupSecret: env.CLEANUP_SECRET,
    cleanupBatchSize: Number(env.CLEANUP_BATCH_SIZE ?? 100),
    gcsBucket: env.GCS_BUCKET,
    firestoreArtifactsCollection: env.FIRESTORE_ARTIFACTS_COLLECTION ?? "artifacts",
    firestoreTokensCollection: env.FIRESTORE_TOKENS_COLLECTION ?? "publisherTokens",
    bootstrapPublisherToken: env.BOOTSTRAP_PUBLISHER_TOKEN,
    bootstrapPublisherTokenHash: env.BOOTSTRAP_PUBLISHER_TOKEN_HASH
  };
}
