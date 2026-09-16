import type { JsonObject, JsonValue } from "./types.js";

export const DECLARATIVE_OPERATIONS_PROGRAM_VERSION = 1 as const;

/** The v1 language has no action, script, expression, or network operation. */
export type DeclarativeOperationKind = "read";

export const DECLARATIVE_ARIA_ROLES = [
  "alert",
  "article",
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "grid",
  "gridcell",
  "heading",
  "img",
  "link",
  "list",
  "listitem",
  "listbox",
  "menu",
  "menuitem",
  "main",
  "meter",
  "navigation",
  "option",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "cell",
  "columnheader",
  "rowheader",
  "searchbox",
  "slider",
  "spinbutton",
  "status",
  "tab",
  "tabpanel",
  "table",
  "textbox",
  "tree",
  "treeitem",
] as const;
export type DeclarativeAriaRole = (typeof DECLARATIVE_ARIA_ROLES)[number];

export const DECLARATIVE_HTML_TAGS = [
  "a",
  "article",
  "button",
  "code",
  "dd",
  "div",
  "dl",
  "dt",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "ol",
  "option",
  "p",
  "pre",
  "section",
  "select",
  "span",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
] as const;
export type DeclarativeHtmlTag = (typeof DECLARATIVE_HTML_TAGS)[number];

/** Output reads use a deliberately narrow, non-secret attribute allowlist. */
export const DECLARATIVE_OUTPUT_ATTRIBUTES = [
  "alt",
  "aria-label",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "aria-valuetext",
  "datetime",
  "role",
  "title",
] as const;
export type DeclarativeSafeAttribute =
  (typeof DECLARATIVE_OUTPUT_ATTRIBUTES)[number];

/** Locator attributes are separate from output attributes and never include value. */
export const DECLARATIVE_LOCATOR_ATTRIBUTES = [
  "aria-label",
  "aria-labelledby",
  "data-state",
  "data-testid",
  "id",
  "role",
] as const;
export type DeclarativeLocatorAttribute =
  (typeof DECLARATIVE_LOCATOR_ATTRIBUTES)[number];

export type DeclarativeRoleLocator = Readonly<{
  readonly kind: "role";
  readonly role: DeclarativeAriaRole;
  readonly name?: string;
}>;

export type DeclarativeSelectorAttribute = Readonly<{
  readonly name: DeclarativeLocatorAttribute;
  readonly value: string;
}>;

/** A structured selector is data, never a CSS source string. */
export type DeclarativeStructuredSelector = Readonly<{
  readonly kind: "selector";
  readonly tag?: DeclarativeHtmlTag;
  readonly id?: string;
  readonly classes?: readonly string[];
  readonly attributes?: readonly DeclarativeSelectorAttribute[];
}>;

export type DeclarativeLocator =
  DeclarativeRoleLocator | DeclarativeStructuredSelector;

export type DeclarativeAvailability = Readonly<{
  readonly kind: "present";
  readonly locator: DeclarativeLocator;
}>;

export type DeclarativeSingleScope = Readonly<{
  readonly kind: "single";
  readonly locator: DeclarativeLocator;
}>;

export type DeclarativeListScope = Readonly<{
  readonly kind: "list";
  readonly locator: DeclarativeLocator;
  readonly maxMatches: number;
}>;

export type DeclarativeScope = DeclarativeSingleScope | DeclarativeListScope;

export type DeclarativeTextSource = Readonly<{ readonly kind: "text" }>;
export type DeclarativeAttributeSource = Readonly<{
  readonly kind: "attribute";
  readonly name: DeclarativeSafeAttribute;
}>;
export type DeclarativeScalarSource =
  DeclarativeTextSource | DeclarativeAttributeSource;

export type DeclarativeTextProjection = Readonly<{ readonly kind: "text" }>;
export type DeclarativeAttributeProjection = Readonly<{
  readonly kind: "attribute";
  readonly name: DeclarativeSafeAttribute;
}>;
export type DeclarativeConstantProjection = Readonly<{
  readonly kind: "constant";
  readonly value: JsonValue;
}>;
export type DeclarativeNumberProjection = Readonly<{
  readonly kind: "number";
  readonly source: DeclarativeScalarSource;
}>;
export type DeclarativePercentageProjection = Readonly<{
  readonly kind: "percentage";
  readonly source: DeclarativeScalarSource;
}>;
export type DeclarativeBooleanProjection = Readonly<{
  readonly kind: "boolean";
  readonly source: DeclarativeScalarSource;
}>;
export type DeclarativeOptionalProjection = Readonly<{
  readonly kind: "optional";
  readonly value: DeclarativeProjection;
}>;
export type DeclarativeDescendantScope = Readonly<{
  readonly kind: "single" | "list";
  readonly locator: DeclarativeLocator;
  readonly maxMatches?: number;
}>;
export type DeclarativeDescendantProjection = Readonly<{
  readonly kind: "descendant";
  readonly scope: DeclarativeDescendantScope;
  readonly projection: DeclarativeProjection;
}>;
export type DeclarativeObjectProjection = Readonly<{
  readonly kind: "object";
  readonly fields: readonly DeclarativeObjectField[];
}>;
export type DeclarativeArrayProjection = Readonly<{
  readonly kind: "array";
  readonly items: readonly DeclarativeProjection[];
}>;
export type DeclarativeProjection =
  | DeclarativeTextProjection
  | DeclarativeAttributeProjection
  | DeclarativeConstantProjection
  | DeclarativeNumberProjection
  | DeclarativePercentageProjection
  | DeclarativeBooleanProjection
  | DeclarativeOptionalProjection
  | DeclarativeDescendantProjection
  | DeclarativeObjectProjection
  | DeclarativeArrayProjection;

export type DeclarativeObjectField = Readonly<{
  readonly key: string;
  readonly value: DeclarativeProjection;
}>;

export type DeclarativeOperation = Readonly<{
  readonly kind: DeclarativeOperationKind;
  readonly tool: string;
  readonly availability: DeclarativeAvailability;
  readonly scope: DeclarativeScope;
  readonly projection: DeclarativeProjection;
}>;

export type DeclarativeOperationsProgram = Readonly<{
  readonly version: typeof DECLARATIVE_OPERATIONS_PROGRAM_VERSION;
  readonly operations: readonly DeclarativeOperation[];
}>;

export type DeclarativeOperationsValidationCode =
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_VERSION"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "INVALID_SELECTOR"
  | "INVALID_PROJECTION"
  | "INVALID_REFERENCE"
  | "INVALID_SCHEMA"
  | "DUPLICATE_VALUE"
  | "CONFLICTING_PROJECTION"
  | "DYNAMIC_REFERENCE"
  | "UNBOUNDED_QUERY"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED_OPERATION";

export type DeclarativeOperationsValidationIssue = Readonly<{
  readonly code: DeclarativeOperationsValidationCode;
  readonly field: string;
}>;

export type DeclarativeOperationExecutionErrorCode =
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "CAPABILITY_UNAVAILABLE"
  | "CARDINALITY_EXCEEDED"
  | "NODE_VISIT_LIMIT_EXCEEDED"
  | "TEXT_LIMIT_EXCEEDED"
  | "ATTRIBUTE_LIMIT_EXCEEDED"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "PROJECTION_ABSENT"
  | "INVALID_PAGE_VALUE"
  | "INTERNAL_ERROR";

export type DeclarativeOperationExecutionError = Readonly<{
  readonly code: DeclarativeOperationExecutionErrorCode;
}>;

export type DeclarativeOperationTool = Readonly<{
  readonly name: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly risk: string;
  readonly permissions: readonly string[];
}>;
