import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { parseExpiry, toIsoString } from "../domain/time";
import { apiRequest, type ApiConfig } from "./httpClient";

export type ParsedCliCommand =
  | {
      command: "publish";
      file: string;
      slug: string;
      title?: string;
      expiresIn?: string;
      expiresAt?: string;
      password?: string;
      assetsDir?: string;
      upsert?: boolean;
    }
  | {
      command: "update";
      file: string;
      slug: string;
      title?: string;
      expiresIn?: string;
      expiresAt?: string;
      password?: string;
      assetsDir?: string;
      clearPassword?: boolean;
    }
  | {
      command: "delete";
      slug: string;
    };

export type ArtifactPayload = Record<string, unknown>;

export function parseCliArgs(argv: string[]): ParsedCliCommand {
  const [command, maybeFile, ...rest] = argv;
  if (command !== "publish" && command !== "update" && command !== "delete") {
    throw new Error("Usage: klovr-share <publish|update|delete> [file] --slug <slug>");
  }

  const file = command === "delete" ? undefined : maybeFile;
  const flags = parseFlags(command === "delete" ? [maybeFile, ...rest].filter(Boolean) : rest);
  const slug = requireOption(flags, "slug");

  if (flags.expiresIn && flags.expiresAt) {
    throw new Error("Use only one of --expires-in or --expires-at");
  }

  if (command === "delete") {
    return { command, slug };
  }

  if (!file) {
    throw new Error(`${command} requires an HTML file path`);
  }

  if (command === "publish") {
    return {
      command,
      file,
      slug,
      title: optionalString(flags, "title"),
      expiresIn: optionalString(flags, "expiresIn"),
      expiresAt: optionalString(flags, "expiresAt"),
      password: optionalString(flags, "password"),
      assetsDir: optionalString(flags, "assetsDir"),
      upsert: optionalBoolean(flags, "upsert")
    };
  }

  return {
    command,
    file,
    slug,
    title: optionalString(flags, "title"),
    expiresIn: optionalString(flags, "expiresIn"),
    expiresAt: optionalString(flags, "expiresAt"),
    password: optionalString(flags, "password"),
    assetsDir: optionalString(flags, "assetsDir"),
    clearPassword: optionalBoolean(flags, "clearPassword")
  };
}

export function buildArtifactPayload(
  command: ParsedCliCommand,
  html: string,
  now = new Date(),
  assets?: AssetPayload[]
): ArtifactPayload {
  if (command.command === "delete") {
    return {};
  }

  const expiresAt = resolveExpiry(command, now);
  if (command.command === "publish") {
    return removeUndefined({
      slug: command.slug,
      title: command.title ?? titleFromFile(command.file),
      html,
      assets,
      password: command.password,
      expiresAt,
      upsert: command.upsert
    });
  }

  return removeUndefined({
    title: command.title,
    html,
    assets,
    password: command.clearPassword ? null : command.password,
    expiresAt
  });
}

export type AssetPayload = {
  path: string;
  contentBase64: string;
  contentType: string;
};

export function readApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  if (!env.KLOVR_SHARE_API_URL) {
    throw new Error("KLOVR_SHARE_API_URL is required");
  }
  if (!env.KLOVR_SHARE_TOKEN) {
    throw new Error("KLOVR_SHARE_TOKEN is required");
  }
  return {
    apiUrl: env.KLOVR_SHARE_API_URL,
    token: env.KLOVR_SHARE_TOKEN
  };
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const command = parseCliArgs(argv);
  const config = readApiConfig(env);

  if (command.command === "delete") {
    await apiRequest(config, "DELETE", `/api/artifacts/${encodeURIComponent(command.slug)}`);
    console.log(JSON.stringify({ deleted: true, slug: command.slug }, null, 2));
    return;
  }

  const html = await readFile(command.file, "utf8");
  const assets = command.assetsDir ? await readAssetsFromDirectory(command.assetsDir) : undefined;
  const payload = buildArtifactPayload(command, html, new Date(), assets);
  const response =
    command.command === "publish"
      ? await apiRequest(config, "POST", "/api/artifacts", payload)
      : await apiRequest(config, "PUT", `/api/artifacts/${encodeURIComponent(command.slug)}`, payload);

  console.log(JSON.stringify(response, null, 2));
}

export async function readAssetsFromDirectory(directory: string): Promise<AssetPayload[]> {
  const assets: AssetPayload[] = [];
  await collectAssets(directory, directory, assets);
  return assets.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectAssets(root: string, directory: string, assets: AssetPayload[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectAssets(root, absolutePath, assets);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    const body = await readFile(absolutePath);
    assets.push({
      path: relativePath,
      contentBase64: body.toString("base64"),
      contentType: contentTypeForPath(relativePath)
    });
  }
}

function contentTypeForPath(path: string): string {
  const extension = path.toLowerCase().split(".").pop();
  switch (extension) {
    case "avif":
      return "image/avif";
    case "css":
      return "text/css; charset=utf-8";
    case "gif":
      return "image/gif";
    case "htm":
    case "html":
      return "text/html; charset=utf-8";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "js":
      return "text/javascript; charset=utf-8";
    case "mp4":
      return "video/mp4";
    case "png":
      return "image/png";
    case "svg":
      return "image/svg+xml";
    case "webm":
      return "video/webm";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = toCamelCase(arg.slice(2));
    if (key === "upsert" || key === "clearPassword") {
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

function resolveExpiry(command: Exclude<ParsedCliCommand, { command: "delete" }>, now: Date): string | null | undefined {
  const value = command.expiresIn ?? command.expiresAt;
  if (value === undefined) {
    return undefined;
  }
  return toIsoString(parseExpiry(value, now));
}

function removeUndefined(input: ArtifactPayload): ArtifactPayload {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function titleFromFile(file: string): string {
  return basename(file).replace(/\.html?$/i, "");
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
