# Security and disclosure

AIEI processes local JSON packets and offers a bounded GitHub PR metadata inspection command. It must never request deployment or production credentials, fetch arbitrary untrusted evidence links, or execute project-provided code during assessment. Optional GitHub read access uses `AIEI_GITHUB_TOKEN` from the environment only, not files or CLI arguments. A passing schema or policy check **does not certify software**, authenticate CI logs, verify reviewers, confirm legal compliance or grant a release approval.

Do not submit personal information, mailbox contents, secrets, cryptographic keys, client records, employee information or healthcare records in tickets, synthetic fixtures or public bug reports. When reporting a vulnerability, initially describe a sanitized reproduction without production data.

Threats to consider: forged evidence, modified or replayed commit references, malicious strings in repository content, unauthorized release claims, cross-entity data access, CI permission escalation, plugin supply-chain compromise and use of AI-generated test results as independent proof.

The offline commands make no network calls. GitHub inspection uses only HTTPS GET to `api.github.com`, rejects redirects, bounds responses and sanitizes request failures. GitHub Actions CI still requests `contents: read` only. The code and dependencies should still receive normal human review prior to external distribution.
