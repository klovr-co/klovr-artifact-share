import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { MemoryArtifactRepository } from "../src/storage/artifactRepository";
import { MemoryObjectStore } from "../src/storage/objectStore";

describe("createApp", () => {
  it("serves a health check", async () => {
    const app = createApp({
      repo: new MemoryArtifactRepository(),
      objectStore: new MemoryObjectStore(),
      config: {
        appBaseUrl: "http://localhost:8080",
        dataBackend: "memory",
        maxHtmlBytes: 1024,
        nodeEnv: "test",
        port: 8080,
        sessionSecret: "test-secret"
      }
    });

    const response = await request(app).get("/healthz").expect(200);

    expect(response.body).toEqual({ ok: true });
  });
});
