# Open-source distribution, portability and stewardship

AIEI is a standalone engineering-integrity toolkit under **Apache-2.0**. Its source, license, core CLI, validation library and engineering docs are intended to remain publicly inspectable, independently runnable, and usable without a proprietary AIEI service or per-seat subscription. The `LICENSE` file controls legal redistribution rights; this document is a project operating policy, not a new license.

## What users control

- Install or inspect the Node.js 22+ CLI and library; run contract/receipt validation locally with no network access and no required AIEI account.
- Use the optional GitHub evidence inspector only with explicitly authorized, least-privilege read access; no token is needed for offline evaluation.
- Preserve original contract and review records in their own repositories or chosen systems. AIEI does not take ownership of project code, credentials, business data, or deployment accounts.
- Fork, audit, modify and redistribute AIEI under the Apache-2.0 license. No proprietary-only AIEI feature tier or required vendor-managed control plane is part of this release.

## Evidence and limitation

From a Git checkout, run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`, `npm test`, and `npm run verify:examples`. The `open-source-release.test.mjs` tests inspect **npm's dry-run distributable file list** and the latest imported runtime module inventory. They reject mismatched license metadata, missing source/docs/examples/README artwork, nonexistent manifest paths, obvious private-file inclusions and unreviewed runtime dependencies.

The `packed-install.test.mjs` test also creates a real tarball, installs it into a temporary consumer project with an empty npm cache, `--offline` and lifecycle scripts disabled, and exercises the installed `aiei` CLI, the offline evidence CLI and the complete bare-specifier library export outside the checkout. It checks valid examples, rejected invalid/malformed input, and the deliberately blocked synthetic `NO_GO` assessment. It never calls the optional live GitHub inspector. Temporary packages and consumer files are removed after the test, including on failure.

Those checks are **publication hygiene only**. They are not a full license-compatibility or IP-rights audit, do not prove that source matches a deployed binary, cannot detect all secrets or malicious dependencies, and do not verify real service availability, accessibility, third-party code provenance, or legal compliance. Publishing a README or passing CI never authorizes an AIEI release or customer production deployment.

## Offline package rehearsal

Requires Node.js 22+, npm and a POSIX shell. From a verified Git checkout, create a local archive without publishing or running lifecycle scripts:

```sh
npm pack --ignore-scripts --offline
```

In a separate empty directory, install the archive using the absolute path printed by your own checkout location plus the filename reported by `npm pack`:

```sh
npm init -y
npm install --offline --ignore-scripts --no-audit --no-fund /absolute/path/to/aiei-engineering-integrity-0.3.1.tgz
./node_modules/.bin/aiei --help
./node_modules/.bin/aiei validate contract node_modules/aiei-engineering-integrity/examples/contract.json --json
./node_modules/.bin/aiei validate receipt node_modules/aiei-engineering-integrity/examples/receipt.json --json
./node_modules/.bin/aiei assess node_modules/aiei-engineering-integrity/examples/contract.json node_modules/aiei-engineering-integrity/examples/receipt.json --json
```

The last command must exit **1** with `ready_for_human_review: false`: the supplied receipt is synthetic and `NO_GO`. Invalid schema input exits **1**; malformed JSON exits **2**. Library consumers can use `import { validateContract, validateReceipt, assess } from 'aiei-engineering-integrity'` from their own ESM code. These steps need no AIEI account, registry publication, hosting provider or GitHub credentials. They verify local package behavior, not live GitHub API acceptance or release authorization.

The tarball includes the explicitly reviewed offline and read-only runtime exports, the standalone offline `bin/merit-evidence.mjs` CLI (invoked through Node), docs, synthetic examples and README artwork. The experimental `bin/merit-pilot.mjs` and `lib/github-pilot.mjs` remain checkout-only while the GitHub live pilot is reviewed; neither is part of the distributable. Development tests, `package-lock.json`, `AGENTS.md` and CI configuration remain in the public Git repository; run development commands such as `npm ci` and `npm test` from that checkout, not the installed package. The existing Apache-2.0 terms and per-project ownership boundaries are unchanged.

## Explicit distribution boundary

`package.json` lists each distributable file individually. Directory entries and glob patterns are not accepted by the release tests. Apart from npm's required `package.json`, every packed file must appear in that list and every listed file must exist as a regular file and actually be packed. Adding a file to `lib`, `bin`, `docs` or `examples` alone does not publish it. Add a new public file to the list deliberately, review its contents and rights, then run the complete tests.

An isolated packaging regression places synthetic extra source, cache, export, CSV and artwork files beside the selected files and verifies that npm excludes them while retaining the required materials. This reduces accidental inclusion; it is not a content scanner and cannot establish publication rights or detect secrets inserted into an already listed file. Review all included content before publishing.

## Source fidelity and rights-review gate

The package rehearsal checks the explicit file manifest, compares the SHA-256 of **each declared distributable file** in the source checkout with the separately installed package, and deliberately tampers with an installed file to prove mismatch detection. These checks cover the bytes transferred from the tested checkout to a disposable npm consumer. They do **not** establish who authored the source, whether the checkout is trusted, whether a registry publisher has permission to distribute it, or whether a released artifact matches this build. No signed source or registry provenance attestation is produced.

The reviewed v0.3.1 candidate currently declares 21 distributable files (plus npm-required `package.json`). Inspection of its seven packaged JavaScript module and CLI source files found only relative internal modules and Node.js built-in imports; the manifest and lockfile declare zero third-party runtime dependencies. The included SVG uses inline shapes/gradients/text with no external image/font imports. The documented Apache-2.0 license and matching package metadata were observed. This is a **source inspection**, not independent authorship, copyright, license-chain, trademark or legal clearance.

Before approving an actual registry release, a qualified human maintainer must separately:
- Establish the authorship and redistribution rights for the code, documentation, examples and SVG artwork in the final archive, including any AI- or externally-assisted contributions.
- Determine whether notices, original attribution or third-party licenses must be preserved or added; a missing `NOTICE` file is not proof that no notices are owed.
- Check the exact final released commit, expected package owner and registry destination, and compare signed/independently anchored release provenance when available.
- Review all final bundled bytes for secrets, unauthorized confidential content and unexpected inclusions, including edited text inside otherwise allowlisted paths.
- Re-run package inventory, clean offline consumer installation, explicit tamper test and supported public API smoke checks at the final release commit. Require separate owner approval for registry publication.

**Release status:** Source and package integrity checks can pass while rights, human authorization, trusted artifact origin, and production deployment remain **unverified / NO_GO**. No test in this repository automatically grants publication permission.

## Maintenance and contributions

Contributors follow [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md). Every meaningful change identifies its intended outcome, negative cases, exact tested revision and remaining unverified claims. Dependencies and licensing changes require an explicit compatibility and security review; the present core has zero third-party runtime dependencies.

AIEI is independent of DevonStation, Rhen (still research-stage), Anevum, and client-owned software. This license does not change their separate ownership or automatically publish their sources. Clinical, personal, customer and other confidential data remain private even when an implementation is open source.
