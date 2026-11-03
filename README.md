# AIEI — AI Engineering Integrity & Learning

> **Status:** v0.3.0 standalone, source-only engineering core with bounded read-only GitHub API evidence observation. No GitHub publication, autonomous security certification, production release integration or deployment is implemented.

AIEI is a **standalone**, fully open-source, self-hostable-by-default engineering integrity toolkit. It helps engineers retain ownership of AI-assisted work by freezing requirements, recording precise check claims, challenging false evidence, and keeping a human accountable for release decisions.

AIEI is **not** an AI code generator. Its current CLI uses Node.js 22+ and no third-party runtime dependencies. The dedicated AIEI repository is independent of DevonStation, Anevum, Cristy's systems and future client repositories; integrations must use explicit, least-privilege access rather than source-code merging.

## What works now

- Validate a bounded, versioned engineering work contract (`schema_version: 1`).
- Validate a versioned receipt compatible with the **AI Code Integrity Audit receipt v1** fields, with optional AIEI provenance extensions.
- Compare a receipt to the original frozen acceptance and negative cases; reject changed requirements, unaccounted check coverage, mismatched commit SHAs, failed/blocked/unrun checks, and missing review gates.
- Enforce escalating requirements for R2 stateful and R3 high-consequence changes, including a separate named R3 reviewer and recovery evidence.
- Reject production `LIVE` assertions derived only from synthetic checks; distinguish an internal consistency check from real external validation.
- Run deterministic built-in Node tests with deliberate false-confidence cases.
- Provide structured JSON output suitable for future integration with GitHub Actions and an optional read-only DevonStation interface.
- Inspect a PR's current head SHA, exact-head checks, commit statuses and Actions runs using bounded, read-only GitHub API requests. Safely fetch up to 10 pages / 1,000 records in each collection without following untrusted pagination links; fail closed when records are missing or limits are exceeded. Recheck the PR for changes during inspection. Optionally corroborate supported review-receipt links against current GitHub run metadata. This does not prove test assertions, reviewer signatures, approvals or live behavior.

AIEI cannot independently reproduce a test, authenticate a human release decision, inspect arbitrary backend source, or observe a production deployment. The new adapter observes only selected GitHub-hosted metadata. It does not issue **GO** approval. Every assessment marks `independently_verified: false` and, at most, `ready_for_human_review: true`.

## Quick start

```sh
node --version                         # Requires Node 22+
npm ci --ignore-scripts
npm test
npm run check
npm run verify:examples

node bin/aiei.mjs validate contract examples/contract.json
node bin/aiei.mjs validate receipt examples/receipt.json
node bin/aiei.mjs assess examples/contract.json examples/receipt.json --json

# Optional live public GitHub observation (requires network access):
node bin/aiei.mjs inspect github <owner/repo> <pr-number> --json
node bin/aiei.mjs inspect github <owner/repo> <pr-number> --receipt <receipt.json> --json
```

The final `assess` command intentionally exits with code **1** because the supplied example is **NO_GO**; this is correct. The example is fictional and makes no claim that an external test was run. Exit codes: `0` structurally valid or successful **observed metadata check**, `1` invalid/blocked/incomplete/pending/failed, `2` unreadable input, unavailable API or invalid invocation. A `0` on `assess` means only *eligible for further human review*, never permission to merge, deploy or take action.

## Repository layout

| Path | Purpose |
| --- | --- |
| `lib/validate.mjs` | Dependency-free contract and receipt validation, strict field recognition and bounded arrays |
| `lib/assess.mjs` | Traceability, risk-tier gates and false-claim defense |
| `bin/aiei.mjs` | Contract/receipt CLI and optional read-only GitHub PR inspector |
| `lib/github-evidence.mjs` | Scoped GitHub REST reader with bounded multi-page exact-head observations, missing-check handling and optional receipt-link corroboration |
| `tests/` | Deterministic negative tests, CLI tests and fictional fixture tests |
| `examples/` | Fictional R2 contract and explicitly blocked review receipt |
| `docs/` | Trust model, human learning and release procedure |
| `.github/workflows/verify.yml` | Independent CI for **this project only**, after publication |

## Six-phase working loop

1. **Contract** — human defines outcome, original acceptance and adverse cases; freeze before implementation.
2. **Trace** — inspect the actual changed input → identity → service → data → output path.
3. **Build** — create a bounded change in the owning project's own repository.
4. **Challenge** — derive and execute independently specified failure cases; review architecture and security.
5. **Prove** — link source SHA, test environment, actual evidence, qualified human approval and observed deployment separately.
6. **Operate + learn** — preserve ownership, runbooks, incident response, recovery, and maintainer teach-back.

Use the real project's own repository and infrastructure as the source of truth. AIEI's local JSON files are portable **review packets**, not a replacement database for GitHub, Notion, CI or deployment-provider records.

## Safety

- Do not store passwords, API keys, mailbox contents, private family records, financial secrets, PHI or client data in review packets.
- A passed validation means **internally consistent assertions**, not safe software or trustworthy external evidence.
- Automated model reviews are supporting analysis, not independent human sign-off.
- R3 production changes need documented qualified review, authorization and tested recovery appropriate to the actual risk.
- The offline contract/receipt commands perform no network I/O. The optional GitHub command makes strictly read-only HTTPS GET requests to `api.github.com`, using a scoped token from `AIEI_GITHUB_TOKEN` if provided. No arbitrary code execution, telemetry, scheduled jobs, CI writes, repository mutation or GitHub permission changes are performed.

See [architecture](docs/ARCHITECTURE.md), [GitHub evidence and token scopes](docs/GITHUB-EVIDENCE.md), [release gates](docs/RELEASE-GATES.md), [learning](docs/LEARNING.md), [security](SECURITY.md), and [development roadmap](docs/ROADMAP.md).

## License

Apache-2.0. This allows independent open-source projects, including projects under stronger copyleft terms, to use AIEI without combining their repositories. License selection is limited to this independent toolkit; it does not relicense any other project.
