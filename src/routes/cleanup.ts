import { timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import type { AppConfig } from "../config";
import type { ArtifactRepository } from "../storage/artifactRepository";
import type { ObjectStore } from "../storage/objectStore";

type CleanupRouteDependencies = {
  repo: ArtifactRepository;
  objectStore: ObjectStore;
  config: AppConfig;
  now: () => Date;
};

export function registerCleanupRoutes(app: Express, dependencies: CleanupRouteDependencies): void {
  if (!dependencies.config.cleanupSecret) {
    return;
  }

  app.post("/internal/cleanup/expired-artifacts", async (request, response) => {
    if (!hasCleanupAccess(request, dependencies.config.cleanupSecret ?? "")) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const expiredArtifacts = await dependencies.repo.listExpiredArtifacts(
      dependencies.now().toISOString(),
      dependencies.config.cleanupBatchSize ?? 100
    );

    for (const artifact of expiredArtifacts) {
      await dependencies.objectStore.delete(artifact.objectPath);
      await dependencies.objectStore.deletePrefix(`artifacts/${artifact.slug}/assets/`);
    }

    response.json({
      cleaned: expiredArtifacts.length,
      slugs: expiredArtifacts.map((artifact) => artifact.slug)
    });
  });
}

function hasCleanupAccess(request: Request, expectedToken: string): boolean {
  const token = bearerToken(request);
  if (!token) {
    return false;
  }
  return constantTimeEqual(token, expectedToken);
}

function bearerToken(request: Request): string | null {
  const header = request.header("authorization");
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
