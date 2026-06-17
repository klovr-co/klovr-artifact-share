import { describe, expect, it } from "vitest";
import type { Artifact, PublisherToken } from "../src/domain/types";
import {
  artifactFromFirestoreData,
  artifactToFirestoreData,
  publisherTokenFromFirestoreData,
  publisherTokenToFirestoreData
} from "../src/storage/gcpArtifactRepository";

describe("Firestore artifact mapping", () => {
  it("round-trips artifact metadata", () => {
    const artifact: Artifact = {
      id: "artifact-1",
      slug: "demo",
      title: "Demo",
      ownerId: "owner-1",
      objectPath: "artifacts/demo/index.html",
      passwordHash: "password-hash",
      expiresAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T01:00:00.000Z",
      deletedAt: null
    };

    const data = artifactToFirestoreData(artifact);

    expect(data).toEqual({
      id: "artifact-1",
      slug: "demo",
      title: "Demo",
      ownerId: "owner-1",
      objectPath: "artifacts/demo/index.html",
      passwordHash: "password-hash",
      expiresAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T01:00:00.000Z",
      deletedAt: null
    });
    expect(artifactFromFirestoreData(data)).toEqual(artifact);
  });

  it("round-trips publisher tokens", () => {
    const token: PublisherToken = {
      id: "token-1",
      ownerId: "owner-1",
      tokenHash: "hash",
      label: "Example Publisher",
      createdAt: "2026-06-18T00:00:00.000Z",
      revokedAt: null
    };

    const data = publisherTokenToFirestoreData(token);

    expect(data).toEqual({
      id: "token-1",
      ownerId: "owner-1",
      tokenHash: "hash",
      label: "Example Publisher",
      createdAt: "2026-06-18T00:00:00.000Z",
      revokedAt: null
    });
    expect(publisherTokenFromFirestoreData(data)).toEqual(token);
  });
});
