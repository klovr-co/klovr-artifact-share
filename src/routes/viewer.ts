import type { Express, Request, Response } from "express";
import type { AppConfig } from "../config";
import { isExpired } from "../domain/time";
import type { Artifact } from "../domain/types";
import { verifySecret } from "../security/hash";
import { signArtifactSession, verifyArtifactSession } from "../security/session";
import type { ArtifactRepository } from "../storage/artifactRepository";
import { ObjectNotFoundError, type ObjectStore } from "../storage/objectStore";

type ViewerRouteDependencies = {
  repo: ArtifactRepository;
  objectStore: ObjectStore;
  config: AppConfig;
  now: () => Date;
};

const VIEWER_SESSION_TTL_SECONDS = 60 * 60;

export function registerViewerRoutes(app: Express, dependencies: ViewerRouteDependencies): void {
  app.get("/a/:slug", async (request, response) => {
    const artifact = await resolveVisibleArtifact(request.params.slug, response, dependencies);
    if (!artifact) {
      return;
    }

    if (artifact.passwordHash && !hasValidSession(request, artifact.slug, dependencies)) {
      response.status(200).type("html").send(passwordPage(artifact));
      return;
    }

    response.status(200).type("html").send(shellPage(artifact));
  });

  app.post("/a/:slug/session", async (request, response) => {
    const artifact = await resolveVisibleArtifact(request.params.slug, response, dependencies);
    if (!artifact) {
      return;
    }

    if (!artifact.passwordHash) {
      response.redirect(303, `/a/${artifact.slug}`);
      return;
    }

    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!(await verifySecret(password, artifact.passwordHash))) {
      response.status(401).type("html").send(passwordPage(artifact, "Invalid password"));
      return;
    }

    response.cookie(cookieName(artifact.slug), signArtifactSession({
      slug: artifact.slug,
      secret: dependencies.config.sessionSecret,
      now: dependencies.now(),
      ttlSeconds: VIEWER_SESSION_TTL_SECONDS
    }), {
      httpOnly: true,
      maxAge: VIEWER_SESSION_TTL_SECONDS * 1000,
      path: `/a/${artifact.slug}`,
      sameSite: "lax",
      secure: dependencies.config.nodeEnv === "production"
    });
    response.redirect(303, `/a/${artifact.slug}`);
  });

  app.get("/a/:slug/content", async (request, response) => {
    const artifact = await resolveVisibleArtifact(request.params.slug, response, dependencies);
    if (!artifact) {
      return;
    }

    if (artifact.passwordHash && !hasValidSession(request, artifact.slug, dependencies)) {
      response.status(401).type("text").send("Password required");
      return;
    }

    try {
      const html = await dependencies.objectStore.get(artifact.objectPath);
      if (typeof html !== "string") {
        response.status(404).type("html").send(statusPage("Not found", "Artifact content could not be found."));
        return;
      }
      response.status(200).type("html").send(html);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        response.status(404).type("html").send(statusPage("Not found", "Artifact content could not be found."));
        return;
      }
      throw error;
    }
  });

  app.get(/^\/a\/([^/]+)\/assets\/(.+)$/, async (request, response) => {
    const slug = request.params[0];
    const assetPath = normalizeAssetPath(request.params[1] ?? "");
    if (!assetPath) {
      response.status(404).type("html").send(statusPage("Not found", "Artifact asset could not be found."));
      return;
    }

    const artifact = await resolveVisibleArtifact(slug, response, dependencies);
    if (!artifact) {
      return;
    }

    if (artifact.passwordHash && !hasValidSession(request, artifact.slug, dependencies)) {
      response.status(401).type("text").send("Password required");
      return;
    }

    try {
      const object = await dependencies.objectStore.get(`artifacts/${artifact.slug}/assets/${assetPath}`);
      sendStoredObject(response, object, assetPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        response.status(404).type("html").send(statusPage("Not found", "Artifact asset could not be found."));
        return;
      }
      throw error;
    }
  });

  app.get(/^\/a\/([^/]+)\/(.+)$/, async (request, response) => {
    const slug = request.params[0];
    const assetPath = normalizeAssetPath(request.params[1] ?? "");
    if (!assetPath) {
      response.status(404).type("html").send(statusPage("Not found", "Artifact asset could not be found."));
      return;
    }

    const artifact = await resolveVisibleArtifact(slug, response, dependencies);
    if (!artifact) {
      return;
    }

    if (artifact.passwordHash && !hasValidSession(request, artifact.slug, dependencies)) {
      response.status(401).type("text").send("Password required");
      return;
    }

    try {
      const object = await dependencies.objectStore.get(`artifacts/${artifact.slug}/assets/${assetPath}`);
      sendStoredObject(response, object, assetPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        response.status(404).type("html").send(statusPage("Not found", "Artifact asset could not be found."));
        return;
      }
      throw error;
    }
  });
}

async function resolveVisibleArtifact(
  slug: string,
  response: Response,
  dependencies: ViewerRouteDependencies
): Promise<Artifact | null> {
  const artifact = await dependencies.repo.getBySlug(slug);
  if (!artifact) {
    response.status(404).type("html").send(statusPage("Not found", "This shared artifact does not exist."));
    return null;
  }

  if (isExpired(artifact.expiresAt, dependencies.now())) {
    response.status(410).type("html").send(statusPage("This link has expired", "Ask the publisher for a fresh link."));
    return null;
  }

  return artifact;
}

function hasValidSession(request: Request, slug: string, dependencies: ViewerRouteDependencies): boolean {
  const token = request.cookies?.[cookieName(slug)] as string | undefined;
  return verifyArtifactSession({
    token,
    slug,
    secret: dependencies.config.sessionSecret,
    now: dependencies.now()
  }).valid;
}

function cookieName(slug: string): string {
  return `klovr_artifact_${slug}`;
}

function sendStoredObject(response: Response, object: Awaited<ReturnType<ObjectStore["get"]>>, path: string): void {
  if (typeof object === "string") {
    response.status(200).type("html").send(object);
    return;
  }

  if (path.toLowerCase().endsWith(".html") || path.toLowerCase().endsWith(".htm")) {
    response.status(200).type("html").send(object.body.toString("utf8"));
    return;
  }

  response.status(200).type(object.contentType).send(object.body);
}

function shellPage(artifact: Artifact): string {
  const title = escapeHtml(artifact.title);
  const slug = encodeURIComponent(artifact.slug);
  return pageLayout(
    title,
    `<main class="viewer">
      <iframe src="/a/${slug}/content" title="${title}" sandbox="allow-scripts allow-forms allow-popups allow-downloads"></iframe>
    </main>`
  );
}

function passwordPage(artifact: Artifact, error?: string): string {
  const title = escapeHtml(artifact.title);
  const slug = encodeURIComponent(artifact.slug);
  const errorMarkup = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return pageLayout(
    `Password required for ${title}`,
    `<main class="gate">
      <section>
        <p class="brand">Klovr Share</p>
        <h1>${title}</h1>
        <p>This artifact is password protected.</p>
        ${errorMarkup}
        <form action="/a/${slug}/session" method="post">
          <label>
            <span>Password</span>
            <input type="password" name="password" autocomplete="current-password" autofocus />
          </label>
          <button type="submit">Open artifact</button>
        </form>
      </section>
    </main>`
  );
}

function statusPage(title: string, message: string): string {
  return pageLayout(
    title,
    `<main class="gate">
      <section>
        <p class="brand">Klovr Share</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </section>
    </main>`
  );
}

function pageLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; color: #111827; background: #f8fafc; -webkit-font-smoothing: antialiased; }
      .viewer { min-height: 100vh; }
      iframe { display: block; width: 100%; min-height: 100vh; border: 0; background: white; }
      .gate { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { width: min(100%, 420px); border-radius: 12px; background: white; padding: 28px; box-shadow: 0 18px 60px rgba(15, 23, 42, 0.14); }
      .brand { margin: 0 0 14px; color: #2563eb; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
      h1 { margin: 0; font-size: 24px; line-height: 1.2; text-wrap: balance; }
      p { color: #4b5563; line-height: 1.5; }
      form { display: grid; gap: 16px; margin-top: 20px; }
      label { display: grid; gap: 8px; font-size: 14px; font-weight: 600; }
      input { min-height: 44px; border-radius: 8px; border: 1px solid #cbd5e1; padding: 0 12px; font: inherit; }
      button { min-height: 44px; border: 0; border-radius: 8px; background: #111827; color: white; font: inherit; font-weight: 700; cursor: pointer; transition: transform 140ms ease, opacity 140ms ease; }
      button:active { transform: scale(0.96); }
      .error { color: #b91c1c; font-weight: 600; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeAssetPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean).join("/");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }
  return normalized;
}
