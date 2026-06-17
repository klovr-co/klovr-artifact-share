import { describe, expect, it } from "vitest";
import {
  ArtifactConflictError,
  ArtifactNotFoundError,
  MemoryArtifactRepository
} from "../src/storage/artifactRepository";
import { MemoryObjectStore, ObjectNotFoundError } from "../src/storage/objectStore";

describe("MemoryArtifactRepository", () => {
  const fixedNow = new Date("2026-06-18T00:00:00.000Z");

  it("creates and reads artifacts by slug", async () => {
    const repo = new MemoryArtifactRepository({
      now: () => fixedNow,
      idFactory: () => "artifact-1"
    });

    const artifact = await repo.create({
      slug: "demo",
      title: "Demo",
      ownerId: "owner-1",
      objectPath: "artifacts/demo/index.html",
      passwordHash: null,
      expiresAt: null
    });

    expect(artifact).toMatchObject({
      id: "artifact-1",
      slug: "demo",
      title: "Demo",
      ownerId: "owner-1",
      objectPath: "artifacts/demo/index.html",
      passwordHash: null,
      expiresAt: null,
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      deletedAt: null
    });
    await expect(repo.getBySlug("demo")).resolves.toEqual(artifact);
  });

  it("rejects duplicate active slugs", async () => {
    const repo = new MemoryArtifactRepository({ now: () => fixedNow });
    await repo.create(baseArtifactInput({ slug: "demo" }));

    await expect(repo.create(baseArtifactInput({ slug: "demo" }))).rejects.toBeInstanceOf(ArtifactConflictError);
  });

  it("updates an artifact only for the owning publisher", async () => {
    const repo = new MemoryArtifactRepository({ now: () => fixedNow });
    await repo.create(baseArtifactInput({ slug: "demo", ownerId: "owner-1" }));

    await expect(
      repo.updateBySlug("demo", "owner-2", {
        title: "Wrong Owner"
      })
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);

    const updated = await repo.updateBySlug("demo", "owner-1", {
      title: "Updated",
      objectPath: "artifacts/demo/v2.html",
      passwordHash: "hash",
      expiresAt: "2026-07-01T00:00:00.000Z"
    });

    expect(updated).toMatchObject({
      slug: "demo",
      title: "Updated",
      objectPath: "artifacts/demo/v2.html",
      passwordHash: "hash",
      expiresAt: "2026-07-01T00:00:00.000Z",
      deletedAt: null
    });
  });

  it("marks artifacts deleted and hides them from normal lookup", async () => {
    const repo = new MemoryArtifactRepository({ now: () => fixedNow });
    await repo.create(baseArtifactInput({ slug: "demo", ownerId: "owner-1" }));

    const deleted = await repo.markDeletedBySlug("demo", "owner-1");

    expect(deleted.deletedAt).toBe("2026-06-18T00:00:00.000Z");
    await expect(repo.getBySlug("demo")).resolves.toBeNull();
    await expect(repo.markDeletedBySlug("demo", "owner-1")).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it("lists active expired artifacts by cutoff and limit", async () => {
    const repo = new MemoryArtifactRepository({ now: () => fixedNow });
    await repo.create(baseArtifactInput({ slug: "oldest", expiresAt: "2026-06-16T00:00:00.000Z" }));
    await repo.create(baseArtifactInput({ slug: "older", expiresAt: "2026-06-17T00:00:00.000Z" }));
    await repo.create(baseArtifactInput({ slug: "future", expiresAt: "2026-06-19T00:00:00.000Z" }));
    await repo.create(baseArtifactInput({ slug: "never", expiresAt: null }));
    await repo.create(baseArtifactInput({ slug: "deleted", expiresAt: "2026-06-15T00:00:00.000Z" }));
    await repo.markDeletedBySlug("deleted", "owner-1");

    const expired = await repo.listExpiredArtifacts("2026-06-18T00:00:00.000Z", 1);

    expect(expired.map((artifact) => artifact.slug)).toEqual(["oldest"]);
  });

  it("stores and finds active publisher tokens by hash", async () => {
    const repo = new MemoryArtifactRepository({ now: () => fixedNow });
    await repo.putPublisherToken({
      id: "token-1",
      ownerId: "owner-1",
      tokenHash: "hashed-token",
      label: "Example Publisher",
      createdAt: "2026-06-18T00:00:00.000Z",
      revokedAt: null
    });
    await repo.putPublisherToken({
      id: "token-2",
      ownerId: "owner-2",
      tokenHash: "revoked-token",
      label: "Revoked",
      createdAt: "2026-06-18T00:00:00.000Z",
      revokedAt: "2026-06-18T00:00:00.000Z"
    });

    await expect(repo.findActivePublisherTokenByHash("hashed-token")).resolves.toMatchObject({
      ownerId: "owner-1",
      label: "Example Publisher"
    });
    await expect(repo.findActivePublisherTokenByHash("revoked-token")).resolves.toBeNull();
    await expect(repo.findActivePublisherTokenByHash("missing-token")).resolves.toBeNull();
  });
});

describe("MemoryObjectStore", () => {
  it("puts, reads, and deletes HTML objects", async () => {
    const store = new MemoryObjectStore();

    await store.put("artifacts/demo/index.html", "<h1>Demo</h1>");
    await expect(store.get("artifacts/demo/index.html")).resolves.toBe("<h1>Demo</h1>");

    await store.delete("artifacts/demo/index.html");
    await expect(store.get("artifacts/demo/index.html")).rejects.toBeInstanceOf(ObjectNotFoundError);
  });
});

function baseArtifactInput(overrides: {
  slug?: string;
  title?: string;
  ownerId?: string;
  objectPath?: string;
  passwordHash?: string | null;
  expiresAt?: string | null;
}) {
  const slug = overrides.slug ?? "demo";
  return {
    slug,
    title: overrides.title ?? "Demo",
    ownerId: overrides.ownerId ?? "owner-1",
    objectPath: overrides.objectPath ?? `artifacts/${slug}/index.html`,
    passwordHash: overrides.passwordHash ?? null,
    expiresAt: overrides.expiresAt ?? null
  };
}
