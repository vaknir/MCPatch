# Pack fixture verification

The SDK fixture harness verifies a locally supplied compiled pack against an
explicit runtime environment before any handler runs. Its result is deterministic,
JSON-serializable compatibility evidence for development and CI; it is not an
installation decision or runtime authorization.

## Verification pipeline

`verifyPackFixtures` performs these stages in order:

1. validate and detach Pack Manifest v1, including fixture references;
2. require an exact data-only handler table for every declared tool;
3. validate the runtime version, bridge protocol, and caller-supplied permission
   ceiling;
4. compile every input and output JSON Schema with Draft 2020-12 and standard
   formats;
5. validate every fixture input and expected result; and
6. only after all preflight checks pass, execute fixtures sequentially in manifest
   order and validate each returned result.

A failure in stages 1 or 2 returns a top-level payload-free issue. Invalid options
do the same. Compatibility, permission, schema, and fixture failures produce a
complete evidence object. Any preflight failure prevents all handler execution;
the exact invalid fixtures are marked `failed` and otherwise valid fixtures are
marked `skipped`.

Handlers may throw `PackToolExecutionError` for a declared fixture error code. The
harness compares only the code. Ordinary exceptions, schema diagnostics, fixture
inputs, expected values, actual values, and exception messages are never copied
into evidence.

## Evidence semantics

Evidence version `1` contains only:

- immutable pack identity: publisher, ID, version, and digest;
- the tested runtime version, bridge protocol, and sorted permission ceiling;
- stable check and fixture status codes; and
- deterministic counts and an overall result.

There is deliberately no timestamp, host path, stack trace, duration, input,
result, or error text. Repeating the same verification produces the same evidence.
Registry or marketplace metadata may display evidence, but must not be trusted as
proof that verification ran. An installer and runtime must independently verify
artifact integrity, manifest compatibility, enabled origins, and permissions.
Signed attestations from a trusted build service are future work.

## Trust boundary and limits

The harness does not supply DOM, cookie, extension, or browser-session authority.
Its `allowedPermissions` option rejects declared permission expansion, but it is an
assertion check rather than a JavaScript sandbox. A compiled handler already loaded
into the Node.js process has that process's ambient authority. Never import or
execute downloaded or otherwise untrusted pack code with this harness.

Asynchronous handlers receive an `AbortSignal` and have a bounded deadline from 1
to 10,000 milliseconds. JavaScript running synchronously in the same process cannot
be preempted by a timer. CI should therefore execute only repository-reviewed code
and use an outer process timeout as defense in depth. Pack Manifest size and depth
bounds constrain fixture and schema data, but pathological regular expressions in
untrusted schemas still require a future isolated verification worker.

## Workspace command

Run the harness contract suite with the repository-pinned Node and pnpm versions:

```sh
pnpm verify:packs
```

Pack packages call `verifyPackFixtures` from Vitest and fail their test when the
returned top-level result is invalid or `evidence.passed` is false. The command now
verifies both the harness contract and every test in `packs/*`, including the
reviewed synthetic pack compiled into the extension.
