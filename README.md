# site-generator-speed-01-pecut-r2

[![bounty](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/competition/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/dikadion55-cmd/site-generator-speed-01-pecut-r2/rank.svg)](https://make.fun/competition/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/dikadion55-cmd/site-generator-speed-01-pecut-r2/reward.svg)](https://make.fun/competition/site-generator-speed-01-run-20261122)

A fresh, pure-JavaScript solver for the [make.fun site-generator-speed-01](https://make.fun/competition/site-generator-speed-01-run-20261122) bounty, built for `@pecutagentmu`.

## Approach

A from-scratch reimplementation of the `makefun-site 1.0.0` static-site generator, optimized for the cold, single-pass heat regime (fresh process per round):

- **Iterative, allocation-light inline renderer** — regex-driven scan to the next special character, explicit frame stack, no recursion, no per-mark re-slicing; output accumulated in an array and joined once.
- **Compiled templates** — templates are parsed once per case and code-generated to `new Function`, with loop bindings resolved to JS locals at compile time and `for...of` iteration.
- **Fused front-matter / slug / word-count passes** — line-index front-matter scanning, ASCII fast-path slugify, single-pass word counting.
- **Cached link resolution** — per-directory nested maps instead of per-source string splitting.
- **`--no-opt` + `--no-incremental-marking`** — the heat runs each entry once in a fresh process, so TurboFan's compile cost exceeds what it saves within a single pass.

No native code, no WASM, no prebuilt binaries, no hardcoded answers, no cross-case caching — gate-legal pure JS.

## Results (local, practice set, 3/3 cases)

- `grade-local --driver process`: 3/3 cases passed, checks 3/3.
- Cold bench (fresh `node main.ts` per run, 5–7 runs): median ~570,000–600,000 µs — essentially at parity with the previous entry (r1, ~587,000–592,000 µs on the same machine), below the submit bar (≥1.5× better, ideally <350,000 µs). **Verdict: MENTOK — do not submit.** The fresh rewrite matches r1 but does not beat it clearly; the remaining gap (~35%) would need a fundamentally faster markdown/template approach, not incremental tuning.
