# Release gates and decisions

Merit can identify missing claims and internally inconsistent evidence; it **cannot authorize** any release.

| Tier | Example | Minimum review |
| --- | --- | --- |
| R0 | Public-safe documentation | Factual accuracy and owning human approval |
| R1 | Reversible, non-sensitive UI | Relevant tests, source review and build |
| R2 | Stateful API, persistent data, integration | R1 plus negative security checks, concurrency/timeout or failure cases as relevant, recovery/retention, environment-specific acceptance and competent owner |
| R3 | Identity, credentials, regulated data, payment, migration, deletion | Explicit threat model, adverse cases, independently checked recoverability, qualified separate review and exact authorized signoff |

`IMPLEMENTED` means source exists. `VERIFIED` requires specifying a *particular* passing check, exact source and tested environment. `LIVE` requires actual deployment artifact identity and observed real end-user path. `RELEASE_NO_GO` may coexist with high-quality source and green isolated tests.

Merit validation produces errors, blockers and caveats. Do not map `ready_for_human_review` to an automatic green deployment button. Where a provider or human verification cannot be performed, preserve that uncertainty and continue as `RELEASE_NO_GO`.

For stacked PRs, assess upstream unmerged dependencies separately. Before merging any PR, inspect whether a merge would trigger an automatic production deployment. This toolkit performs no deployment operations.
