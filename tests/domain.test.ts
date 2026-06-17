import { describe, expect, it } from "vitest";
import { isExpired, parseExpiry, toIsoString } from "../src/domain/time";

describe("parseExpiry", () => {
  const now = new Date("2026-06-18T00:00:00.000Z");

  it("parses minute, hour, and day relative expiries", () => {
    expect(parseExpiry("30m", now)?.toISOString()).toBe("2026-06-18T00:30:00.000Z");
    expect(parseExpiry("12h", now)?.toISOString()).toBe("2026-06-18T12:00:00.000Z");
    expect(parseExpiry("7d", now)?.toISOString()).toBe("2026-06-25T00:00:00.000Z");
  });

  it("parses absolute ISO timestamps", () => {
    expect(parseExpiry("2026-07-01T12:34:56.000Z", now)?.toISOString()).toBe("2026-07-01T12:34:56.000Z");
  });

  it("treats empty or never values as no expiry", () => {
    expect(parseExpiry(undefined, now)).toBeNull();
    expect(parseExpiry("", now)).toBeNull();
    expect(parseExpiry("never", now)).toBeNull();
  });

  it("rejects malformed expiry values", () => {
    expect(() => parseExpiry("abc", now)).toThrow("Invalid expiry");
    expect(() => parseExpiry("0d", now)).toThrow("Invalid expiry");
  });
});

describe("isExpired", () => {
  const now = new Date("2026-06-18T00:00:00.000Z");

  it("returns false when no expiry is set", () => {
    expect(isExpired(null, now)).toBe(false);
  });

  it("returns true when expiry is at or before now", () => {
    expect(isExpired("2026-06-17T23:59:59.999Z", now)).toBe(true);
    expect(isExpired("2026-06-18T00:00:00.000Z", now)).toBe(true);
  });

  it("returns false when expiry is in the future", () => {
    expect(isExpired("2026-06-18T00:00:00.001Z", now)).toBe(false);
  });
});

describe("toIsoString", () => {
  it("normalizes dates and nulls for persisted metadata", () => {
    expect(toIsoString(null)).toBeNull();
    expect(toIsoString(new Date("2026-06-18T01:02:03.004Z"))).toBe("2026-06-18T01:02:03.004Z");
  });
});
