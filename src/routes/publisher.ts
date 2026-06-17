import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config";
import { parseExpiry, toIsoString } from "../domain/time";
import type { Artifact, PublisherToken } from "../domain/types";
import { hashSecret, verifySecret } from "../security/hash";
import {
  ArtifactConflictError,
  ArtifactNotFoundError,
  type ArtifactRepository,
  type ArtifactUpdateRecord
} from "../storage/artifactRepository";
import type { ObjectStore } from "../storage/objectStore";

type PublisherRouteDependencies = {
  repo: ArtifactRepository;
  objectStore: ObjectStore;
  config: AppConfig;
  now: () => Date;
};

const createArtifactSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  html: z.string().min(1),
  assets: z.array(z.object({
    path: z.string().min(1),
    contentBase64: z.string().min(1),
    contentType: z.string().min(1)
  })).optional(),
  password: z.string().min(1).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  upsert: z.boolean().optional()
});

const updateArtifactSchema = z.object({
  title: z.string().min(1).optional(),
  html: z.string().min(1).optional(),
  assets: z.array(z.object({
    path: z.string().min(1),
    contentBase64: z.string().min(1),
    contentType: z.string().min(1)
  })).optional(),
  password: z.string().min(1).nullable().optional(),
  expiresAt: z.string().nullable().optional()
});

export function registerPublisherRoutes(app: Express, dependencies: PublisherRouteDependencies): void {
  app.post("/api/artifacts", async (request, response) => {
    const publisher = await authenticatePublisher(request, dependencies.repo);
    if (!publisher) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = createArtifactSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid artifact payload" });
      return;
    }

    const slug = normalizeSlug(parsed.data.slug);
    if (!slug) {
      response.status(400).json({ error: "Invalid slug" });
      return;
    }

    const objectPath = objectPathForSlug(slug);
    const passwordHash = parsed.data.password ? await hashSecret(parsed.data.password) : null;
    const expiresAt = toIsoString(parseExpiry(parsed.data.expiresAt ?? undefined, dependencies.now()));

    try {
      const artifact = await dependencies.repo.create({
        slug,
        title: parsed.data.title,
        ownerId: publisher.ownerId,
        objectPath,
        passwordHash,
        expiresAt
      });
      await dependencies.objectStore.put(objectPath, parsed.data.html);
      await storeAssets(dependencies.objectStore, slug, parsed.data.assets);
      response.status(201).json(toArtifactResponse(artifact, dependencies.config));
    } catch (error) {
      if (error instanceof ArtifactConflictError && parsed.data.upsert) {
        await handleUpsert({ request, response, dependencies, publisher, slug, objectPath, passwordHash, expiresAt });
        return;
      }
      if (error instanceof ArtifactConflictError) {
        response.status(409).json({ error: "Artifact slug already exists" });
        return;
      }
      throw error;
    }
  });

  app.get("/api/artifacts/:slug", async (request, response) => {
    const publisher = await authenticatePublisher(request, dependencies.repo);
    if (!publisher) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const artifact = await dependencies.repo.getBySlug(normalizeSlug(request.params.slug));
    if (!artifact || artifact.ownerId !== publisher.ownerId) {
      response.status(404).json({ error: "Artifact not found" });
      return;
    }

    response.json(toArtifactResponse(artifact, dependencies.config));
  });

  app.put("/api/artifacts/:slug", async (request, response) => {
    const publisher = await authenticatePublisher(request, dependencies.repo);
    if (!publisher) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = updateArtifactSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid artifact payload" });
      return;
    }

    const slug = normalizeSlug(request.params.slug);
    const updates = await buildUpdateRecord(parsed.data, dependencies.now);

    if (parsed.data.html !== undefined) {
      updates.objectPath = objectPathForSlug(slug);
    }

    try {
      const artifact = await dependencies.repo.updateBySlug(slug, publisher.ownerId, updates);
      if (parsed.data.html !== undefined) {
        await dependencies.objectStore.put(artifact.objectPath, parsed.data.html);
      }
      if (parsed.data.assets !== undefined) {
        await dependencies.objectStore.deletePrefix(assetPrefixForSlug(slug));
        await storeAssets(dependencies.objectStore, slug, parsed.data.assets);
      }
      response.json(toArtifactResponse(artifact, dependencies.config));
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) {
        response.status(404).json({ error: "Artifact not found" });
        return;
      }
      throw error;
    }
  });

  app.delete("/api/artifacts/:slug", async (request, response) => {
    const publisher = await authenticatePublisher(request, dependencies.repo);
    if (!publisher) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    const slug = normalizeSlug(request.params.slug);
    try {
      const artifact = await dependencies.repo.markDeletedBySlug(slug, publisher.ownerId);
      await dependencies.objectStore.delete(artifact.objectPath);
      await dependencies.objectStore.deletePrefix(assetPrefixForSlug(slug));
      response.status(204).send();
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) {
        response.status(404).json({ error: "Artifact not found" });
        return;
      }
      throw error;
    }
  });
}

async function handleUpsert({
  response,
  dependencies,
  publisher,
  slug,
  objectPath,
  passwordHash,
  expiresAt,
  request
}: {
  request: Request;
  response: Response;
  dependencies: PublisherRouteDependencies;
  publisher: PublisherToken;
  slug: string;
  objectPath: string;
  passwordHash: string | null;
  expiresAt: string | null;
}) {
  const body = createArtifactSchema.parse(request.body);
  try {
    const artifact = await dependencies.repo.updateBySlug(slug, publisher.ownerId, {
      title: body.title,
      objectPath,
      passwordHash,
      expiresAt
    });
    await dependencies.objectStore.put(objectPath, body.html);
    await dependencies.objectStore.deletePrefix(assetPrefixForSlug(slug));
    await storeAssets(dependencies.objectStore, slug, body.assets);
    response.status(200).json(toArtifactResponse(artifact, dependencies.config));
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      response.status(404).json({ error: "Artifact not found" });
      return;
    }
    throw error;
  }
}

async function buildUpdateRecord(
  body: z.infer<typeof updateArtifactSchema>,
  now: () => Date
): Promise<ArtifactUpdateRecord> {
  const updates: ArtifactUpdateRecord = {};
  if (body.title !== undefined) {
    updates.title = body.title;
  }
  if (Object.prototype.hasOwnProperty.call(body, "password")) {
    updates.passwordHash = body.password ? await hashSecret(body.password) : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) {
    updates.expiresAt = toIsoString(parseExpiry(body.expiresAt ?? undefined, now()));
  }
  return updates;
}

async function authenticatePublisher(request: Request, repo: ArtifactRepository): Promise<PublisherToken | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  const publisherTokens = await repo.listActivePublisherTokens();
  for (const publisherToken of publisherTokens) {
    if (await verifySecret(token, publisherToken.tokenHash)) {
      return publisherToken;
    }
  }
  return null;
}

function bearerToken(request: Request): string | null {
  const header = request.header("authorization");
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

function normalizeSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function objectPathForSlug(slug: string): string {
  return `artifacts/${slug}/index.html`;
}

function assetPrefixForSlug(slug: string): string {
  return `artifacts/${slug}/assets/`;
}

async function storeAssets(
  objectStore: ObjectStore,
  slug: string,
  assets: Array<{ path: string; contentBase64: string; contentType: string }> | undefined
): Promise<void> {
  if (!assets?.length) {
    return;
  }
  for (const asset of assets) {
    const path = normalizeAssetPath(asset.path);
    await objectStore.put(`${assetPrefixForSlug(slug)}${path}`, Buffer.from(asset.contentBase64, "base64"), asset.contentType);
  }
}

function normalizeAssetPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean).join("/");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("Invalid asset path");
  }
  return normalized;
}

function toArtifactResponse(artifact: Artifact, config: AppConfig) {
  return {
    id: artifact.id,
    slug: artifact.slug,
    title: artifact.title,
    url: `${config.appBaseUrl.replace(/\/$/, "")}/a/${artifact.slug}`,
    expiresAt: artifact.expiresAt,
    passwordProtected: Boolean(artifact.passwordHash)
  };
}
