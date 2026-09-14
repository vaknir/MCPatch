import type { ValidationIssue } from "./error.js";
import { issue } from "./primitives.js";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export function validateOrigin(
  value: unknown,
  field: string,
): ValidationIssue | undefined {
  if (typeof value !== "string" || value.length > 2048) {
    return issue("INVALID_ORIGIN", field);
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.origin !== value
    ) {
      return issue("INVALID_ORIGIN", field);
    }
  } catch {
    return issue("INVALID_ORIGIN", field);
  }

  return undefined;
}

export function validateTimestamp(
  value: unknown,
  field: string,
): ValidationIssue | undefined {
  if (typeof value !== "string" || Array.from(value).length > 35) {
    return issue("INVALID_VALUE", field);
  }
  const match = RFC3339_PATTERN.exec(value);
  if (match === null) return issue("INVALID_VALUE", field);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return issue("INVALID_VALUE", field);
  }

  return undefined;
}

export function validateSemVer(
  value: unknown,
  field: string,
): ValidationIssue | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    !SEMVER_PATTERN.test(value)
  ) {
    return issue("INVALID_VALUE", field);
  }
  return undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
