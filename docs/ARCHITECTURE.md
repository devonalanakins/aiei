# AIEI core architecture — v0.3

**Status:** implemented local core, with optional read-only GitHub API metadata observation, not reproduction of tests or production release automation.

## Boundaries

- **Owner boundary:** AIEI operates independently of each product's GitHub repository, provider account, organization and data. AIEI never aggregates confidential data across entities.
- **Trust boundary:** JSON files, PR content, user instructions embedded in code, CI logs, model output and evidence links are untrusted input. Validation is *structural only*. Machine-produced declarations do not grant human authority.
- **Execution boundary:** Offline contract/receipt commands load <=1 MiB local JSON inputs and parse bounded arrays. GitHub inspection accepts only validated owner/repo and PR number, contacts pinned api.github.com GET endpoints with <=2 MiB response bounds, never follows redirects or untrusted Link destinations, and caps inspection at 10 pages / 1,000 records per collection. Neither mode executes scripts in a checked project, installs dependencies, edits repositories or deploys.
- **Source of truth:** The project's own GitHub and provider hold actual source/run/deployment state; AIEI packets refer to them but cannot independently reproduce their contents in v0.3.

## Contract object (`schema_version: 1`)

Required keys: `schema_version`, `contract_id`, `organization`, `repository`, `change_id`, `owner`, `risk_tier`, `data_classification`, `problem`, `acceptance_criteria`, `negative_cases`, `invariants`, `non_goals`, `target_environments`, `release_authority`, `recovery_plan`.

Optional: `base_sha`, `threat_model`. R3 requires a nonempty threat model. Enumerations: risk `R0`–`R3`, data `public | internal | restricted | regulated`, environments `synthetic | local | isolated | staging | production`. Unknown fields fail closed to avoid silent typos.

## Receipt object (compatible with AI Code Integrity Audit receipt v1)

Required: `schema_version`, `repository`, `change_id`, `head_sha`, `risk_tier`, `owner`, `status`, `release_decision`, `acceptance_criteria`, `negative_cases`, `checks`, `open_risks`, `approvals`.

Optional extensions: `contract_id`, `independent_reviewer`, `human_comprehension`, `production`, `notes`. For meaningful assessment, `contract_id` must match the frozen contract. Supported `status`: `IMPLEMENTED | VERIFIED | LIVE | RELEASE_NO_GO | BLOCKED`; release decision: `GO | NO_GO | UNDECIDED`.

Check rows must include `name`, `result`, `evidence`; AIEI optionally accepts and **requires for human-review readiness**: `observed_at`, `sha`, `environment`, `kind`, `covers` (exact strings copied from the original frozen acceptance/negative cases), `synthetic`. This is strict about exact commit matching and claims, not an attempt to prove that a supplied URL exists.

Approvals are named objects with a role, an explicit decision, timestamp and claimed evidence. Even a structurally present approval has not been cryptographically authenticated.

## Policy evaluation

1. Validate both inputs and required enumerations, objects, array lengths, SHA format and identifiers.
2. Check exact contract ID and organization repository, change, owner and risk-tier identity.
3. Ensure frozen acceptance and negative cases are unchanged and individually covered by passing exact-SHA check claims.
4. Reject unresolved risks and any failed, blocked, missing or not-run checks.
5. For R2/R3, demand at least one security check and a human comprehension record.
6. For R3, also demand recovery check, a separately named independent reviewer, and release-authority approval.
7. For `LIVE`, require a production observation with matching SHA, explicit non-synthetic production check and human approval.
8. Return `ready_for_human_review` at most. Return `independently_verified:false` always.

## Explicit anti-patterns

- A receipt saying `pass` without a pinned SHA cannot certify a changed branch.
- A source file not referenced in the built artifact is not production functionality.
- Passing synthetic D1 tests does not prove a Cloudflare D1 migration safe.
- A trusted browser session cookie and a correct UI state do not prove the API enforces tenant scope.
- An SMTP accept or payment-provider acknowledgement does not automatically prove downstream delivery or settlement.
- An independent AI model cannot impersonate a qualified human security reviewer.

## Later versions

P1: read-only GitHub PR metadata inspector is implemented (v0.3), with optional scoped token, bounded multi-page collection and current head comparison. Actual human signature/approval authentication remains unimplemented. The tool has not yet passed a live API acceptance test in this environment.
P2: reviewed static checks and project-specific build graph/source-to-artifact mapping.
P3: isolated real-provider verification and authorized ops gates.
P4: optional open protocol, package exports and UI consumers; no default hosted control plane.
