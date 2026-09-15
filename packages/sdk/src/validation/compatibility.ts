import type { PackManifestValidationIssue } from "../types.js";
import {
  boundedInteger,
  closedObject,
  compareStableVersions,
  isRecord,
  issue,
  validPattern,
} from "./primitives.js";

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateCompatibility(
  value: unknown,
): PackManifestValidationIssue | undefined {
  const checked = closedObject(
    value,
    ["runtime", "bridgeProtocol"],
    [],
    "compatibility",
  );
  if (checked.issue !== undefined) return checked.issue;
  const runtime = closedObject(
    checked.value.runtime,
    ["minimum", "maximumExclusive"],
    [],
    "compatibility.runtime",
  );
  if (runtime.issue !== undefined) return runtime.issue;
  const minimumIssue = validPattern(
    runtime.value.minimum,
    STABLE_SEMVER,
    "INVALID_VERSION",
    "compatibility.runtime.minimum",
    64,
  );
  if (minimumIssue !== undefined) return minimumIssue;
  const maximumIssue = validPattern(
    runtime.value.maximumExclusive,
    STABLE_SEMVER,
    "INVALID_VERSION",
    "compatibility.runtime.maximumExclusive",
    64,
  );
  if (maximumIssue !== undefined) return maximumIssue;
  if (
    compareStableVersions(
      runtime.value.minimum as string,
      runtime.value.maximumExclusive as string,
    ) >= 0
  ) {
    return issue("INVALID_COMPATIBILITY", "compatibility.runtime");
  }

  const protocol = closedObject(
    checked.value.bridgeProtocol,
    ["minimum", "maximum"],
    [],
    "compatibility.bridgeProtocol",
  );
  if (protocol.issue !== undefined) return protocol.issue;
  if (!boundedInteger(protocol.value.minimum, 1, 65_535)) {
    return issue("INVALID_VALUE", "compatibility.bridgeProtocol.minimum");
  }
  if (!boundedInteger(protocol.value.maximum, 1, 65_535)) {
    return issue("INVALID_VALUE", "compatibility.bridgeProtocol.maximum");
  }
  if ((protocol.value.minimum as number) > (protocol.value.maximum as number)) {
    return issue("INVALID_COMPATIBILITY", "compatibility.bridgeProtocol");
  }
  return undefined;
}

export function validateExecution(
  value: unknown,
): PackManifestValidationIssue | undefined {
  if (!isRecord(value)) return issue("INVALID_TYPE", "execution");
  if (value.kind === "bundled") {
    return closedObject(value, ["kind"], [], "execution").issue;
  }
  if (value.kind === "declarative") {
    const checked = closedObject(
      value,
      ["kind", "operationsVersion"],
      [],
      "execution",
    );
    if (checked.issue !== undefined) return checked.issue;
    return value.operationsVersion === 1
      ? undefined
      : issue("UNSUPPORTED_VERSION", "execution.operationsVersion");
  }
  return issue("INVALID_VALUE", "execution.kind");
}
