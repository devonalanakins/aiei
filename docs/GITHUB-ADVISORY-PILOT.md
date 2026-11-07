# GitHub evidence pilot — advisory only

**Status:** draft setup; this document does not claim live API acceptance, distribution, merge, or production deployment.

## Purpose

Exercise the existing bounded, read-only `inspectGitHubPR` implementation against **one public pull request**, without downloading application code, handling private data or executing project scripts. This pilot is scoped to [Merit issue #7](https://github.com/devonalanakins/merit/issues/7).

## Run

With Node.js 22+ from this development branch:

```sh
node --test tests/github-pilot.test.mjs
node bin/merit-pilot.mjs devonalanakins/merit 6
```

The second command uses unauthenticated public GitHub REST **GET** requests, no secrets or tokens, and emits a compact JSON report. The dedicated GitHub Actions pilot runs the same commands for this review branch. It does not run the inspected repository's code. Remote calls can fail from network, quota, API compatibility, or PR head races; these remain inconclusive, never passing evidence.

## Verdicts

- `INCOMPLETE`: missing, invalid, stale, or truncated required observation; CLI exits nonzero.
- `NO_EVIDENCE`: complete collection but no checks observed; not sufficient to approve anything.
- `OBSERVED_NOT_ALL_SUCCESSFUL`: at least one reported observation is pending, failed, skipped, or otherwise non-successful, or conflicts with its summary.

**Process exit status:** `0` is reserved for `OBSERVED_SUCCESS_ONLY` (complete, all-observed-success metadata, still advisory); `1` is returned for **every** other observation including failed, queued, pending, skipped, incomplete and no-evidence; `2` indicates an invalid invocation, unavailable API or another inspection error. Nonzero does not authenticate source or grant release authority.
- `OBSERVED_SUCCESS_ONLY`: all reported observations are successful and complete for the exact observed head, **not** qualified against required-check policy and not independently reproduced.

All outputs explicitly set provenance authentication, independent test execution, qualified required checks, human approvals, production verification, and release authorization to **false**. A JSON report from this script cannot certify itself. Results are advisory only.

## Acceptance and limits

- Observe a real GitHub PR, save CI run URL and exact head SHA; compare the visible API data independently.
- Validate positive and negative snapshots, including false-green summaries, incorrect SHA, skipped/queued checks, incomplete pages and no checks.
- Keep the pilot separate from merges, deployments, publishing and branch-protection changes.
- Resolve policy-qualified required-check selection, trusted witness provenance and human review in later independently audited work. The optional Rhen semantic adapter remains a separate experiment.
