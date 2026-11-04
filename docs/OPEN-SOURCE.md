# Open-source distribution, portability and stewardship

AIEI is a standalone engineering-integrity toolkit under **Apache-2.0**. Its source, license, core CLI, validation library and engineering docs are intended to remain publicly inspectable, independently runnable, and usable without a proprietary AIEI service or per-seat subscription. The `LICENSE` file controls legal redistribution rights; this document is a project operating policy, not a new license.

## What users control

- Install or inspect the Node.js 22+ CLI and library; run contract/receipt validation locally with no network access and no required AIEI account.
- Use the optional GitHub evidence inspector only with explicitly authorized, least-privilege read access; no token is needed for offline evaluation.
- Preserve original contract and review records in their own repositories or chosen systems. AIEI does not take ownership of project code, credentials, business data, or deployment accounts.
- Fork, audit, modify and redistribute AIEI under the Apache-2.0 license. No proprietary-only AIEI feature tier or required vendor-managed control plane is part of this release.

## Evidence and limitation

From a Git checkout, run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`, `npm test`, and `npm run verify:examples`. The `open-source-release.test.mjs` tests inspect **npm's dry-run distributable file list**. They reject mismatched license metadata, missing source/docs/examples/README artwork, nonexistent manifest paths, obvious private-file inclusions and unreviewed runtime dependencies.

The `packed-install.test.mjs` test also creates a real tarball, installs it into a temporary consumer project with an empty npm cache, `--offline` and lifecycle scripts disabled, and exercises the installed CLI and bare-specifier library import outside the checkout. It checks valid examples, rejected invalid/malformed input, and the deliberately blocked synthetic `NO_GO` assessment. It never calls the optional live GitHub inspector. Temporary packages and consumer files are removed after the test, including on failure.

Those checks are **publication hygiene only**. They are not a full license-compatibility or IP-rights audit, do not prove that source matches a deployed binary, cannot detect all secrets or malicious dependencies, and do not verify real service availability, accessibility, third-party code provenance, or legal compliance. Publishing a README or passing CI never authorizes an AIEI release or customer production deployment.

## Offline package rehearsal

Requires Node.js 22+, npm and a POSIX shell. From a verified Git checkout, create a local archive without publishing or running lifecycle scripts:

```sh
npm pack --ignore-scripts --offline
```

In a separate empty directory, install the archive using the absolute path printed by your own checkout location plus the filename reported by `npm pack`:

```sh
npm init -y
npm install --offline --ignore-scripts --no-audit --no-fund /absolute/path/to/aiei-engineering-integrity-0.3.0.tgz
./node_modules/.bin/aiei --help
./node_modules/.bin/aiei validate contract node_modules/aiei-engineering-integrity/examples/contract.json --json
./node_modules/.bin/aiei validate receipt node_modules/aiei-engineering-integrity/examples/receipt.json --json
./node_modules/.bin/aiei assess node_modules/aiei-engineering-integrity/examples/contract.json node_modules/aiei-engineering-integrity/examples/receipt.json --json
```

The last command must exit **1** with `ready_for_human_review: false`: the supplied receipt is synthetic and `NO_GO`. Invalid schema input exits **1**; malformed JSON exits **2**. Library consumers can use `import { validateContract, validateReceipt, assess } from 'aiei-engineering-integrity'` from their own ESM code. These steps need no AIEI account, registry publication, hosting provider or GitHub credentials. They verify local package behavior, not live GitHub API acceptance or release authorization.

The tarball includes runtime source, docs, synthetic examples and README artwork. Development tests, `package-lock.json`, `AGENTS.md` and CI configuration remain in the public Git repository; run development commands such as `npm ci` and `npm test` from that checkout, not the installed package. The existing Apache-2.0 terms and per-project ownership boundaries are unchanged.

## Maintenance and contributions

Contributors follow [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md). Every meaningful change identifies its intended outcome, negative cases, exact tested revision and remaining unverified claims. Dependencies and licensing changes require an explicit compatibility and security review; the present core has zero third-party runtime dependencies.

AIEI is independent of DevonStation, ISL (still research-stage), Anevum, and client-owned software. This license does not change their separate ownership or automatically publish their sources. Clinical, personal, customer and other confidential data remain private even when an implementation is open source.
