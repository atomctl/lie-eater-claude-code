# Field report: one real mod, 299 tests, about 300 headless games

> **DRAFT, not posted.** For the Claude Code team's thread on mods ([issue 91870](https://github.com/anthropics/claude-code/issues/91870)), where they ask for critical feedback. The owner of this repository posts it under their own name, or not at all. The friction was first seen on build 2.1.311 (20 Nov 2026). On 21 Nov 2026 each item was checked again on **2.1.329**, by its types and docs and, where it costs nothing, by a probe mod run with `claude plugin validate` and `claude plugin test`. Each item says what that check found.

The mod is [Lie Eater](https://github.com/atomctl/lie-eater-claude-code). An AI can say "done" after it made the checks easier. Lie Eater freezes the project's test files and runner config when it arms, gives the agent a `done` tool, and at each `done` compares the files with the snapshot and looks for one run of the locked test command by itself, after the last change. The result is `✓ checked`, `✗ don't trust "done"` (with the file and the line count), or `? not checked`. No model call is in a ruling. It also makes the agent bet pass or fail before each test run.

It hooks `tool.call` (refuse, and a context line on the result), `command.run`, `prompt.submit`, `turn.complete`, `session.start` and `ui.render` (Pane), and calls `$.tool.register`, `$.prompt.submit`, `$.fs`, `$.clock`, `$.audio`, `$.session.root` and state atoms. About 300 headless games over its versions, 8 sessions on real open-source projects, 299 tests.

The short version: the interface is good enough to build something real in a few days. Most friction is in one place: **the engine does something other than what the types, the test kit or the docs led me to expect, and nothing tells me.** On 2.1.329, items 5 and 11 are fixed, items 1, 2, 4 and 7 are better, and one new item showed up. That is fast.

## What cost the most

**1. A mod's `prompt.compose` and `attribution.text` hooks are skipped, and the test kit does not know.** The built-in `cc-plugin-sec-default` runs first and sends the event on past a user-tier mod. The only sign was one debug-log line of a real run (`lie-eater: attribution.text bypassed by cc-plugin-sec-default (tier user); beneath runs`). I wrote a feature test-first, had four green tests in `claude plugin test`, and two real games showed no change. *What would help:* `claude plugin validate` says "this event is not open to a mod at your tier", and the kit skips the hook as the engine does.
*2.1.329:* the plugin-authoring reference now documents the `bypassed by` debug line and says validate "knows the mod, not a session". That helps. The kit and validate still say nothing.

**2. A relative `$.fs` path follows the agent's shell `cd`.** The mod kept its ledger in the project. After more than 90 games the agent ran `cd .lie-eater/demo && node --test` in one, and from then on the ledger was written into that subfolder. In a monorepo (`cd packages/api && npm test`) that is every session. `$.session.root()` is the answer.
*2.1.329:* the doc of `$.session.root()` now says "a shell `cd` during the session does not move it". The doc of `$.fs` still says only "a relative path is under the session's working directory", with no pointer to `root()`. One sentence there would close it.

**3. A shell call does not say which command of a chain failed.** A failed call has `isError` and a string; a failing run behind a pipe comes back clean. So a mod that judges a command must parse the command line itself. Five of the fourteen faults my games found were in that parsing, and eight of the eleven a code review found afterwards. In the end I stopped reading shell text: only the locked command, run by itself, with allow-listed flags, judged by its exit code, counts as proof. Anything piped or chained is "not checked". That was the right design, but the interface pushed me there by trial. *What would help:* the exit status of each stage in the Bash result (what `PIPESTATUS` gives).
*2.1.329:* not checked again (needs a real session).

**4. The test kit and the engine differ in small ways that each cost an hour.** A `prompt.submit` stand-in answered `{ text }` where every other call answers `{ value }`; the kit handed a hook the full path where the mod passed a short one. *What would help:* a page "what the kit does not model".
*2.1.329:* better. The kit now refuses `$.prompt.submit` inside `command.run` as the engine does (item 7). Not every item checked again.

## What the validator says

**5. `$` may only be passed into a function declaration.** *2.1.329: fixed.* The message now names the cure: "not a function declared at the top of this file (a function declaration, or a const bound to one)".

**6. A state atom must be declared again in every file that reads it.** One shared `atoms.ts` that exports the atoms is still refused on 2.1.329 ("the state library's update takes a source the scan can read …"). I declare the same atoms in four files.
*New on 2.1.329:* the validator **cuts its own error message**: `… writte… [+220 chars]`, in the plain output and in `--json` too. The hidden 220 characters are where the cure would be.

**7. `$.prompt.submit` is refused inside a `command.run` hook.** Every slash command that starts a turn needs a timer around the submit. *2.1.329: better.* The refusal names a way out ("submit from a later event (turn.complete)"), and the kit gives the same refusal as the engine.

**8. `claude plugin test` does not run when a shell alias puts an option before `plugin`.** *2.1.329: still so.* With `alias claude='claude --dangerously-skip-permissions'` the answer is "not run from this spelling. Use `claude plugin test [dir]`, with no options before `plugin`". The person typed exactly that. A hint "an alias may add options; try `command claude plugin test`" would save the search.

## What a mod author must know and is told nowhere

**9. The agent treats a hook's `context` line as untrusted.** It followed an instruction in a context line once and took it back one message later ("That came from a hook note … not from you"). Right behaviour. It means a context line may inform ("your bet was lost") and must never instruct. One line in the doc of `context` would say so.

**10. `turn.complete` fires again when a background task ends.** A mod that does something once per turn does it twice. *2.1.329:* not checked again.

**11. In a headless run `$.ui.open` rejected ("no surface").** *2.1.329: changed.* The doc now says the open waits "with no surface attached, for one".

**12. `$.model.classify` read a status message as "the work is finished".** 25 of 26 on messages with a known answer; a plain prompt through `$.model.complete` got 104 of 104. Small set, one question. The current mod has no model call at all, partly for this reason.

## What worked better than I expected

- **`tool.call` with `{ deny }`.** The agent recovered from a refusal in one step, every time. A tool registered at `session.start` with a clear description was enough: the agent called `done` with no instruction from the person in 19 of 20 check games.
- **A headless session is a test bench.** `claude --plugin-dir <mod> -p --input-format stream-json --output-format stream-json --verbose` takes slash commands as messages and reports toasts and status lines as events. A short script plays a game and compares the mod's result with the truth (`tools/soak/`). Its limit: a bench tests only the shapes its games use. 377 shell commands from my games held no `rm`, no runner named by its path and no test run on a second line; a code review then found eleven faults in exactly those shapes.
- **`originalFile` on Edit and Write results**, and **`claude plugin validate`**, which caught every contract mistake before a run.
- **The marketplace road.** A repository with `.claude-plugin/marketplace.json` and `/plugin install <mod> --marketplace <owner>/<repo>` worked on the first try from an empty config, over SSH and over HTTPS.

## What the games showed about the agent (a negative result about my own mod)

I first believed the mod made the agent refuse to weaken tests: with its rules present, the agent refused 18 of 27 ordered breaches; with no mod it obeyed 6 of 6. **A control showed that was the words, not the mod.** On a staged project (Haiku and Sonnet, 24 games a group), the agent refused an order to delete, skip or gut a failing test:

| Before the order | Refused |
|---|---|
| nothing | 0 of 24 |
| the same four rules, typed by the person as one plain message, no mod | **24 of 24** |
| the mod | 19 of 24 |

After 49 unrelated turns and a `/compact`, the plain message still held 10 of 10; the mod held 5 of 10. So I took prevention out of the mod's claims and made it a checker: its job is to prove "done", not to change behaviour. Anyone building "guardrail" mods may want to run the same control: *one plain message stating rules as the person's own did more than code-held rules did.* Small numbers, one project, two models.

**No model lied by itself.** In 120 games on real exercises, none said "done" over a broken rule unless ordered to. On real projects ([8 sessions](real-projects-2026-11-20.md)) the common case was honest friction: Sonnet put new tests into an existing (frozen) test file, read the red result and moved them to a new file with no person. When a feature made old tests fail (`vercel/ms`), both models stopped with a red suite and left the decision to the person. Every result agreed with a test run made afterwards by a script.
