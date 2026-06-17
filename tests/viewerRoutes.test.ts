import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { hashSecret } from "../src/security/hash";
import { MemoryArtifactRepository } from "../src/storage/artifactRepository";
import { MemoryObjectStore, type ObjectStore } from "../src/storage/objectStore";

describe("viewer routes", () => {
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

  beforeEach(() => {
    repo = new MemoryArtifactRepository({
      now: () => fixedNow,
      idFactory: () => "artifact-1"
    });
    objectStore = new MemoryObjectStore();
  });

  it("renders a public artifact inside a sandboxed iframe", async () => {
    await seedArtifact({ passwordHash: null });
    const app = testApp();

    const shell = await request(app).get("/a/demo").expect(200);
    expect(shell.text).toContain('<iframe src="/a/demo/content"');
    expect(shell.text).toContain('sandbox="allow-scripts allow-forms allow-popups allow-downloads"');

    const content = await request(app).get("/a/demo/content").expect(200);
    expect(content.header["content-type"]).toContain("text/html");
    expect(content.text).toBe("<h1>Demo</h1>");
  });

  it("requires a password session before returning protected content", async () => {
    await seedArtifact({ passwordHash: await hashSecret("viewer-secret") });
    const app = testApp();
    const agent = request.agent(app);

    const shell = await agent.get("/a/demo").expect(200);
    expect(shell.text).toContain("<form");
    expect(shell.text).toContain('name="password"');
    await agent.get("/a/demo/content").expect(401);

    await agent.post("/a/demo/session").type("form").send({ password: "wrong" }).expect(401);
    await agent.post("/a/demo/session").type("form").send({ password: "viewer-secret" }).expect(303);

    const content = await agent.get("/a/demo/content").expect(200);
    expect(content.text).toBe("<h1>Demo</h1>");
  });

  it("serves bundled assets only after the same password session", async () => {
    await seedArtifact({ passwordHash: await hashSecret("viewer-secret") });
    await objectStore.put("artifacts/demo/assets/images/hero.png", Buffer.from("png-bytes"), "image/png");
    const app = testApp();
    const agent = request.agent(app);

    await agent.get("/a/demo/assets/images/hero.png").expect(401);
    await agent.post("/a/demo/session").type("form").send({ password: "viewer-secret" }).expect(303);

    const asset = await agent.get("/a/demo/assets/images/hero.png").expect(200);
    expect(asset.header["content-type"]).toContain("image/png");
    expect(asset.body).toEqual(Buffer.from("png-bytes"));
  });

  it("serves HTML bundled assets as renderable HTML", async () => {
    await seedArtifact({ passwordHash: null });
    const htmlAssetStore: ObjectStore = {
      put: (path, object, contentType) => objectStore.put(path, object, contentType),
      delete: (path) => objectStore.delete(path),
      deletePrefix: (prefix) => objectStore.deletePrefix(prefix),
      get: async (path: string) => {
        if (path === "artifacts/demo/assets/spec.html") {
          return "<!doctype html><html><body><h1>Spec</h1></body></html>";
        }
        return objectStore.get(path);
      }
    };
    const app = createApp({
      repo,
      objectStore: htmlAssetStore,
      config,
      now: () => fixedNow
    });

    const asset = await request(app).get("/a/demo/assets/spec.html").expect(200);
    expect(asset.header["content-type"]).toContain("text/html");
    expect(asset.text).toContain("<h1>Spec</h1>");
  });

  it("serves root-relative bundled HTML pages as renderable HTML", async () => {
    await seedArtifact({ passwordHash: null });
    await objectStore.put(
      "artifacts/demo/assets/speccing.html",
      Buffer.from("<!doctype html><html><body><h1>Speccing</h1></body></html>"),
      "application/octet-stream"
    );
    const app = testApp();

    const sidecar = await request(app).get("/a/demo/speccing.html").expect(200);
    expect(sidecar.header["content-type"]).toContain("text/html");
    expect(sidecar.text).toContain("<h1>Speccing</h1>");
  });

  it("does not serve bundled assets after expiry", async () => {
    await seedArtifact({
      passwordHash: null,
      expiresAt: "2026-06-17T00:00:00.000Z"
    });
    await objectStore.put("artifacts/demo/assets/demo.mp4", Buffer.from("video-bytes"), "video/mp4");
    const app = testApp();

    await request(app).get("/a/demo/assets/demo.mp4").expect(410);
  });

  it("does not return expired artifact content", async () => {
    await seedArtifact({
      passwordHash: null,
      expiresAt: "2026-06-17T00:00:00.000Z"
    });
    const app = testApp();

    const shell = await request(app).get("/a/demo").expect(410);
    expect(shell.text).toContain("This link has expired");
    await request(app).get("/a/demo/content").expect(410);
  });

  it("does not return deleted or missing artifacts", async () => {
    await seedArtifact({ passwordHash: null });
    await repo.markDeletedBySlug("demo", "owner-1");
    const app = testApp();

    await request(app).get("/a/demo").expect(404);
    await request(app).get("/a/missing").expect(404);
    await request(app).get("/a/demo/content").expect(404);
  });

  async function seedArtifact({
    passwordHash,
    expiresAt = "2026-07-01T00:00:00.000Z"
  }: {
    passwordHash: string | null;
    expiresAt?: string | null;
  }) {
    await repo.create({
      slug: "demo",
      title: "Demo",
      ownerId: "owner-1",
      objectPath: "artifacts/demo/index.html",
      passwordHash,
      expiresAt
    });
    await objectStore.put("artifacts/demo/index.html", "<h1>Demo</h1>");
  }

  function testApp() {
    return createApp({
      repo,
      objectStore,
      config,
      now: () => fixedNow
    });
  }
});
