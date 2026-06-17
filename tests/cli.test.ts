import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildArtifactPayload,
  parseCliArgs,
  readApiConfig,
  readAssetsFromDirectory,
  type ParsedCliCommand
} from "../src/cli/klovrShare";

describe("parseCliArgs", () => {
  it("parses publish commands", () => {
    expect(
      parseCliArgs([
        "publish",
        "artifact.html",
        "--slug",
        "demo",
        "--title",
        "Demo",
        "--expires-in",
        "7d",
        "--password",
        "viewer-secret",
        "--upsert"
      ])
    ).toEqual({
      command: "publish",
      file: "artifact.html",
      slug: "demo",
      title: "Demo",
      expiresIn: "7d",
      password: "viewer-secret",
      assetsDir: undefined,
      upsert: true
    } satisfies ParsedCliCommand);
  });

  it("parses update commands", () => {
    expect(
      parseCliArgs(["update", "artifact.html", "--slug", "demo", "--expires-at", "2026-07-01T00:00:00.000Z"])
    ).toEqual({
      command: "update",
      file: "artifact.html",
      slug: "demo",
      expiresAt: "2026-07-01T00:00:00.000Z",
      assetsDir: undefined
    } satisfies ParsedCliCommand);
  });

  it("parses asset directory flags", () => {
    expect(parseCliArgs(["publish", "artifact.html", "--slug", "demo", "--assets-dir", "artifact-assets"])).toEqual({
      command: "publish",
      file: "artifact.html",
      slug: "demo",
      title: undefined,
      expiresIn: undefined,
      expiresAt: undefined,
      password: undefined,
      assetsDir: "artifact-assets",
      upsert: undefined
    } satisfies ParsedCliCommand);
  });

  it("parses delete commands", () => {
    expect(parseCliArgs(["delete", "--slug", "demo"])).toEqual({
      command: "delete",
      slug: "demo"
    } satisfies ParsedCliCommand);
  });

  it("rejects missing required options", () => {
    expect(() => parseCliArgs(["publish", "artifact.html"])).toThrow("Missing required option --slug");
    expect(() => parseCliArgs(["delete"])).toThrow("Missing required option --slug");
  });
});

describe("buildArtifactPayload", () => {
  const now = new Date("2026-06-18T00:00:00.000Z");

  it("builds a publish payload with relative expiry", () => {
    expect(
      buildArtifactPayload(
        {
          command: "publish",
          file: "artifact.html",
          slug: "demo",
          title: "Demo",
          expiresIn: "7d",
          password: "viewer-secret",
          upsert: true
        },
        "<h1>Demo</h1>",
        now
      )
    ).toEqual({
      slug: "demo",
      title: "Demo",
      html: "<h1>Demo</h1>",
      password: "viewer-secret",
      expiresAt: "2026-06-25T00:00:00.000Z",
      upsert: true
    });
  });

  it("builds an update payload that can clear password protection", () => {
    expect(
      buildArtifactPayload(
        {
          command: "update",
          file: "artifact.html",
          slug: "demo",
          title: "Updated",
          clearPassword: true,
          expiresAt: "never"
        },
        "<h1>Updated</h1>",
        now
      )
    ).toEqual({
      title: "Updated",
      html: "<h1>Updated</h1>",
      password: null,
      expiresAt: null
    });
  });
});

describe("readAssetsFromDirectory", () => {
  it("reads nested files as base64 asset payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "klovr-assets-"));
    await mkdir(join(directory, "images"));
    await writeFile(join(directory, "images", "hero.png"), Buffer.from("png-bytes"));
    await writeFile(join(directory, "spec.html"), Buffer.from("<h1>Spec</h1>"));

    await expect(readAssetsFromDirectory(directory)).resolves.toEqual([
      {
        path: "images/hero.png",
        contentBase64: Buffer.from("png-bytes").toString("base64"),
        contentType: "image/png"
      },
      {
        path: "spec.html",
        contentBase64: Buffer.from("<h1>Spec</h1>").toString("base64"),
        contentType: "text/html; charset=utf-8"
      }
    ]);
  });
});

describe("readApiConfig", () => {
  it("reads API URL and token from environment", () => {
    expect(
      readApiConfig({
        KLOVR_SHARE_API_URL: "https://share.example.com",
        KLOVR_SHARE_TOKEN: "secret"
      })
    ).toEqual({
      apiUrl: "https://share.example.com",
      token: "secret"
    });
  });

  it("rejects missing API config", () => {
    expect(() => readApiConfig({ KLOVR_SHARE_TOKEN: "secret" })).toThrow("KLOVR_SHARE_API_URL is required");
    expect(() => readApiConfig({ KLOVR_SHARE_API_URL: "https://share.example.com" })).toThrow(
      "KLOVR_SHARE_TOKEN is required"
    );
  });
});
