import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { hashSecret } from "../src/security/hash";
import { MemoryArtifactRepository } from "../src/storage/artifactRepository";
import { MemoryObjectStore } from "../src/storage/objectStore";

describe("publisher API", () => {
  const fixedNow = new Date("2026-06-18T00:00:00.000Z");
  const config: AppConfig = {
    appBaseUrl: "http://localhost:8080",
    dataBackend: "memory",
    maxHtmlBytes: 1024 * 1024,
    nodeEnv: "test",
    port: 8080,
    sessionSecret: "test-secret"
  };

  let repo: MemoryArtifactRepository;
  let objectStore: MemoryObjectStore;

  beforeEach(async () => {
    repo = new MemoryArtifactRepository({
      now: () => fixedNow,
      idFactory: () => "artifact-1"
    });
    objectStore = new MemoryObjectStore();
    await repo.putPublisherToken({
      id: "token-1",
      ownerId: "owner-1",
      tokenHash: await hashSecret("publisher-token"),
      label: "Example Publisher",
      createdAt: fixedNow.toISOString(),
      revokedAt: null
    });
    await repo.putPublisherToken({
      id: "token-2",
      ownerId: "owner-2",
      tokenHash: await hashSecret("other-token"),
      label: "Other",
      createdAt: fixedNow.toISOString(),
      revokedAt: null
    });
  });

  it("rejects missing and invalid publisher tokens", async () => {
    const app = testApp();

    await request(app).post("/api/artifacts").send(basePayload()).expect(401);
    await request(app).post("/api/artifacts").set("Authorization", "Bearer wrong").send(basePayload()).expect(401);
  });

  it("creates an artifact and stores its HTML privately", async () => {
    const app = testApp();

    const response = await request(app)
      .post("/api/artifacts")
      .set("Authorization", "Bearer publisher-token")
      .send(basePayload())
      .expect(201);

    expect(response.body).toEqual({
      id: "artifact-1",
      slug: "demo",
      title: "Demo",
      url: "http://localhost:8080/a/demo",
      expiresAt: "2026-07-01T00:00:00.000Z",
      passwordProtected: false
    });
    await expect(objectStore.get("artifacts/demo/index.html")).resolves.toBe("<h1>Demo</h1>");
    await expect(repo.getBySlug("demo")).resolves.toMatchObject({
      ownerId: "owner-1",
      objectPath: "artifacts/demo/index.html",
      passwordHash: null
    });
  });

  it("creates an artifact and stores bundled assets privately", async () => {
    const app = testApp();

    await request(app)
      .post("/api/artifacts")
      .set("Authorization", "Bearer publisher-token")
      .send({
        ...basePayload(),
        assets: [
          {
            path: "images/hero.png",
            contentBase64: Buffer.from("png-bytes").toString("base64"),
            contentType: "image/png"
          }
        ]
      })
      .expect(201);

    await expect(objectStore.get("artifacts/demo/assets/images/hero.png")).resolves.toEqual({
      body: Buffer.from("png-bytes"),
      contentType: "image/png"
    });
  });

  it("hashes viewer passwords instead of storing them as plaintext", async () => {
    const app = testApp();

    await request(app)
      .post("/api/artifacts")
      .set("Authorization", "Bearer publisher-token")
      .send({ ...basePayload(), password: "viewer-secret" })
      .expect(201)
      .expect((response) => {
        expect(response.body.passwordProtected).toBe(true);
      });

    const artifact = await repo.getBySlug("demo");
    expect(artifact?.passwordHash).toBeTruthy();
    expect(artifact?.passwordHash).not.toBe("viewer-secret");
  });

  it("rejects duplicate slugs unless upsert is requested", async () => {
    const app = testApp();

    await request(app).post("/api/artifacts").set("Authorization", "Bearer publisher-token").send(basePayload()).expect(201);
    await request(app).post("/api/artifacts").set("Authorization", "Bearer publisher-token").send(basePayload()).expect(409);

    const upsertResponse = await request(app)
      .post("/api/artifacts")
      .set("Authorization", "Bearer publisher-token")
      .send({ ...basePayload(), html: "<h1>Updated</h1>", title: "Updated", upsert: true })
      .expect(200);

    expect(upsertResponse.body).toMatchObject({
      slug: "demo",
      title: "Updated",
      url: "http://localhost:8080/a/demo"
    });
    await expect(objectStore.get("artifacts/demo/index.html")).resolves.toBe("<h1>Updated</h1>");
  });

  it("updates an artifact for the owning publisher", async () => {
    const app = testApp();
    await request(app).post("/api/artifacts").set("Authorization", "Bearer publisher-token").send(basePayload()).expect(201);

    const response = await request(app)
      .put("/api/artifacts/demo")
      .set("Authorization", "Bearer publisher-token")
      .send({
        title: "Updated Demo",
        html: "<h1>Updated Demo</h1>",
        expiresAt: "never",
        password: null
      })
      .expect(200);

    expect(response.body).toMatchObject({
      slug: "demo",
      title: "Updated Demo",
      expiresAt: null,
      passwordProtected: false
    });
    await expect(objectStore.get("artifacts/demo/index.html")).resolves.toBe("<h1>Updated Demo</h1>");
  });

  it("prevents a different publisher from updating or deleting an artifact", async () => {
    const app = testApp();
    await request(app).post("/api/artifacts").set("Authorization", "Bearer publisher-token").send(basePayload()).expect(201);

    await request(app)
      .put("/api/artifacts/demo")
      .set("Authorization", "Bearer other-token")
      .send({ title: "Wrong Owner" })
      .expect(404);

    await request(app).delete("/api/artifacts/demo").set("Authorization", "Bearer other-token").expect(404);
  });

  it("deletes an artifact and its stored HTML", async () => {
    const app = testApp();
    await request(app).post("/api/artifacts").set("Authorization", "Bearer publisher-token").send(basePayload()).expect(201);

    await request(app).delete("/api/artifacts/demo").set("Authorization", "Bearer publisher-token").expect(204);

    await expect(repo.getBySlug("demo")).resolves.toBeNull();
    await expect(objectStore.get("artifacts/demo/index.html")).rejects.toThrow("Object not found");
  });

  it("deletes bundled assets when deleting an artifact", async () => {
    const app = testApp();
    await request(app)
      .post("/api/artifacts")
      .set("Authorization", "Bearer publisher-token")
      .send({
        ...basePayload(),
        assets: [
          {
            path: "demo.mp4",
            contentBase64: Buffer.from("video-bytes").toString("base64"),
            contentType: "video/mp4"
          }
        ]
      })
      .expect(201);

    await request(app).delete("/api/artifacts/demo").set("Authorization", "Bearer publisher-token").expect(204);

    await expect(objectStore.get("artifacts/demo/assets/demo.mp4")).rejects.toThrow("Object not found");
  });

  function testApp() {
    return createApp({
      repo,
      objectStore,
      config,
      now: () => fixedNow
    });
  }
});

function basePayload() {
  return {
    slug: "Demo",
    title: "Demo",
    html: "<h1>Demo</h1>",
    expiresAt: "2026-07-01T00:00:00.000Z"
  };
}
