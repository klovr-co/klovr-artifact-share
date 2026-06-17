import { randomUUID } from "node:crypto";
import type { Artifact, PublisherToken } from "../domain/types";

export type ArtifactCreateRecord = {
  slug: string;
  title: string;
  ownerId: string;
  objectPath: string;
  passwordHash: string | null;
  expiresAt: string | null;
};

export type ArtifactUpdateRecord = Partial<Pick<Artifact, "title" | "objectPath" | "passwordHash" | "expiresAt">>;

export interface ArtifactRepository {
  create(input: ArtifactCreateRecord): Promise<Artifact>;
  getBySlug(slug: string): Promise<Artifact | null>;
  listExpiredArtifacts(cutoffIso: string, limit: number): Promise<Artifact[]>;
  updateBySlug(slug: string, ownerId: string, updates: ArtifactUpdateRecord): Promise<Artifact>;
  markDeletedBySlug(slug: string, ownerId: string): Promise<Artifact>;
  putPublisherToken(token: PublisherToken): Promise<void>;
  findActivePublisherTokenByHash(tokenHash: string): Promise<PublisherToken | null>;
  listActivePublisherTokens(): Promise<PublisherToken[]>;
}

type MemoryArtifactRepositoryArgs = {
  now?: () => Date;
  idFactory?: () => string;
};

export class ArtifactConflictError extends Error {
  constructor(slug: string) {
    super(`Artifact already exists for slug: ${slug}`);
    this.name = "ArtifactConflictError";
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(slug: string) {
    super(`Artifact not found for slug: ${slug}`);
    this.name = "ArtifactNotFoundError";
  }
}

export class MemoryArtifactRepository implements ArtifactRepository {
  private readonly artifactsBySlug = new Map<string, Artifact>();
  private readonly tokensByHash = new Map<string, PublisherToken>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor({ now = () => new Date(), idFactory = randomUUID }: MemoryArtifactRepositoryArgs = {}) {
    this.now = now;
    this.idFactory = idFactory;
  }

  async create(input: ArtifactCreateRecord): Promise<Artifact> {
    const existing = this.artifactsBySlug.get(input.slug);
    if (existing && !existing.deletedAt) {
      throw new ArtifactConflictError(input.slug);
    }

    const timestamp = this.now().toISOString();
    const artifact: Artifact = {
      id: this.idFactory(),
      slug: input.slug,
      title: input.title,
      ownerId: input.ownerId,
      objectPath: input.objectPath,
      passwordHash: input.passwordHash,
      expiresAt: input.expiresAt,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    };
    this.artifactsBySlug.set(input.slug, artifact);
    return cloneArtifact(artifact);
  }

  async getBySlug(slug: string): Promise<Artifact | null> {
    const artifact = this.artifactsBySlug.get(slug);
    if (!artifact || artifact.deletedAt) {
      return null;
    }
    return cloneArtifact(artifact);
  }

  async listExpiredArtifacts(cutoffIso: string, limit: number): Promise<Artifact[]> {
    return Array.from(this.artifactsBySlug.values())
      .filter((artifact) => !artifact.deletedAt && artifact.expiresAt !== null && artifact.expiresAt <= cutoffIso)
      .sort((left, right) => {
        const expiresAtOrder = String(left.expiresAt).localeCompare(String(right.expiresAt));
        return expiresAtOrder === 0 ? left.slug.localeCompare(right.slug) : expiresAtOrder;
      })
      .slice(0, limit)
      .map(cloneArtifact);
  }

  async updateBySlug(slug: string, ownerId: string, updates: ArtifactUpdateRecord): Promise<Artifact> {
    const artifact = this.artifactsBySlug.get(slug);
    if (!artifact || artifact.deletedAt || artifact.ownerId !== ownerId) {
      throw new ArtifactNotFoundError(slug);
    }

    const updated: Artifact = {
      ...artifact,
      ...updates,
      updatedAt: this.now().toISOString()
    };
    this.artifactsBySlug.set(slug, updated);
    return cloneArtifact(updated);
  }

  async markDeletedBySlug(slug: string, ownerId: string): Promise<Artifact> {
    const artifact = this.artifactsBySlug.get(slug);
    if (!artifact || artifact.deletedAt || artifact.ownerId !== ownerId) {
      throw new ArtifactNotFoundError(slug);
    }

    const deleted: Artifact = {
      ...artifact,
      updatedAt: this.now().toISOString(),
      deletedAt: this.now().toISOString()
    };
    this.artifactsBySlug.set(slug, deleted);
    return cloneArtifact(deleted);
  }

  async putPublisherToken(token: PublisherToken): Promise<void> {
    this.tokensByHash.set(token.tokenHash, { ...token });
  }

  async findActivePublisherTokenByHash(tokenHash: string): Promise<PublisherToken | null> {
    const token = this.tokensByHash.get(tokenHash);
    if (!token || token.revokedAt) {
      return null;
    }
    return { ...token };
  }

  async listActivePublisherTokens(): Promise<PublisherToken[]> {
    return Array.from(this.tokensByHash.values())
      .filter((token) => !token.revokedAt)
      .map((token) => ({ ...token }));
  }
}

function cloneArtifact(artifact: Artifact): Artifact {
  return { ...artifact };
}
