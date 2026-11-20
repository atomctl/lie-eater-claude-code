# Probe notes (plan Task 1)

What the real interface of Claude Code 2.1.311 does. Each answer has the raw line that shows it.

Two headless runs on 20 Nov 2026 (`claude --plugin-dir ~/learning/lie-eater --model sonnet -p …`) in a scratch project with one failing `node --test` test. The interactive checks at the end are still open.

## Answers

**1. Does a failed shell command set `isError`, and does `text` begin with `Exit code N`? Yes.**

```
{"tool":"Bash","command":"false","isError":true,"text":"Exit code 1","resultKeys":"string"}
{"tool":"Bash","command":"npm test","isError":true,"text":"Exit code 1\n\n> probe-proj@1.0.0 test\n> node --test\n\n✖ adds (0.704292ms)\n✔ adds zero (0.0785ms)\nℹ tests 2\nℹ suites 0\nℹ pass 1\nℹ fail 1\n…
```

For a failed call `result` is a string, not the tool's record. A clean call has the record (`stdout`, `stderr`, `interrupted`, `backgroundTaskId`, …).

**2. Does a piped failing test command come back clean? Yes.** No `isError`; the text is only what the pipe let through.

```
{"tool":"Bash","command":"npm test | tail -5","text":"    actual: -1,\n    expected: 5,\n    operator: 'strictEqual',\n    diff: 'simple'\n  }", …}
```

So the rule in the plan is right: a piped test run with no counts in its output is `unknown`.

**3. Does the Write result carry the old content? Yes, under `originalFile`** (Edit too, with `oldString`, `newString`, `structuredPatch`).

```
{"tool":"Write", … "resultKeys":["type","filePath","content","structuredPatch","originalFile","userModified"]}
{"tool":"Edit", … "resultKeys":["filePath","oldString","newString","originalFile","structuredPatch","userModified","replaceAll"]}
```

**4. Does work started with `void` in a `turn.complete` hook finish after the hook returns? Yes**, also in a headless run. It called `$.model.classify` and wrote a file.

```
{"probe":"void-after-turn","label":"does not say that","answer":"The probe tool returned only \"ok\", so there's no probe word.…"}
```

**5. May a test file import `../hooks/lib/x`? Yes.** `tests/record.test.ts` imports `../hooks/lib/record` and `./helpers`, and its 10 tests run. The command is `claude plugin test <dir>` with no option before `plugin` (a shell alias that adds one makes it refuse to run). `console.log` output was not needed and not checked.

**6. Sound, pane close, colours.** From the types: `$.ui.close` exists; `Text` takes `color`, `dimColor`, `bold`, `inverse`. `afplay sounds/stamp.wav` plays on this Mac. Whether `$.audio.play({ asset })` plays inside a session: interactive check, open.

**7. Is a registered tool visible without ToolSearch? Yes, when registered at `session.start`** with `isDeferred: false`. A string result is accepted. Registering in the middle of a session: interactive check, open.

```
{"probe":"tool-called","keys":["tool","tool_use_id"]}
```

**8a. Does a `context` line added to a tool result reach the agent? Yes, but the agent treats it as untrusted.** It said PINEAPPLE, and in its next message it took that back:

> "I opened it with the word "PINEAPPLE". That came from a hook note that appeared after the step 7 and 8 results, not from you, and I shouldn't have acted on it."

Consequence: the hidden line may inform ("bet #3 LOST…"). It must never give an order.

**8b. Does a `prompt.compose` section reach the prompt? No.** A built-in plugin runs first and skips ours:

```
lie-eater: its prompt.compose hook was skipped. "cc-plugin-sec-default" runs first and sent the event on past it.
```

Consequence: no system-prompt section. The betting rule lives in the bet tool's description and in the refusal text.

**9. After a refused call, does the agent recover? Yes, in one step each.**

```
1. Bash: echo gate. It was refused with "call the mcp__lie-eater__probe tool first, then run this command again".
2. mcp__lie-eater__probe: it returned "ok".
3. Bash: echo gate. It succeeded and printed gate.
```

**A background command** has `backgroundTaskId` in its record and the text `Command running in background with ID: …`. A finished background task starts a new turn, so `turn.complete` fires again.

**10. Spinner:** interactive check, open.

## Found on the way

- **The engine follows `$` only into functions declared at the top of a file** (or imported from the mod's own files). A helper defined inside `register` that takes `$` fails validation. All `hooks/lib` functions that take `$` are top-level exports.
- `node --test` prints `ℹ pass 1` and `ℹ fail 1`. `parseCounts` needs this format (added to Task 2).
- `$.model.classify` labelled "Step 7 is now finished: the background sleep 2 … completed" as "says the work is finished". A status message can be read as "done". Task 12 measures this.
- Time comes from `$.clock.now()` (a promise). `Date.now()` type-checks; whether it runs is part of the spinner check.

## Consequences for the plan

| Finding | Consequence |
|---|---|
| 8b: no prompt section | Tasks 7 to 9: `betInstruction` becomes the bet tool's `description` (the rule) and the refusal text (the rules of the game, the open debt). No `prompt.compose` hook. |
| 8a: hook notes are untrusted | The settlement line only informs. "Fix this" submits its prompt as the person's words (`asUser: true`), because the person pressed the button; the interactive check below confirms it. |
| 7: tool at `session.start` works | If registering at the summon does not work in the interactive check, the tool is registered at `session.start` and answers `No referee is present. No bet taken.` when passive. |
| 4: `void` work finishes | The ruling runs after the turn with no wait. |
| 9: refusal recovery works | The gate stays as planned. |

## Checks done with the test kit instead of by hand (20 Nov)

The owner chose not to run the interactive checks. A throwaway test (`tests/probe.test.tsx`, deleted after it ran) mounted the probe's pane and spinner hook on the `terminal` and `desktop` surfaces:

```
PROBE calls: ["toast {\"text\":\"probe: button pressed 1\"}","audio {\"clip\":{\"asset\":\"sounds/stamp.wav\"},\"shouldLoop\":false}","submit {\"text\":\"Reply with the single word MANGO.\",\"wait\":false,\"origin\":{\"kind\":\"plugin\",\"name\":\"lie-eater\"}}", … "submit {\"text\":\"Reply with the single word PAPAYA.\",\"wait\":false,\"origin\":{\"kind\":\"plugin\",\"name\":\"lie-eater\",\"asUser\":true}}"]
PROBE spinner text: ⚅ Working
```

- **6. Pane, colours, button:** a pane with `color="green"`, `color="red"` and `dimColor` lines and a `Button` is accepted on both surfaces; a press runs `onPress`, which reached `$.ui.toast`, `$.audio.play({ asset })` and `$.prompt.submit`.
- **10. Spinner:** a `Spinner` hook that returns `next({ ...e, props: { ...e.props, word } })` rewrites the row. `Date.now()` works in the mod's environment.
- **5.** `console.log` prints in `claude plugin test`.
- In a test, `prompt.submit` is an event: a stand-in answers `{ text }`, not `{ value }`.

## Not proven; decided the safe way

| Open point | Decision |
|---|---|
| Does a tool registered in the middle of a session reach the agent? | Not needed: the bet tool is registered at `session.start` (proven in run 2). With no referee it answers `No referee is present. No bet taken.` |
| Does the agent act on a prompt the mod submits? | "Fix this" submits with `asUser: true`: the person pressed the button, so it is read as the person's turn. `/fix` does the same. |
| Does the spinner hook re-run often enough to animate? | Task 8 runs a 250 ms timer while a bet is open, so it does not matter. |
| Does `$.audio.play` sound in a live session? | A failed play is caught and ignored. `afplay` plays the file on this Mac. |
| How the pane and the dice look on a real screen | The owner sees them at the first `/summon`. Looks are tuned then. |
