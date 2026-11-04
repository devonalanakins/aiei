# Merit offline claim evidence v1 — experimental

Status: source implementation in a draft PR, not released, not authenticated provenance.

The new lib/evidence-graph.mjs evaluates bounded merit.evidence.v1 packets against separately supplied merit.policy.v1 JSON input. Run:

    node bin/merit-evidence.mjs packet.json trusted-policy.json

Exit code 0 means conditional structural SUPPORTED_WITH_SCOPE only; 1 means withheld/refuted/blocked; 2 means unreadable/malformed input. This does not replace existing AIEI CLI, contracts or receipts.

Evidence records identify exact repository and commit, source and validated IR SHA-256, language subset, JS/Python artifacts, toolchains, expected stdout/trap, producer run and attempt identifiers, independent oracle requirements, scope, unsupported regions and outstanding obligations. Verdicts include REFUTED, INSUFFICIENT, OUT_OF_SCOPE, STALE, UNTRUSTED_SOURCE and POLICY_BLOCKED.

Reject duplicate JSON keys, forged source/IR identities, reused runs, missing witnesses, contradictions, stale artifacts, untrusted toolchains and cyclic/dangling evidence dependencies. A policy object is assumed to come from an independently trusted source; a packet-supplied digest alone is not a trust anchor. The output always states independently_verified=false, provenance_authenticated=false, release_authorized=false.

Reproduce the bounded cross-repository experiment using Merit integration/rhen-to-merit.test.mjs and a checkout of explicit Rhen commit 1ccc3564b315b91f932fde3df97ab88cbb30d6cc placed in rhen-checkout/. Then run node --test integration/rhen-to-merit.test.mjs. The separate CI workflow automates this only for the approved pinned program and commit; no arbitrary repository execution.

Policy digestJSON uses JSON.stringify order, not interoperable canonical JSON. A malicious submitter can fabricate unsourced witness metadata. Full trust-chain verification, generalized graph types, human authorization, signed attestations and formal correctness remain outside this initial vertical slice.
