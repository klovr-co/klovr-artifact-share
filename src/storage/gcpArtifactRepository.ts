import { randomUUID } from "node:crypto";
import type { CollectionReference, DocumentData, Firestore } from "@google-cloud/firestore";
import type { Artifact, PublisherToken } from "../domain/types";
import {
  ArtifactConflictError,
  ArtifactNotFoundError,
  type ArtifactCreateRecord,
  type ArtifactRepository,
  type ArtifactUpdateRecord
} from "./artifactRepository";

type FirestoreArtifactRepositoryArgs = {
  firestore: Firestore;
  artifactsCollection: string;
  tokensCollection: string;
  now?: () => Date;
  idFactory?: () => string;
};

export class FirestoreArtifactRepository implements ArtifactRepository {
  private readonly artifacts: CollectionReference<DocumentData>;
  private readonly tokens: CollectionReference<DocumentData>;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor({
    firestore,
    artifactsCollection,
    tokensCollection,
    now = () => new Date(),
    idFactory = randomUUID
  }: FirestoreArtifactRepositoryArgs) {
    this.artifacts = firestore.collection(artifactsCollection);
    this.tokens = firestore.collection(tokensCollection);
    this.now = now;
    this.idFactory = idFactory;
  }

  async create(input: ArtifactCreateRecord): Promise<Artifact> {
    const ref = this.artifacts.doc(input.slug);
    const existing = await ref.get();
    if (existing.exists) {
      const artifact = artifactFromFirestoreData(existing.data());
      if (!artifact.deletedAt) {
        throw new ArtifactConflictError(input.slug);
      }
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
    await ref.set(artifactToFirestoreData(artifact));
    return artifact;
  }

  async getBySlug(slug: string): Promise<Artifact | null> {
    const snapshot = await this.artifacts.doc(slug).get();
    if (!snapshot.exists) {
      return null;
    }

    const artifact = artifactFromFirestoreData(snapshot.data());
    return artifact.deletedAt ? null : artifact;
  }

  async listExpiredArtifacts(cutoffIso: string, limit: number): Promise<Artifact[]> {
    const snapshot = await this.artifacts
      .where("deletedAt", "==", null)
      .where("expiresAt", "<=", cutoffIso)
      .orderBy("expiresAt", "asc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => artifactFromFirestoreData(doc.data()));
  }

  async updateBySlug(slug: string, ownerId: string, updates: ArtifactUpdateRecord): Promise<Artifact> {
    const ref = this.artifacts.doc(slug);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new ArtifactNotFoundError(slug);
    }

    const artifact = artifactFromFirestoreData(snapshot.data());
    if (artifact.deletedAt || artifact.ownerId !== ownerId) {
      throw new ArtifactNotFoundError(slug);
    }

    const updated: Artifact = {
      ...artifact,
      ...updates,
      updatedAt: this.now().toISOString()
    };
    await ref.set(artifactToFirestoreData(updated));
    return updated;
  }

  async markDeletedBySlug(slug: string, ownerId: string): Promise<Artifact> {
    const ref = this.artifacts.doc(slug);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new ArtifactNotFoundError(slug);
    }

    const artifact = artifactFromFirestoreData(snapshot.data());
    if (artifact.deletedAt || artifact.ownerId !== ownerId) {
      throw new ArtifactNotFoundError(slug);
    }

    const timestamp = this.now().toISOString();
    const deleted: Artifact = {
      ...artifact,
      updatedAt: timestamp,
      deletedAt: timestamp
    };
    await ref.set(artifactToFirestoreData(deleted));
    return deleted;
  }

  async putPublisherToken(token: PublisherToken): Promise<void> {
    await this.tokens.doc(token.id).set(publisherTokenToFirestoreData(token));
  }

  async findActivePublisherTokenByHash(tokenHash: string): Promise<PublisherToken | null> {
    const snapshot = await this.tokens.where("tokenHash", "==", tokenHash).where("revokedAt", "==", null).limit(1).get();
    const first = snapshot.docs[0];
    return first ? publisherTokenFromFirestoreData(first.data()) : null;
  }

  async listActivePublisherTokens(): Promise<PublisherToken[]> {
    const snapshot = await this.tokens.where("revokedAt", "==", null).get();
    return snapshot.docs.map((doc) => publisherTokenFromFirestoreData(doc.data()));
  }
}

export function artifactToFirestoreData(artifact: Artifact): DocumentData {
  return { ...artifact };
}

export function artifactFromFirestoreData(data: DocumentData | undefined): Artifact {
  if (!data) {
    throw new Error("Missing artifact data");
  }
  return {
    id: String(data.id),
    slug: String(data.slug),
    title: String(data.title),
    ownerId: String(data.ownerId),
    objectPath: String(data.objectPath),
    passwordHash: data.passwordHash === null || data.passwordHash === undefined ? null : String(data.passwordHash),
    expiresAt: data.expiresAt === null || data.expiresAt === undefined ? null : String(data.expiresAt),
    createdAt: String(data.createdAt),
    updatedAt: String(data.updatedAt),
    deletedAt: data.deletedAt === null || data.deletedAt === undefined ? null : String(data.deletedAt)
  };
}

export function publisherTokenToFirestoreData(token: PublisherToken): DocumentData {
  return { ...token };
}

export function publisherTokenFromFirestoreData(data: DocumentData | undefined): PublisherToken {
  if (!data) {
    throw new Error("Missing publisher token data");
  }
  return {
    id: String(data.id),
    ownerId: String(data.ownerId),
    tokenHash: String(data.tokenHash),
    label: String(data.label),
    createdAt: String(data.createdAt),
    revokedAt: data.revokedAt === null || data.revokedAt === undefined ? null : String(data.revokedAt)
  };
}
