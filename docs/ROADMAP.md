# Delivery roadmap — factual status

## P0 — IMPLEMENTED/LOCAL VERIFIED standalone toolkit (v0.1)

Scope: one self-contained repository; offline work contract validation, receipt assessment, exact-head traceability, release misrepresentation checks, safe synthetic examples and regression tests. No service, no storage, no credentials. This is a working first increment, not the entire product.

## P1 — ACTIVE local v0.3; real API validation BLOCKED

Implemented read-only GitHub PR evidence inspector with exact-head recheck, up to 10 pages/1,000 observations per collection, CI/check-run metadata and optional receipt-link matching. Malformed, missing, contradictory and oversized pages fail closed. API interactions are tested using synthetic in-memory responses; direct live API validation and publication remain blocked pending network/remote access. Finish the first real read-only pilot against an existing project's PR using only public-safe material. Produce independent negative cases, human teach-back, a complete review packet and a useful measured baseline. The independent repository now exists as `devonalanakins/merit`; the unchanged `aiei` CLI remains a compatibility identifier. Independently verify a live read-only GitHub pilot before release claims. Do not inject Merit source into the pilot project's repository.

## P2 — BACKLOG

Provide a reusable advisory GitHub check that runs as a versioned *external tool*, not copied application code; extend the implemented GitHub metadata adapter with stable required-check and protection-rule comparison under scoped read-only access. Test with intentionally defective synthetic PRs. Do not enable required checks before stability and cost are demonstrated.

## P3 — BACKLOG

Extend to isolated provider receipts, recovery checks and least-privilege review workflows. Do not create broad-privilege agents or unapproved production connections.

## P4 — BACKLOG

Introduce read-only dashboards, interactive source traces and maintainer learning progress on demand. Identity and data boundaries follow the owning project. No default centralized collection, monitoring or extra paid infrastructure.
