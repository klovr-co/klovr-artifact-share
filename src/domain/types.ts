export type Artifact = {
  id: string;
  slug: string;
  title: string;
  ownerId: string;
  objectPath: string;
  passwordHash: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type PublisherToken = {
  id: string;
  ownerId: string;
  tokenHash: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
};

export type CreateArtifactInput = {
  slug: string;
  title: string;
  html: string;
  ownerId: string;
  passwordHash: string | null;
  expiresAt: string | null;
};
