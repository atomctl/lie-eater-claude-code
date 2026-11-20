# Field report: one real mod, 214 tests, 167 games

> **DRAFT, not posted.** Written for the Claude Code team's thread on mods (issue 91870), where they ask for critical feedback. The owner of this repository posts it under their own name, or not at all. Everything below was seen on build 2.1.311 on 20 Nov 2026; check the newest build before posting, because some of it may be fixed.

I built a mod that uses most of the interface: a referee that makes the AI bet before each test run and rules on "done" from the tool record. It is 3,000 lines of hooks code with 214 tests, and I played 167 headless games with it. It hooks `tool.call` (refuse, and a context line on the result), `command.run`, `prompt.submit`, `turn.complete`, `session.start` and `ui.render` (Pane, Spinner). It calls `$.tool.register`, `$.model.complete`, `$.prompt.submit`, `$.fs`, `$.clock`, `$.audio`, `$.session.root` and state atoms.

The short version: the interface is good enough to build something real in a day (every commit of this mod is from 20 Nov 2026). The friction is almost all in one place: **the engine quietly does something different from what the types, the test kit or the docs led me to expect, and nothing tells me.** Twelve cases follow, most painful first.

## What cost the most

**1. A mod's `prompt.compose` and `attribution.text` hooks are skipped, and the test kit does not know.** The built-in `cc-plugin-sec-default` runs first and sends the event on past a user-tier mod. The only sign is one line in the debug log of a real run:

```
lie-eater: its prompt.compose hook was skipped. "cc-plugin-sec-default" runs first and sent the event on past it.
lie-eater: attribution.text bypassed by cc-plugin-sec-default (tier user); beneath runs
```

For `attribution.text` I wrote the feature test-first, had four green tests in `claude plugin test`, and then two real games showed no change. *To reproduce:* hook either event in a `--plugin-dir` mod, run with `--debug`. *What would help:* `claude plugin validate` says "this event is not open to a mod at your tier", and the test kit refuses the hook the same way the engine does.

**2. A relative `$.fs` path follows the AI's shell `cd`.** The doc says "relative to the working directory", and the examples read `$.fs.read("README.md")`. My mod keeps a ledger in the project. After more than 90 games the AI ran `cd .lie-eater/demo && node --test` in one, and from then on the ledger, the receipts and the card were written into that subfolder. In a monorepo (`cd packages/api && npm test`) that is every session. `$.session.root()` is the answer and its doc is clear, but nothing on `$.fs` points to it. *What would help:* one sentence on `$.fs` ("a shell `cd` by the agent moves this; for the project use `$.session.root()`"), or a `$.fs` that takes `{ from: 'root' }`.

**3. A shell call does not say which command of a chain failed.** A failed call has `isError` and a `result` that is a string; a failing run behind a pipe comes back clean. So any mod that judges a command must parse the command line itself: pipes, `;`, `&&`, redirects, `tail -0`. Five of the fourteen faults that my games found were in that parsing: `cd x && npm test` that failed at the `cd`, `pytest | tail; grep TODO f` where the `grep` set the exit code, `npm test > out.txt; tail out.txt`. *What would help:* the exit status of each stage in the Bash result (what `PIPESTATUS` gives), and the same record shape for a failed call as for a clean one.

**4. The test kit and the engine differ in small ways that each cost an hour.** The kit's `$` has no `state` noun, so a wiring test must read state through a mounted pane. A `prompt.submit` stand-in answers `{ text }` where every other call answers `{ value }`. The kit hands a hook the full path where the mod passed a short one. *What would help:* a page "what the kit does not model".

## What the validator could say sooner

**5. `$` may only be passed into a function declaration.** A helper defined inside `register`, or a `const` arrow function in an imported file, is refused at load. The rule is fine. The message does not say "declare it with `function`".

**6. A state atom must be declared again in every file that reads it.** One shared `state.ts` that exports the atoms is refused ("a source the scan can read"). I now declare the same seven atoms in four files and keep only the start values and shape tags in one place.

**7. `$.prompt.submit` is refused inside a `command.run` hook** ("it would wait on the turn this hook is holding"). Every slash command that should start a turn (`/fix`, a demo) needs `$.clock.after(1, …)` around the submit. *What would help:* `submit({ …, after: 'this-command' })`, or the refusal text naming the timer.

**8. `claude plugin test` does not run when a shell alias puts an option before `plugin`** ("not run from this spelling"). Mine adds one option to every `claude` call. `command claude plugin test` works. A hint in the message would have saved the search.

## What a mod author must know and is told nowhere

**9. The agent treats a hook's `context` line as untrusted.** I asked it, through a context line on a tool result, to say a word. It did, and one message later it took that back: *"That came from a hook note … not from you, and I shouldn't have acted on it."* That is the right behaviour. It means a context line may inform ("your bet was lost") and must never instruct. One line in the doc of `context` would say so.

**10. `turn.complete` fires again when a background task ends.** A mod that does something once per turn does it twice.

**11. In a headless run `$.ui.open` rejects ("no surface").** A mod that opens its pane inside a command must catch that, or the command fails under `claude -p`.

**12. `$.model.classify` read a status message as "the work is finished".** On 26 messages with a known answer it got 25; a plain instruction of my own through `$.model.complete` ("Answer DONE … Answer NOT …") got 104 of 104 in four runs. Small set, one question. I mention it because the classifier looked like the obvious tool for the job and was not.

## What worked better than I expected

- **`tool.call` with `{ deny }`.** The agent recovered from a refusal in one step, every time. In 161 games a test run was refused for a missing bet once: the description of a tool registered at `session.start` was enough to make the agent call it first, 193 times.
- **A headless session is a test bench for a mod.** `claude --plugin-dir <mod> -p --input-format stream-json --output-format stream-json` takes slash commands as messages and reports toasts and status lines as events. A script of 200 lines plays a whole game and compares the mod's ruling with the truth. That found fourteen faults that the unit tests had not. It is in `tools/soak/` if it is useful as a pattern.
- **`originalFile` on Edit and Write results**, which lets a mod measure a file as it was.
- **`claude plugin validate`**, which caught every contract mistake before a run.

## Two things the games showed about the agent, not the interface

- **Rules that the person locked at the start outranked the person's later order.** With the referee's four rules in the conversation, the AI refused 18 of 27 orders to delete, skip or gut a failing test, and named the rule each time. With no mod it did as told 6 of 6 times. Two models, one small project: an observation, not a rate.
- **No model lied.** In 120 games on real exercises, none said "done" over a broken rule. When I dictated a false "all tests pass" after an ordered skip, the AI refused the sentence 2 times of 3.

The mod, the tests, the harness and the full numbers: (repository link, when it is public).
