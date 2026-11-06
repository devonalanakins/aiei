# Merit offline claim evidence v1 — experimental

Status: source implementation in a draft PR, not released, not authenticated provenance.

The new lib/evidence-graph.mjs evaluates bounded merit.evidence.v1 packets against separately supplied merit.policy.v1 JSON input. Run:

    node bin/merit-evidence.mjs packet.json trusted-policy.json

Exit code 0 means conditional structural SUPPORTED_WITH_SCOPE only; 1 means withheld/refuted/blocked; 2 means unreadable/malformed input. This does not replace existing AIEI CLI, contracts or receipts.

Evidence records identify exact repository and commit, source and validated IR SHA-256, language subset, JS/Python artifacts, toolchains, expected stdout/trap, producer run and attempt identifiers, independent oracle requirements, scope, unsupported regions and outstanding obligations. Verdicts include REFUTED, INSUFFICIENT, OUT_OF_SCOPE, STALE, UNTRUSTED_SOURCE and POLICY_BLOCKED.

The experimental `merit.policy.v1` schema now **requires** `predicate` and `scope` fields matching the evidence packet exactly, including ordered `scope.targets`. Claim wording or scope changes produce `POLICY_BLOCKED` even if the witness traces match. Missing, malformed or extra policy fields remain `INSUFFICIENT`. The separately supplied policy must be amended and reviewed to broaden a claim; editing a packet alone cannot authorize broader coverage. This deliberately strengthens the as-yet-unreleased draft schema, so older experimental policy JSON files without these fields must be updated before use.

Reject duplicate JSON keys, forged source/IR identities, reused runs, missing witnesses, contradictions, stale artifacts, untrusted toolchains and cyclic/dangling evidence dependencies. A policy object is assumed to come from an independently trusted source; a packet-supplied digest alone is not a trust anchor. The output always states independently_verified=false, provenance_authenticated=false, release_authorized=false.

Reproduce the bounded cross-repository experiment using Merit integration/rhen-to-merit.test.mjs and a checkout of explicit Rhen commit 827d5640da195d06f88321a7e0c5d386845027cc placed in rhen-checkout/. Then run node --test integration/rhen-to-merit.test.mjs. The separate CI workflow automates this only for the approved pinned program and commit; no arbitrary repository execution.


## Experimental pinned signature preflight — checkout only

The additive \`lib/policy-signature.mjs\` verifies a detached **Ed25519** signature over the **exact UTF-8 JSON policy bytes** using \`Merit.policy.signature.v1\0\` as a domain-separation prefix. It requires the operator to provide an **out-of-band approved SHA-256 fingerprint of the public key's DER SPKI**. The fingerprint and PEM key must not be accepted as mutually trusted merely because both arrived in the untrusted policy envelope.

\`verifyPinnedPolicySignature({policyText, signatureBase64, publicKeyPem, trustedKeySha256})\` rejects missing or incorrect pins, non-Ed25519 keys, invalid/ambiguous JSON, invalid policy schemas, malformed base64, incorrect signatures, and tampered bytes. It returns \`PINNED_SIGNATURE_VALID\` only when the key matches the externally provided pin, the detached signature matches the exact domain-separated bytes, and the policy schema validates.

\`evaluateWithPinnedPolicy(packet, signatureInputs)\` rejects the claim with \`POLICY_BLOCKED\` if signature preflight fails; otherwise it calls the existing bounded graph evaluator using the verified policy. A supported graph result may set \`policy_signature_verified:true\` and \`policy_key_pin_matched:true\` but **always** keeps \`independently_verified:false\`, \`provenance_authenticated:false\`, \`witness_signatures_verified:false\`, \`human_authorization_verified:false\`, and \`release_authorized:false\`. This only verifies the mathematical relationship between signed bytes and a *caller-configured, separately pinned* key. It cannot prove how that trusted key pin was chosen or that the signer was authorized by the actual project owner.

This module is **experimental source-only** in the review branch, explicitly excluded from the npm \`files\` allowlist. No production key, private signing key, trust store, signature distribution, or automated release authority is provisioned. The tests create only ephemeral synthetic Ed25519 signing keys and never store a private key in the repository. Node.js 22+ built-in crypto is sufficient, with no third-party dependencies.

Before implementing enforcement, independently provision the signing key pin, define an owner-controlled signer identity and key-rotation/revocation procedure, define policy validity/replay windows and digest canonicalization where interoperability is required, and separately verify signed witness execution attestations. Ed25519 on a policy does **not** attest the behavior of JS/Python/Rhen, the authenticity of the submitter, or a human GO decision.


## Experimental operator registry lifecycle — checkout only

The separate `lib/policy-trust.mjs` module adds an **offline, advisory-only** operator-registry check around the Ed25519 signature preflight. It does **not** establish an independently trusted operator, make the public npm package enforce any policy, or attest runtime witnesses.

An operator-supplied `merit.policy-trust-registry.v1` registry contains:
- `epoch`: positive, strictly monotonic integer supplied along with an **independently maintained minimum trusted epoch** (a local caller-controlled value is not anti-rollback security).
- `repository` and `claim_id`: exact policy scope.
- `keys`: 1–16 Ed25519 SPKI SHA-256 fingerprints with `active`/`revoked` status and UTC validity windows.
- `policies`: 1–64 approved policy JSON digests tied to signer fingerprints and UTC validity windows.

All timestamps are strict `YYYY-MM-DDTHH:mm:ssZ`, with an inclusive `valid_from` and exclusive `valid_until`. Signer revocation overrides an otherwise valid signature; changes to the allowed registry and the independent epoch high-water mark are **outside** this module's authority. It rejects duplicate/unknown fields and records, unknown or revoked signers, invalid windows, unsigned/modified policies, incorrect claim or repository, stale epochs, and unapproved or expired policy digests. Rotation is represented by a higher trusted epoch with a new active signer and previously authorized key marked revoked; no keys are generated, persisted, fetched, or published.

`checkOperatorPolicyRegistry({policyText, signatureBase64, publicKeyPem, trustRegistryText, minimumTrustedEpoch, observedAt})` reports `OPERATOR_REGISTRY_MATCH` only when the caller-supplied registry is structurally consistent and its active approved key, signature, policy hash, repository/claim and UTC windows match. `observedAt` is explicitly injectable for deterministic synthetic tests; accepting an arbitrary caller-chosen time in a security decision would allow replay and is **not production safe**. A trusted host clock and persistent authenticated epoch high-water mark are required before enforcement.

`evaluateWithOperatorRegistry(packet, options)` gates the existing bounded evidence graph on that check; a failed preflight returns `POLICY_BLOCKED`. A supported structural result is **still not authenticated witness execution**. Every result retains `independently_verified:false`, `provenance_authenticated:false`, `policy_origin_independently_authenticated:false`, `witness_signatures_verified:false`, `human_authorization_verified:false`, and `release_authorized:false`. Critically, an attacker who supplies **both their own valid key and a self-serving registry** can also obtain `OPERATOR_REGISTRY_MATCH` in this standalone experiment. Treat it as a cryptographic-and-schema rehearsal, not an authorization oracle.

No actual signing keys, persistent trusted key registry, protected storage, key rotation, revocation service, timestamp authority, or production policy decisions were created. This is intentionally source-only and excluded from the published package allowlist. Future operational implementation requires independent key ownership and custody, authenticated registry distribution, monotonic counter persistence resistant to rollback, a trusted clock, independently sourced policy approvals, witness signing and real human release controls.

Policy digestJSON uses JSON.stringify order, not interoperable canonical JSON. A malicious submitter can fabricate unsourced witness metadata. Full trust-chain verification, generalized graph types, human authorization, signed attestations and formal correctness remain outside this initial vertical slice.
