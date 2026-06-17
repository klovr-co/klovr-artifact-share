import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = "skills/klovr-share/scripts/klovr_share.py";
const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("klovr_share.py", () => {
  it("prints help", () => {
    const result = runPythonSync([scriptPath, "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("publish");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("delete");
  }, 15000);

  it("requires API credentials", async () => {
    const file = await sampleHtmlFile();
    const result = runPythonSync([scriptPath, "publish", file, "--slug", "demo"], {
      env: {}
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("KLOVR_SHARE_API_URL is required");
  }, 15000);

  it("publishes HTML through the API", async () => {
    const requests: CapturedRequest[] = [];
    const { url } = await startJsonServer(requests, { url: "http://localhost:8080/a/demo" });
    const file = await sampleHtmlFile();

    const result = await runPython(
      [
        scriptPath,
        "publish",
        file,
        "--slug",
        "demo",
        "--title",
        "Demo",
        "--expires-at",
        "2026-07-01T00:00:00.000Z",
        "--password",
        "viewer-secret",
        "--upsert"
      ],
      {
        KLOVR_SHARE_API_URL: url,
        KLOVR_SHARE_TOKEN: "publisher-token"
      }
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("http://localhost:8080/a/demo");
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/artifacts",
        authorization: "Bearer publisher-token",
        body: {
          slug: "demo",
          title: "Demo",
          html: "<h1>Demo</h1>",
          expiresAt: "2026-07-01T00:00:00.000Z",
          password: "viewer-secret",
          upsert: true
        }
      }
    ]);
  });

  it("publishes bundled assets through the API", async () => {
    const requests: CapturedRequest[] = [];
    const { url } = await startJsonServer(requests, { url: "http://localhost:8080/a/demo" });
    const file = await sampleHtmlFile();
    const assetsDir = await mkdtemp(join(tmpdir(), "klovr-share-assets-"));
    await mkdir(join(assetsDir, "images"));
    await writeFile(join(assetsDir, "images", "hero.png"), Buffer.from("png-bytes"));

    const result = await runPython([scriptPath, "publish", file, "--slug", "demo", "--assets-dir", assetsDir], {
      KLOVR_SHARE_API_URL: url,
      KLOVR_SHARE_TOKEN: "publisher-token"
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(requests[0]?.body).toMatchObject({
      slug: "demo",
      assets: [
        {
          path: "images/hero.png",
          contentBase64: Buffer.from("png-bytes").toString("base64"),
          contentType: "image/png"
        }
      ]
    });
  });

  it("deletes artifacts through the API", async () => {
    const requests: CapturedRequest[] = [];
    const { url } = await startJsonServer(requests, {});

    const result = await runPython([scriptPath, "delete", "--slug", "demo"], {
      KLOVR_SHARE_API_URL: url,
      KLOVR_SHARE_TOKEN: "publisher-token"
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(requests).toEqual([
      {
        method: "DELETE",
        path: "/api/artifacts/demo",
        authorization: "Bearer publisher-token",
        body: null
      }
    ]);
  });
});

type CapturedRequest = {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
};

type PythonResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runPythonSync(args: string[], options: { env?: Record<string, string> } = {}): PythonResult {
  const result = spawnSync("python3", args, {
    encoding: "utf8",
    timeout: 10000,
    ...options
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

async function runPython(args: string[], env: Record<string, string>): Promise<PythonResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function sampleHtmlFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "klovr-share-"));
  const file = join(dir, "artifact.html");
  await writeFile(file, "<h1>Demo</h1>", "utf8");
  return file;
}

async function startJsonServer(requests: CapturedRequest[], responseBody: unknown): Promise<{ url: string }> {
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization,
      body: request.method === "DELETE" ? null : JSON.parse(await readBody(request))
    });
    response.statusCode = request.method === "DELETE" ? 204 : 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(responseBody));
  });
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start test server");
  }
  return { url: `http://127.0.0.1:${address.port}` };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
