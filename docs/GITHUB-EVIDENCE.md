# GitHub evidence inspector — v0.3 (read-only)

## Scope and trust level

`aiei inspect github <owner/repo> <pr-number>` contacts **only** `https://api.github.com` through a bounded number of authenticated-or-public `GET` requests: a PR read, up to ten 100-item pages each for check runs, commit status contexts and Actions workflow runs, and a final PR reread to detect a changed head or lifecycle state. No more than 32 requests are made for one inspection. It does not execute the checked code, fetch arbitrary evidence URLs, read commit contents, inspect secrets or read application logs. No GitHub mutation, deployment, scheduled operation, provider-side reconfiguration or push access is requested.

Returned data is **GitHub API metadata**, not independently reproduced test behavior. A passing observation is neither proof that check coverage matches requirements nor evidence of a qualified human review, branch-protection rules, stacked-PR acceptance, actual deployment, or production correctness.

## Usage

```sh
node bin/aiei.mjs inspect github example/open-source-repo 31
node bin/aiei.mjs inspect github example/open-source-repo 31 --json
node bin/aiei.mjs inspect github example/open-source-repo 31 --receipt path/to/receipt.json --json
```

The last command attempts to corroborate the receipt's canonical GitHub Actions URLs (`https://github.com/<owner>/<repo>/actions/runs/<id>`) and check run URLs (`https://github.com/<owner>/<repo>/runs/<id>`) with the **same exact current PR head SHA**. Only supported recorded `pass`/`fail` results can match terminated remote runs; `blocked`, `not_run`, pending, stale or absent evidence cannot be marked corroborated. Coverage descriptions and human approvals remain unverified. Do not point the tool at clinical, client-private or organizational resources without verified authority to inspect them.

For a private repo, set an environment variable only in the permitted local/CI secret context, never in a shell command, committed file, chat or shared screenshot:

```sh
# Obtain the AIEI_GITHUB_TOKEN environment variable through your secure secret manager first.
node bin/aiei.mjs inspect github example/private-repo 31 --json
```

The variable name is `AIEI_GITHUB_TOKEN`. A minimal fine-grained GitHub token for private repositories may require **Metadata read**, **Checks read**, **Actions read**, **Commit statuses read**, and read access to PR metadata, subject to account restrictions. For public repositories no token may be needed until anonymous rate limits are reached. Avoid granting write permissions or reusing production deployment tokens. The variable is read from the environment, used only in request headers, and never returned in the report. This tool does not configure GitHub tokens itself.

## Safety and consistency checks

- Owner/repository and positive PR number are strictly validated before any request. No arbitrary API base URL is supported; redirects are rejected.
- Responses are limited to 2 MiB each. Invalid/malformed API responses, unrelated SHAs, changed PR heads, missing read permissions and network failures fail closed.
- Up to 1,000 items in each check-run, workflow-run and commit-status collection are inspected using fixed `per_page=100&page=N` API routes. External `Link` header URL destinations are **never followed**, even when they point to another domain. A later page that becomes empty/short prematurely, a changing `total_count`, mismatched commit state or duplicate run ID cannot produce a passing observation.
- More than 1,000 returned records, suspicious pagination headers or omitted pages result in **incomplete evidence**. A subsequent-page count or status mismatch may instead make inspection fail with an error. GitHub itself limits some check-run and workflow search API results to 1,000; even a complete reported collection is not a guarantee of exhaustive historical runs.
- The JSON output now includes `summary.pages_fetched` and the explicit per-collection item/page limits; do not interpret `collection_complete: true` as proof that branch-protection-required checks were configured or actually tested the intended feature.
- Only returned IDs/names/conclusions and bounded metadata are kept; secrets, message bodies, request headers, and raw third-party URLs are never included.
- All results describe the commit observed **during that request**, not a pinned immutable release approval. A new commit must be inspected again.
- A passing run recorded by GitHub does not mean the job tests what it claims or that an artifact is deployed. No human identity or signature is authenticated by Merit.

Exit codes: `0` means a complete observation with all **observed** checks successful (and, when provided, all supported receipt links corroborated). `1` means a completed inspection found pending, failing, incomplete or contradictory check metadata. `2` means invalid invocation, bad input, unavailable API or unsupported response. **None is a release authorization.** The CLI is intentionally advisory and does not create required branch checks, merge PRs or deploy software.

## First real pilot and gaps

With the existing public repository renamed to `devonalanakins/merit`, verify exact-head CI for Merit itself and separately inspect an existing public-safe PR (candidate: DevonStation Communications #31, without reading mail data). Compare observed checks against an independently written acceptance contract. Keep project and Merit files in separate repositories. Future work should read branch-protection-required checks and produce a reusable verified-attestation or provenance artifact; neither capability exists in v0.3.

GitHub REST references: [pull requests](https://docs.github.com/en/rest/pulls/pulls), [check runs](https://docs.github.com/en/rest/checks/runs), [commit statuses](https://docs.github.com/en/rest/commits/statuses), [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs).
