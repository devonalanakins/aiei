# Open-source distribution, portability and stewardship

AIEI is a standalone engineering-integrity toolkit under **Apache-2.0**. Its source, license, core CLI, validation library and engineering docs are intended to remain publicly inspectable, independently runnable, and usable without a proprietary AIEI service or per-seat subscription. The `LICENSE` file controls legal redistribution rights; this document is a project operating policy, not a new license.

## What users control

- Install or inspect the Node.js 22+ CLI and library; run contract/receipt validation locally with no network access and no required AIEI account.
- Use the optional GitHub evidence inspector only with explicitly authorized, least-privilege read access; no token is needed for offline evaluation.
- Preserve original contract and review records in their own repositories or chosen systems. AIEI does not take ownership of project code, credentials, business data, or deployment accounts.
- Fork, audit, modify and redistribute AIEI under the Apache-2.0 license. No proprietary-only AIEI feature tier or required vendor-managed control plane is part of this release.

## Evidence and limitation

Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`, `npm test`, and `npm run verify:examples`. The `open-source-release.test.mjs` tests additionally inspect **npm's dry-run distributable file list**. They reject mismatched license metadata, missing source/docs, nonexistent manifest paths, obvious private-file inclusions and unreviewed runtime dependencies.

Those checks are **publication hygiene only**. They are not a full license-compatibility or IP-rights audit, do not prove that source matches a deployed binary, cannot detect all secrets or malicious dependencies, and do not verify real service availability, accessibility, third-party code provenance, or legal compliance. Publishing a README or passing CI never authorizes an AIEI release or customer production deployment.

## Maintenance and contributions

Contributors follow [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md). Every meaningful change identifies its intended outcome, negative cases, exact tested revision and remaining unverified claims. Dependencies and licensing changes require an explicit compatibility and security review; the present core has zero third-party runtime dependencies.

AIEI is independent of DevonStation, ISL (still research-stage), Anevum, and client-owned software. This license does not change their separate ownership or automatically publish their sources. Clinical, personal, customer and other confidential data remain private even when an implementation is open source.
