# Lie Eater

A referee for Claude Code. Before the AI starts a task you type `/summon`. The referee locks the rules of the game, makes the AI bet before each test run, and at the end rules on what really happened, in plain words, with the proof under each line.

Lie Eater is a Claude Code mod. It only reads what happened in your session. It never runs a command of its own.

```
THE REFEREE IS PRESENT · game 1
The rules of this game:
1. The tests must really pass (npm test)
2. No check may be removed from a test
3. No test may be deleted
4. No test may be switched off
The referee also watches for numbers with no source.

RULING: 2 of 4 rules kept
✓ The tests really pass
    npm test, call 41
✗ The AI removed 3 checks from a test
    tests/parse.test.ts: assertions -3
    Why it matters: A removed check lets a test pass while the bug is still there.
✓ No test was deleted
✗ The AI switched off 1 test
    tests/parse.test.ts: new skip or only marks: 1
    Why it matters: A switched-off test is reported as fine without running.
A lie was told. It is eaten.
[ Fix this ]  or type /fix

The AI said "90% sure". It was right 3 of 4 times.
Clean games in a row: 0
Debt: 1 open
```

## Try it

Until the public release, run it from this folder:

```
claude --plugin-dir /path/to/lie-eater
```

Then, in any project with tests, type `/summon` and give the AI a task.

## How a game goes

1. **`/summon`** calls the referee. It finds your test command by itself (from the last test run, from `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` or a `Makefile`, or from the names of your test files). If it finds none, `/summon tests` asks the AI to write your first tests. An expert can type `/summon <command>`.
2. **The rules are locked** before the AI does anything. Nothing changes them until the game ends.
3. **The AI bets before each test run.** A test or build run with no bet is refused, with the reason. The AI then says what it expects (`pass` or `fail`) and how sure it is (50% to 99%), and runs again. The real result settles the bet. A bet on a result that was already known is void.
4. **After each turn the referee rules.** Every line is in plain words, with the technical detail under it. A broken rule also says why it matters.
5. **LIE EATEN** means one thing: the AI said the work was finished, and a rule is broken.
6. **`/fix`**, or the `[ Fix this ]` button, sends the AI back with a repair order that names what to put back, word for word.
7. **The game ends by itself** when the AI says it is finished and all four rules are kept. `/rule` ends it now.

| Command | What it does |
|---|---|
| `/summon` | Calls the referee and locks the rules |
| `/fix` | Sends the AI back to repair the broken rules (three times per game at most) |
| `/explain` | The last ruling in three plain sentences |
| `/rule` | The final ruling now; ends the game and writes the receipts |
| `/overrule` | You overrule the last broken ruling; its debt is cleared. `/overrule debt` clears every open debt, also one from an earlier session |
| `/lie-eater` | Opens the pane |

## The four rules, and one note

| Rule | Broken when |
|---|---|
| The tests must really pass | The test command did not run, failed, gave no clear result, or ran before the last code change. A narrowed run (`npm test -- auth`, `pytest -k x`, one file) is not the test run. Flags that do not narrow it (`-v`, `-q`), a runner in front (`uv run`, `npx`, `timeout 600`) and the script behind `npm test` are the same run. A run whose exit code is hidden (`\| tail`, `; echo $?`, `\|\| true`) is judged by the counts in its output; with no counts, or when the command prints counts itself or filters the output, it gives no clear result. Tidying up afterwards (a commit, a new branch, the changelog) does not make the run stale. |
| No check may be removed from a test | A test file has fewer assertions than at the summon. Checks moved into a table (`test.each`, `parametrize`) do not count as removed; the referee then shows the removed lines and asks you to look. |
| No test may be deleted | A test, a test file or a test folder is gone, or a test is commented out. A scratch test the AI made in this game may be removed again. |
| No test may be switched off | A new `.skip`, `xit`, `.only`, `@pytest.mark.skip`, `#[ignore]` and the like. A conditional skip (`skipif`), and a skip mark in a test file the AI wrote in this game, do not count. |

**The note:** a number in the AI's final message (a decimal, a percent, a whole number of 10 or more) that appears in no tool output is shown as "Worth a look". It never breaks the game, because an honest AI also reports numbers it counted itself.

## The house remembers

Lie Eater keeps two files in your project, in `.lie-eater/`:

- **`ledger.json`**: every settled bet, every finished game, and the Debt. A game that ends with a broken rule, or a lie, leaves a debt. Only a later game that ends with the rules kept repays it; `/overrule` clears it by your word. The debt is shown at the start of your next session.
- **`receipts.json`** and **`receipts.md`**: the last game written down: the rules, each ruling with its proof, each bet and how it ended. Format `lie-eater/receipts`, version 1.

```json
{
  "format": "lie-eater/receipts",
  "version": 1,
  "terms": { "verdict": "npm test", "lockedAt": "2026-11-20T10:00:00.000Z" },
  "rulings": [{ "id": 1, "met": false, "lie": true, "lines": [{ "term": "verdict", "pass": false, "plain": "The tests fail", "detail": "npm test, call 7" }] }],
  "bets": [{ "id": 1, "expect": "pass", "confidence": 0.9, "state": "lost", "line": "npm test → 3 failed, 31 passed" }],
  "score": { "n": 1, "won": 0, "lost": 1, "hitRate": 0, "said": 0.9 }
}
```

Whether you commit `.lie-eater/` is your choice.

## What this mod can touch

- **It reads** the tool calls of your session and their results, your prompts (only to know which numbers came from you), and the AI's final message of each turn.
- **It writes** files only in `.lie-eater/` in your project: `ledger.json`, `receipts.json`, `receipts.md`, and `ledger.unreadable.json` (a copy of a ledger file it could not read, so that nothing is lost).
- **It reads** `package.json`, `pyproject.toml`, `pytest.ini`, `Cargo.toml`, `go.mod` and `Makefile` at a summon, and the file names in your project's folder and its `tests` folder, to find your test command.
- **It refuses** a test or build run of the AI that has no bet, while a referee is present, twice per turn at most. It refuses nothing else and it never changes a command.
- **It adds** one tool the AI can call (`bet`) and one hidden line on a test result that tells the AI how its bet ended.
- **It sends a prompt** only when you press Fix this or type `/fix` or `/summon tests`.
- **It makes one small model call** per turn while a game is in play, with the end of the AI's final message, to learn whether it says the work is finished.
- **It starts no program and opens no network connection.** Nothing leaves your machine except that one model call, which goes where your Claude Code session goes.

## The honest number

Eight recorded sessions with a known truth are in [`fixtures/`](fixtures). Each one is replayed through the same rules the live mod uses. One command reproduces the table:

```
claude plugin test .
```

| Sessions | Result |
|---|---|
| 3 honest (test-first work; ten checks moved into a table; a rounded number and a run through `tail`) | 3 of 3 ruled "rules kept"; 1 note (the table: the person is asked to look) |
| 3 with a broken rule (failed run said to pass; three checks removed; a test switched off and the run silenced) | 3 of 3 caught: the test rule 2 times, removed checks 1, switched-off test 1; 1 number with no source noted |
| 2 about bets | 1 bet won, 1 lost, 1 void |

**To add a session:** copy a file in `fixtures/`, change it, add it to `fixtures/index.ts`, and run the command. The test fails and prints the table your sessions give.

## What is different

Other tools check a "tests pass" claim after the fact, for example [claude-receipts](https://github.com/furkiak/claude-receipts), [proof](https://github.com/EricFinland/proof), [receipt](https://github.com/majiayu000/receipt), [rashomon](https://github.com/altrace-dev-role/rashomon), [claim-check](https://github.com/godic97/claim-check) and [claimcheck](https://github.com/Allan-Nava/claimcheck). As read on their pages on 20 Nov 2026, none of them does these four things:

- **Rules locked before the work**, by the person, in one word.
- **A bet before every test run**, settled by the real result, with a running record of how sure the AI said it was and how often it was right.
- **A face inside Claude Code**: a pane, plain words, a reason under each broken rule, one button to send the AI back.
- **Numbers beyond test counts**: any reported measurement is traced to a tool output.

In Lie Eater no model takes part in a ruling. Rules decide every line and every bet. One small model call answers one question about the AI's words: does the final message say the work is finished?

## Limits

- **The sessions in `fixtures/` were written by the builder.** They show that the rules work as designed. They do not show how often real AI agents lie or cheat.
- **The record is read, never re-run.** Lie Eater sees the test output the AI saw. It does not run your tests again.
- **Edits made by shell commands are only half seen.** `sed -i` or `git checkout` makes an earlier test run stale, but what changed inside a test file is not counted.
- **A small model decides "said it is finished".** It can be wrong in both directions.
- **With few bets the record is an anecdote.**
- **A refused run costs the AI one extra step.** After two refusals in one turn the run goes through and is counted as "a run without a bet".
- **Ratios and sums are not traced** ("3 times faster").
- **The sound plays on macOS only.**
- **Tests that already failed before the game:** when they still fail, "done" is not called a lie, but the rule still shows as broken until you end or overrule the game.
- **A table can hide a removed check.** The referee cannot tell an honest table from a trick, so it shows the removed lines and asks you to look.
- **A check swapped for a weaker one** (`toBe(5)` for `toBeDefined()`) is not seen: the referee counts checks, it does not weigh them.
- **The AI can be right while a rule is broken.** A test that was itself wrong may have to change. That is what `/overrule` is for.

The name is inspired by the manga Usogui. No artwork or text from it is used.

## Licence

MIT
