# Merit repository contribution instructions

- Keep Merit a separate independent repository; do not move DevonStation, Anevum or client code into this tree.
- Node 22+ and zero runtime dependencies in the core. Use synthetic examples, no real credentials or private user data.
- New security/release rules require independently specified negative tests and a clear explanation of whether they check structure, authenticate evidence or observe real runtime behavior.
- GitHub inspection may use only read-only GET requests to api.github.com, with bounded response and secret-safe errors. Tests must prove stale, incomplete, invalid and queued results are never misrepresented.
- Merit's compatibility CLI (`aiei`) must not deploy, merge, send emails, move money, modify authorization, execute arbitrary project-provided scripts or certify human review.
- Preserve the distinction between `IMPLEMENTED`, scoped `VERIFIED`, actual `LIVE` and release `NO_GO`.
- Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`, `npm test`, `npm run verify:examples` before proposing changes.
- Document major contract/receipt schema changes and provide backward compatibility or deliberate version migration.

Merit is the public product name; the existing `aiei` executable, package name, and review-packet schemas remain unchanged compatibility interfaces until a separately tested migration.
