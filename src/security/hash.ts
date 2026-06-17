import argon2 from "argon2";

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
} satisfies argon2.Options;

export async function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, HASH_OPTIONS);
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}
