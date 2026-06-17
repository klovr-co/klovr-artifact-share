import { createHmac, timingSafeEqual } from "node:crypto";

type SessionPayload = {
  slug: string;
  exp: number;
};

type SignArtifactSessionArgs = {
  slug: string;
  secret: string;
  now?: Date;
  ttlSeconds: number;
};

type VerifyArtifactSessionArgs = {
  token: string | undefined;
  slug: string;
  secret: string;
  now?: Date;
};

export type ArtifactSessionVerification =
  | { valid: true; slug: string }
  | {
      valid: false;
      reason: "missing" | "malformed" | "invalid-signature" | "slug-mismatch" | "expired";
    };

export function signArtifactSession({
  slug,
  secret,
  now = new Date(),
  ttlSeconds
}: SignArtifactSessionArgs): string {
  const payload: SessionPayload = {
    slug,
    exp: now.getTime() + ttlSeconds * 1000
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyArtifactSession({
  token,
  slug,
  secret,
  now = new Date()
}: VerifyArtifactSessionArgs): ArtifactSessionVerification {
  if (!token) {
    return { valid: false, reason: "missing" };
  }

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return { valid: false, reason: "malformed" };
  }

  if (!signatureMatches(signature, sign(encodedPayload, secret))) {
    return { valid: false, reason: "invalid-signature" };
  }

  const payload = parsePayload(encodedPayload);
  if (!payload) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.slug !== slug) {
    return { valid: false, reason: "slug-mismatch" };
  }

  if (payload.exp <= now.getTime()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, slug: payload.slug };
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function signatureMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function parsePayload(encodedPayload: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof parsed.slug !== "string" || typeof parsed.exp !== "number") {
      return null;
    }
    return { slug: parsed.slug, exp: parsed.exp };
  } catch {
    return null;
  }
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
