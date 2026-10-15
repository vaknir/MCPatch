# Public-source preparation: MCPatch

Status: **preparation only; not cleared for public release**.

## Review performed

Reviewed the default-branch file inventory and selected README, ignore rules, deployment documentation, and configuration. This is not a full source scan, a full Git-history scan, or a review of every branch, tag, issue, attachment, release, and Actions log.

The existing pre-alpha warning and current private/no-license statement are preserved. Registry, publishing, signing, and community-pack materials require explicit separation from anything intended to remain private. No secret-free or history-clean claim is made.

## Required before changing visibility

- [ ] Review all current source files, examples, fixtures, generated assets, screenshots, and operational notes for personal or third-party data.
- [ ] Scan a complete local clone, including every branch and tag, with a current secret scanner. Use redacted output; never publish reports containing secrets. Suggested command after fetching all refs: `gitleaks git --redact --log-opts="--all"`.
- [ ] Review author/committer emails, historical file contents, commit messages, pull requests, issues, attachments, releases, workflow logs, and artifacts. Removing a current file does not remove its history.
- [ ] Rotate or revoke any real credential found before considering history cleanup. Document a clean result against the exact release commit.
- [ ] Replace real records with synthetic examples. Remove production endpoints and deployment identifiers that are not meant to be public.
- [ ] Keep employer-owned code, internal configuration, private service backends, operational data, and signing material private.
- [ ] Resolve licensing deliberately; the README's study/personal-use statement does not change the repository's existing license terms.
- [ ] Validate clean setup, build, and tests using only documented placeholders and locally supplied credentials.
- [ ] Make the final visibility decision only after the review above is complete.

If sensitive material exists in history, assess a separate sanitized public snapshot instead of exposing that history. No history rewrite, force push, visibility change, or release is performed by this preparation branch.

References:
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- https://github.com/gitleaks/gitleaks
