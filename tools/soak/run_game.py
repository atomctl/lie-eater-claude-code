#!/usr/bin/env python3
"""Plays one real game of Lie Eater, headless, and writes what happened as JSON.

usage: run_game.py <game-id> <run-dir> <model> <mod-dir> <out.json> [<setting sources>]

A mod folder of `-` plays the game with no mod and no referee: the control.

The run folder must hold the task's files and a `task.json`:
  prompt   what the person asks the AI to do (none: the mod sends the task itself,
           as `/summon demo` does)
  summon   the summon message (default `/summon`)
  then     the messages after the task's turn (default `/explain`, `/rule`);
           `<turn>` waits for a turn that the mod itself starts (Fix this)
  before   messages sent before the summon (for example: "run the tests once")
  truth    the command that this script runs AFTER the game to see for itself
           whether the tests pass
  tests    the paths whose changes are shown in the result (the test files)

The session is one process. Messages go in one by one; after the task's turn
the script waits, so that the referee's ruling for that turn exists before
`/explain` and `/rule` are sent.
"""
import json
import pathlib
import queue
import subprocess
import sys
import threading
import time

TOOLS = ["Bash", "Edit", "Write", "Read", "mcp__lie-eater__bet"]
TASK_TIMEOUT = 900  # seconds for the AI's work
TURN_START = 60  # seconds in which a turn that the mod starts must show itself
MOD_TURN = "<turn>"
RULING_WAIT = 12  # seconds after the turn, for the referee's ruling


class Session:
    def __init__(self, cwd, model, mod, log, sources):
        cmd = ["claude", "--model", model, "--allowedTools", *TOOLS[: -1 if mod == "-" else None]]
        if mod != "-":
            cmd += ["--plugin-dir", str(mod)]
        if sources:
            cmd += ["--setting-sources", sources]
        cmd += ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
        self.proc = subprocess.Popen(
            cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1
        )
        self.events = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            try:
                self.events.put(json.loads(line))
            except ValueError:
                pass
        self.events.put(None)

    def say(self, text, timeout):
        """Sends one message and returns every event up to the end of its turn."""
        self.proc.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n")
        self.proc.stdin.flush()
        return self._turn(text[:60], timeout)

    def listen(self, timeout):
        """Waits for a turn that the mod itself starts, and returns its events."""
        return self._turn("a turn started by the mod", timeout, start=TURN_START)

    def _turn(self, what, timeout, start=None):
        seen = []
        began = time.time()
        while True:
            waited = time.time() - began
            if waited >= timeout or (start is not None and not seen and waited >= start):
                raise TimeoutError(what if seen or start is None else f"no turn started: {what}")
            try:
                event = self.events.get(timeout=5)
            except queue.Empty:
                continue
            if event is None:
                raise RuntimeError("the session ended early")
            seen.append(event)
            if event.get("type") == "result":
                return seen

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=30)
        except Exception:
            self.proc.kill()


def digest(events):
    """The tool calls, toasts and texts of one turn."""
    out = {"tools": [], "toasts": [], "status": [], "texts": [], "result": None, "cost": None}
    by_id = {}
    for event in events:
        kind = event.get("type")
        if kind == "assistant":
            for block in event["message"].get("content", []):
                if block.get("type") == "text":
                    out["texts"].append(block["text"])
                elif block.get("type") == "tool_use":
                    tool = {"name": block.get("name"), "input": block.get("input")}
                    by_id[block.get("id")] = tool
                    out["tools"].append(tool)
        elif kind == "user":
            content = event["message"].get("content")
            for block in content if isinstance(content, list) else []:
                if block.get("type") == "tool_result" and block.get("tool_use_id") in by_id:
                    text = block.get("content")
                    if isinstance(text, list):
                        text = " ".join(part.get("text", "") for part in text if isinstance(part, dict))
                    tool = by_id[block["tool_use_id"]]
                    tool["result"] = str(text)[-900:]
                    tool["is_error"] = bool(block.get("is_error"))
        elif kind == "system" and event.get("subtype") == "ui_toast":
            out["toasts"].append(event.get("text"))
        elif kind == "system" and event.get("subtype") == "ui_status":
            out["status"].append(event.get("text"))
        elif kind == "result":
            out["result"] = event.get("result")
            out["cost"] = event.get("total_cost_usd")
    return out


def look(run, task):
    """What this script sees for itself after the game: do the tests pass, and what changed in them?"""

    def sh(cmd, timeout=240):
        try:
            done = subprocess.run(cmd, cwd=run, capture_output=True, text=True, timeout=timeout)
            return done.returncode, (done.stdout + done.stderr)
        except subprocess.TimeoutExpired:
            return -1, "timeout"

    code, output = sh(task["truth"])
    _, diff = sh(["git", "diff", "--unified=0", "HEAD", "--", *task["tests"]])
    _, status = sh(["git", "status", "--porcelain"])
    return {"testsPass": code == 0, "exit": code, "tail": output[-700:], "testDiff": diff[-4000:], "status": status}


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def main():
    game, run, model, mod, out = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3], sys.argv[4], pathlib.Path(sys.argv[5])
    sources = sys.argv[6] if len(sys.argv) > 6 else ""
    task = json.loads((run / "task.json").read_text())
    (run / "task.json").unlink()  # the AI must not read the notes about the task
    result = {"game": game, "task": task["name"], "model": model, "started": time.strftime("%H:%M:%S"), "turns": {}}
    began = time.time()
    with open(run.parent / f"{game}.stderr.txt", "w") as log:
        session = Session(run, model, mod, log, sources)
        try:
            for i, message in enumerate(task.get("before", [])):
                result["turns"][f"before{i}"] = digest(session.say(message, 300))
            if mod != "-":
                result["turns"]["summon"] = digest(session.say(task.get("summon", "/summon"), 60))
            if task.get("prompt"):
                result["turns"]["task"] = digest(session.say(task["prompt"], TASK_TIMEOUT))
            else:
                result["turns"]["task"] = digest(session.listen(TASK_TIMEOUT))
            time.sleep(RULING_WAIT if mod != "-" else 0)
            for i, step in enumerate(task.get("then", ["/explain", "/rule"]) if mod != "-" else []):
                if step == MOD_TURN:
                    result["turns"][f"{i} turn"] = digest(session.listen(TASK_TIMEOUT))
                    time.sleep(RULING_WAIT)
                else:
                    result["turns"][f"{i} {step}"] = digest(session.say(step, 60))
        except Exception as error:  # a timeout or a dead session is a result too
            result["error"] = f"{type(error).__name__}: {error}"
        finally:
            session.close()
    result["seconds"] = round(time.time() - began)
    result["ledger"] = read_json(run / ".lie-eater" / "ledger.json")
    result["receipts"] = read_json(run / ".lie-eater" / "receipts.json")
    result["seen"] = look(run, task)
    result["note"] = task.get("note")
    result["breaks"] = task.get("breaks")
    out.write_text(json.dumps(result, indent=1))
    print(f"{game}: done in {result['seconds']}s{' ERROR ' + result['error'] if 'error' in result else ''}")


if __name__ == "__main__":
    main()
