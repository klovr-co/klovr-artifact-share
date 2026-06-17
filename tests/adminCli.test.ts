import { describe, expect, it } from "vitest";
import { buildPublisherToken, parseAdminArgs } from "../src/cli/admin";

describe("admin CLI", () => {
  it("parses publisher token generation arguments", () => {
    expect(
      parseAdminArgs(["generate-token", "--owner-id", "owner-1", "--label", "Example Publisher", "--token", "known-token"])
    ).toEqual({
      command: "generate-token",
      ownerId: "owner-1",
      label: "Example Publisher",
      token: "known-token",
      writeFirestore: false
    });

    expect(
      parseAdminArgs(["generate-token", "--owner-id", "owner-1", "--label", "Example Publisher", "--write-firestore"])
    ).toMatchObject({
      command: "generate-token",
      ownerId: "owner-1",
      label: "Example Publisher",
      writeFirestore: true
    });
  });

  it("requires owner id and label", () => {
    expect(() => parseAdminArgs(["generate-token", "--owner-id", "owner-1"])).toThrow(
      "Missing required option --label"
    );
    expect(() => parseAdminArgs(["unknown"])).toThrow("Usage: klovr-admin generate-token");
  });

  it("builds a publisher token record and exposes the raw token once", async () => {
    const result = await buildPublisherToken(
      {
        command: "generate-token",
        ownerId: "owner-1",
        label: "Example Publisher",
        writeFirestore: false
      },
      {
        now: () => new Date("2026-06-18T00:00:00.000Z"),
        idFactory: () => "token-id",
        tokenFactory: () => "generated-token",
        hashSecret: async (token) => `hash:${token}`
      }
    );

    expect(result).toEqual({
      token: "generated-token",
      documentPath: "publisherTokens/token-id",
      record: {
        id: "token-id",
        ownerId: "owner-1",
        tokenHash: "hash:generated-token",
        label: "Example Publisher",
        createdAt: "2026-06-18T00:00:00.000Z",
        revokedAt: null
      }
    });
  });
});
