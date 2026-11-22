# csv-reader-speed-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/majika08/csv-reader-speed-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/majika08/csv-reader-speed-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, exact drop-in for csv-reader 1.0.0: it reads broken CSV files and returns byte-for-byte the same `{columns, rows, errors}` for every input, at about 5–6x the speed of the reference on the practice set. Dependency-free, single `solve.js` ES module.

## How it is fast

- `indexOf`-driven fast paths for clean spans; an exact per-character slow path only for fields with a lone CR or other broken constructs.
- A per-record CR classification (no CR / CR only as the CRLF terminator / general) that lets ~98% of lines skip per-field CR logic, with the unquoted fast path inlined into the record loop.
- Quote-free lines are split with a single `indexOf(',')` scan per field.
- No per-field objects; error objects are created only when an error actually occurs.
- The driver keeps the house baseline's setup (`--no-incremental-marking`, `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR`) and plain `JSON.stringify` for the output — a specialised writer was measured and discarded for being slower.

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

`main.ts` reads `cases.json` from the input directory, answers each case with `run()` from `solve.js`, and writes `answers.json` to the output directory.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
