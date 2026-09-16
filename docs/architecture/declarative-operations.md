# Declarative Operations v1

Declarative Operations v1 is the separately versioned, read-only language stored
at `operations.program` inside the canonical `.mcpack` JSON document. It is a
closed data contract, not a source file or an execution entrypoint. Unknown
operation versions, kinds, fields, selector forms, and projection forms fail
closed.

## Program shape

The program is `{ "version": 1, "operations": [...] }`. There is exactly one
`read` operation for every manifest tool: no undeclared tool, duplicate tool, or
missing tool is accepted. Declarative tools must have an empty closed object input
schema, `risk: "read"`, exactly `permissions: ["READ"]`, and the enclosing
manifest must use `networkPolicy.extensionRequests: "none"`.

Each operation has a deterministic `present` availability check, a `single` or
explicitly bounded `list` scope, and one projection. A list scope maps the same
projection over its matches and returns an array. A projection may also contain a
bounded fixed array, fixed-field object, constant, text, safe attribute, strict
number, strict percentage, strict boolean, optional value, or a nested descendant
read. Descendant reads can only move downward through one static single/list
scope; they cannot traverse ancestors, run general queries, or become selector
expressions.

Scalar parsing is strict and locale-free: `number` accepts only a canonical
ASCII decimal with an optional leading minus and fractional part (no exponent or
whitespace), `percentage` accepts the same non-negative form in the inclusive
range 0 through 100 with one optional trailing `%`, and `boolean` accepts only
the lowercase literals `true` and `false`. An `optional` projection returns JSON
`null` when its read is absent, so a declared output schema must allow `null` at
that position. It does not turn an absent required object field into an arbitrary
default.

Locators are either an explicit accessibility role with an optional literal
accessible name, or a structured selector composed from fixed tag, id, class, and
allowlisted literal-attribute components. There is no CSS string, pseudo-selector,
regex, selector list, interpolation, computed reference, MCP argument reference,
property path, or arbitrary attribute name. Locator attributes and output
attributes use separate allowlists. Output attributes are limited to visible,
non-secret values: `alt`, `aria-label`, `aria-valuemax`, `aria-valuemin`,
`aria-valuenow`, `aria-valuetext`, `datetime`, `role`, and `title`.

## Exact limits

The SDK exports the following limits for the future interpreter and validates the
same contract before signing or installing a bundle:

| Resource                        |                           Limit |
| ------------------------------- | ------------------------------: |
| Operations payload              |         256 KiB canonical UTF-8 |
| AST nodes per tool              |                             256 |
| Projection depth                |                               8 |
| Object projection fields        |                              32 |
| Fixed/list projection items     |                              64 |
| List-scope matches              |                              64 |
| Internal matched-element budget | 2,048 node visits / 256 matches |
| Text read                       |       4,096 Unicode code points |
| Attribute read                  |       2,048 Unicode code points |
| Output                          |              512 nodes / 64 KiB |
| Per-call deadline               |                       5 seconds |

All limits are deterministic and fail closed. Runtime execution errors are a
stable code only: cancellation, deadline, unavailable capability, cardinality or
node-visit exhaustion, text/attribute/output limit exhaustion, absence, invalid
page value, or internal failure. Error payloads never contain page values,
selector values, tool names, exception messages, HTML, or stack traces.

The SDK validates the projection's statically knowable shape against the declared
tool output schema, including type, fixed object keys, enum/const, and list
`maxItems` constraints. The interpreter remains authoritative for the final
bounded output validation because page content is untrusted.

## Why this is not computationally complete

The language intentionally has no variables, recursion, loops, branching,
arithmetic, comparisons, string construction, user-defined functions, dynamic
property access, code loading, or side effects. A projection is a finite tree of
predeclared reads and literals, and every query and output has a fixed bound.
This makes the accepted authority auditable and permits deterministic resource
accounting. It also prevents a pack or MCP argument from smuggling in a general
browser-automation or code-execution language. More expressive behavior belongs
in a separately reviewed, compiled pack contract rather than an installable
community artifact.

## Versioning

`operationsVersion` is independent from bundle, manifest, bridge, page protocol,
and pack SemVer. Operations v1 is read-only and same-origin with no pack network
authority. Any new operation kind, selector capability, side effect, output
meaning, or bound that changes accepted authority requires a new operations version
and migration note. The v1 schema is embedded in the self-contained
`declarative-pack-bundle.schema.json`; there is no archive path or second program
file.
