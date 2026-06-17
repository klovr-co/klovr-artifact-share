import { randomBytes, randomUUID } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import type { PublisherToken } from "../domain/types";
import { hashSecret as defaultHashSecret } from "../security/hash";

export type ParsedAdminCommand = {
  command: "generate-token";
  ownerId: string;
  label: string;
  token?: string;
  writeFirestore: boolean;
};

type BuildPublisherTokenDependencies = {
  now?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
  hashSecret?: (secret: string) => Promise<string>;
  tokensCollection?: string;
};

export type PublisherTokenBuildResult = {
  token: string;
  documentPath: string;
  record: PublisherToken;
};

export function parseAdminArgs(argv: string[]): ParsedAdminCommand {
  const [command, ...rest] = argv;
  if (command !== "generate-token") {
    throw new Error("Usage: klovr-admin generate-token --owner-id <id> --label <label>");
  }

  const flags = parseFlags(rest);
  return {
    command,
    ownerId: requireOption(flags, "ownerId"),
    label: requireOption(flags, "label"),
    token: optionalString(flags, "token"),
    writeFirestore: optionalBoolean(flags, "writeFirestore") ?? false
  };
}

export async function buildPublisherToken(
  command: ParsedAdminCommand,
  dependencies: BuildPublisherTokenDependencies = {}
): Promise<PublisherTokenBuildResult> {
  const now = dependencies.now ?? (() => new Date());
  const idFactory = dependencies.idFactory ?? randomUUID;
  const tokenFactory = dependencies.tokenFactory ?? generateRawToken;
  const hashSecret = dependencies.hashSecret ?? defaultHashSecret;
  const tokensCollection = dependencies.tokensCollection ?? "publisherTokens";
  const token = command.token ?? tokenFactory();
  const id = idFactory();
  const record: PublisherToken = {
    id,
    ownerId: command.ownerId,
    tokenHash: await hashSecret(token),
    label: command.label,
    createdAt: now().toISOString(),
    revokedAt: null
  };

  return {
    token,
    documentPath: `${tokensCollection}/${id}`,
    record
  };
}

export async function writePublisherTokenToFirestore(
  result: PublisherTokenBuildResult,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const collection = env.FIRESTORE_TOKENS_COLLECTION ?? "publisherTokens";
  const firestore = new Firestore();
  await firestore.collection(collection).doc(result.record.id).set(result.record);
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const command = parseAdminArgs(argv);
  const result = await buildPublisherToken(command, {
    tokensCollection: env.FIRESTORE_TOKENS_COLLECTION
  });

  if (command.writeFirestore) {
    await writePublisherTokenToFirestore(result, env);
  }

  console.log(
    JSON.stringify(
      {
        ...result,
        writtenToFirestore: command.writeFirestore
      },
      null,
      2
    )
  );
}

function generateRawToken(): string {
  return `ks_${randomBytes(32).toString("base64url")}`;
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = toCamelCase(arg.slice(2));
    if (key === "writeFirestore") {
      flags[key] = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function requireOption(flags: Record<string, string | boolean>, key: string): string {
  const value = flags[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing required option --${toKebabCase(key)}`);
  }
  return value;
}

function optionalString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(flags: Record<string, string | boolean>, key: string): boolean | undefined {
  const value = flags[key];
  return typeof value === "boolean" ? value : undefined;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
