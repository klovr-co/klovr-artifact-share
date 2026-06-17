import { describe, expect, it } from "vitest";
import { signArtifactSession, verifyArtifactSession } from "../src/security/session";

describe("artifact session tokens", () => {
  const secret = "test-session-secret";
  const now = new Date("2026-06-18T00:00:00.000Z");

  it("verifies a token for the matching slug", () => {
    const token = signArtifactSession({ slug: "demo", secret, now, ttlSeconds: 60 });

    expect(verifyArtifactSession({ token, slug: "demo", secret, now })).toEqual({
      valid: true,
      slug: "demo"
    });
  });

  it("rejects a token for a different slug", () => {
    const token = signArtifactSession({ slug: "demo", secret, now, ttlSeconds: 60 });

    expect(verifyArtifactSession({ token, slug: "other", secret, now })).toEqual({
      valid: false,
      reason: "slug-mismatch"
    });
  });

  it("rejects expired tokens", () => {
    const token = signArtifactSession({ slug: "demo", secret, now, ttlSeconds: 60 });
    const later = new Date("2026-06-18T00:01:00.001Z");

    expect(verifyArtifactSession({ token, slug: "demo", secret, now: later })).toEqual({
      valid: false,
      reason: "expired"
    });
  });

  it("rejects tokens signed with a different secret", () => {
    const token = signArtifactSession({ slug: "demo", secret, now, ttlSeconds: 60 });

    expect(verifyArtifactSession({ token, slug: "demo", secret: "wrong-secret", now })).toEqual({
      valid: false,
      reason: "invalid-signature"
    });
  });

  it("rejects malformed tokens", () => {
    expect(verifyArtifactSession({ token: "not-a-token", slug: "demo", secret, now })).toEqual({
      valid: false,
      reason: "malformed"
    });
  });
});
