import type {
  DeclarativeAriaRole,
  DeclarativeHtmlTag,
} from "./declarative-operations-types.js";
import {
  DECLARATIVE_ARIA_ROLES,
  DECLARATIVE_HTML_TAGS,
  DECLARATIVE_LOCATOR_ATTRIBUTES,
  DECLARATIVE_OUTPUT_ATTRIBUTES,
} from "./declarative-operations-types.js";
import { DeclarativePackBundleValidationError } from "./declarative-bundle-types.js";
import { bundleIssue } from "./declarative-bundle-limits.js";
import { canonicalizePageLocation } from "./location.js";
import {
  cloneAndFreeze,
  isRecord,
  validateJsonBounds,
} from "./validation/primitives.js";

export interface SyntheticDocumentElement {
  readonly tag: DeclarativeHtmlTag;
  readonly id?: string;
  readonly classes?: readonly string[];
  readonly role?: DeclarativeAriaRole;
  readonly accessibleName?: string;
  readonly text?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: readonly SyntheticDocumentElement[];
}

export interface SyntheticDocument {
  readonly url: string;
  readonly root: SyntheticDocumentElement;
}

const DOCUMENT_FIELDS = new Set(["url", "root"]);
const TAGS = new Set<string>(DECLARATIVE_HTML_TAGS);
const ROLES = new Set<string>(DECLARATIVE_ARIA_ROLES);
const ATTRIBUTES = new Set<string>([
  ...DECLARATIVE_LOCATOR_ATTRIBUTES,
  ...DECLARATIVE_OUTPUT_ATTRIBUTES,
]);
const ELEMENT_FIELDS = new Set([
  "tag",
  "id",
  "classes",
  "role",
  "accessibleName",
  "text",
  "attributes",
  "children",
]);

/** Creates inert tree data. It never parses HTML or acquires a browser document. */
export function syntheticDocument(value: SyntheticDocument): SyntheticDocument {
  assertExactObject(value, DOCUMENT_FIELDS, "document");
  const boundsIssue = validateJsonBounds(value);
  if (boundsIssue !== undefined) reject(boundsIssue.field);
  if (canonicalizePageLocation(value.url).ok === false) reject("document.url");
  validateElement(value.root, "document.root", 0);
  return cloneAndFreeze(value) as SyntheticDocument;
}

function validateElement(value: unknown, field: string, depth: number): void {
  if (depth > 32) reject(field);
  assertExactObject(value, ELEMENT_FIELDS, field);
  if (typeof value.tag !== "string" || !TAGS.has(value.tag)) {
    reject(`${field}.tag`);
  }
  for (const optional of ["id", "accessibleName", "text"] as const) {
    if (Object.hasOwn(value, optional) && typeof value[optional] !== "string") {
      reject(`${field}.${optional}`);
    }
  }
  if (
    Object.hasOwn(value, "role") &&
    (typeof value.role !== "string" || !ROLES.has(value.role))
  ) {
    reject(`${field}.role`);
  }
  if (Object.hasOwn(value, "classes")) {
    if (!Array.isArray(value.classes)) reject(`${field}.classes`);
    for (const [index, className] of value.classes.entries()) {
      if (typeof className !== "string") reject(`${field}.classes[${index}]`);
    }
  }
  if (Object.hasOwn(value, "attributes")) {
    if (!isRecord(value.attributes)) reject(`${field}.attributes`);
    for (const key of Reflect.ownKeys(value.attributes)) {
      if (typeof key !== "string" || !ATTRIBUTES.has(key)) {
        reject(`${field}.attributes`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value.attributes, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string"
      ) {
        reject(`${field}.attributes`);
      }
    }
  }
  if (Object.hasOwn(value, "children")) {
    if (!Array.isArray(value.children)) reject(`${field}.children`);
    value.children.forEach((child, index) =>
      validateElement(child, `${field}.children[${index}]`, depth + 1),
    );
  }
}

function assertExactObject(
  value: unknown,
  fields: ReadonlySet<string>,
  field: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) reject(field);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.has(key)) reject(field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) reject(field);
  }
}

function reject(field: string): never {
  throw new DeclarativePackBundleValidationError(
    bundleIssue("INVALID_VALUE", field),
  );
}
