const RELATIVE_EXPIRY_PATTERN = /^(\d+)([mhd])$/;

export function parseExpiry(value: string | undefined, now = new Date()): Date | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "never") {
    return null;
  }

  const relativeMatch = RELATIVE_EXPIRY_PATTERN.exec(trimmed);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeMatch[2];
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Invalid expiry");
    }

    const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() + amount * multiplier);
  }

  const absolute = new Date(trimmed);
  if (Number.isNaN(absolute.getTime())) {
    throw new Error("Invalid expiry");
  }

  return absolute;
}

export function isExpired(expiresAt: string | null, now = new Date()): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiry = new Date(expiresAt);
  return expiry.getTime() <= now.getTime();
}

export function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
