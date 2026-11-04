# Contributing

Submit a small issue or pull request that states the original acceptance case, an independently derived failure/abuse case, and how you will demonstrate correctness. Show the changed files, exact commands and outcomes, any trust limitations, whether source-only or runtime behavior was tested, and the applicable R0–R3 risk category.

No source change is production verified solely because tests are green. Source authors and human reviewers are accountable for their own decisions; Merit reports never imply legal or security certification. Do not include secrets, private account details or data belonging to another entity.

Run `npm run check && npm test && npm run verify:examples`. In reviews, note any environment-specific tests that could not run. Do not weaken existing regression or CI protections to obtain green checks.
