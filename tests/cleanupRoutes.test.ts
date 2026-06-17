import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryArtifactRepository } from "../src/storage/artifactRepository";
import { MemoryObjectStore, ObjectNotFoundError } from "../src/storage/objectStore";

const fixedNow = new Date("2026-06-18T00:00:00.000Z");

describe("cleanup routes", () => {
  it("does not expose cleanup when no cleanup secret is configured", async () => {
    const app = createApp({
      repo: new MemoryArtifactRepository({ now: () => fixedNow }),
      objectStore: new MemoryObjectStore(),
      config: testConfig()
    });

    await request(app).post("/internal/cleanup/expired-artifacts").expect(404);
  });

  it("requires the cleanup bearer token", async () => {
    const app = createApp({
      repo: new MemoryArtifactRepository({ now: () => fixedNow }),
      objectStore: new MemoryObjectStore(),
      config: testConfig({ cleanupSecret: "cleanup-token" })
    });

    await request(app).post("/internal/cleanup/expired-artifacts").expect(401);
    await request(app)
      .post("/internal/cleanup/expired-artifacts")
      .set("Authorization", "Bearer wrong-token")
      .expect(401);
  });

  it("deletes stored HTML objects for expired artifacts and keeps metadata", async () => {
    const repo = new MemoryArtifactRepository({ now: () => fixedNow });
    const objectStore = new MemoryObjectStore();
    await repo.create(baseArtifactInput({ slug: "expired", expiresAt: "2026-06-17T00:00:00.000Z" }));
    await objectStore.put("artifacts/expired/index.html", "<h1>Expired</h1>");
    await repo.create(baseArtifactInput({ slug: "future", expiresAt: "2026-06-19T00:00:00.000Z" }));
    await objectStore.put("artifacts/future/index.html", "<h1>Future</h1>");

    const app = createApp({
      repo,
      objectStore,
      config: testConfig({ cleanupSecret: "cleanup-token", cleanupBatchSize: 100 }),
      now: () => fixedNow
    });

    const response = await request(app)
      .post("/internal/cleanup/expired-artifacts")
      .set("Authorization", "Bearer cleanup-token")
      .expect(200);

    expect(response.body).toEqual({ cleaned: 1, slugs: ["expired"] });
    await expect(objectStore.get("artifacts/expired/index.html")).rejects.toBeInstanceOf(ObjectNotFoundError);
    await expect(objectStore.get("artifacts/future/index.html")).resolves.toBe("<h1>Future</h1>");
    await expect(repo.getBySlug("expired")).resolves.toMatchObject({
      slug: "expired",
      deletedAt: null
    });
  });

  it("deletes bundled assets for expired artifacts", async () => {
    const repo = new MemoryArtifactRepository({ now: () => fixedNow });
    const objectStore = new MemoryObjectStore();
    await repo.create(baseArtifactInput({ slug: "expired", expiresAt: "2026-06-17T00:00:00.000Z" }));
    await objectStore.put("artifacts/expired/index.html", "<h1>Expired</h1>");
    await objectStore.put("artifacts/expired/assets/demo.mp4", Buffer.from("video-bytes"), "video/mp4");

    const app = createApp({
      repo,
      objectStore,
      config: testConfig({ cleanupSecret: "cleanup-token", cleanupBatchSize: 100 }),
      now: () => fixedNow
    });

    await request(app)
      .post("/internal/cleanup/expired-artifacts")
      .set("Authorization", "Bearer cleanup-token")
      .expect(200);

    await expect(objectStore.get("artifacts/expired/assets/demo.mp4")).rejects.toBeInstanceOf(ObjectNotFoundError);
  });
});

function testConfig(overrides: { cleanupSecret?: string; cleanupBatchSize?: number } = {}) {
  return {
    appBaseUrl: "http://localhost:8080",
    dataBackend: "memory" as const,
    maxHtmlBytes: 1024,
    nodeEnv: "test",
    port: 8080,
    sessionSecret: "test-secret",
    ...overrides
  };
}

function baseArtifactInput(overrides: {
  slug: string;
  expiresAt: string | null;
}) {
  return {
    slug: overrides.slug,
    title: overrides.slug,
    ownerId: "owner-1",
    objectPath: `artifacts/${overrides.slug}/index.html`,
    passwordHash: null,
    expiresAt: overrides.expiresAt
  };
}
