# 09 Agents

**Time:** 5 hours · **Week:** 3 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Understand the Python agent service, and the guard that every paid AI call must pass: the caps, the kill switch, and the test that keeps the guard the only way to call a model.

## Before you start

- [08 Request flow](08-request-flow.md) done.

## Learn first

- [02 Learning path](02-learning-path.md): 11 (Python, pytest, Pydantic, and uv).

## Read

1. [`AGENTS.md`](../../AGENTS.md) §5 again, and [ADR-0010](../adr/0010-async-generation.md), Context and Decision. Look for: the planned agents, and how a long generation will run. The current sprint doc says which parts exist.
2. [`services/agents/README.md`](../../services/agents/README.md) and `services/agents/pyproject.toml`. Look for: the commands, and how ruff, mypy, and pytest are set up.
3. In `services/agents/src/cv_tailor_agents/ai_guard/`, in this order:
   - `errors.py`. Look for: two kinds of "blocked": a bug in the caller, or AI paused on purpose.
   - `limits.py`. Look for: the output and input caps (QUOTA-04), and why a call over a cap is refused, not shortened.
   - `kill_switch.py`. Look for: "fail closed", a 30-second cache, and why a read error isn't cached (ADMIN-03).
   - `clients.py`. Look for: the guard runs inside botocore, before the request is built, signed, or sent, so it covers every way the client is used.
4. Tests in `services/agents/tests/ai_guard/`: `conftest.py`, then `test_kill_switch.py` and `test_boundary.py`. Look for: botocore's `Stubber`, which answers instead of AWS, and a test that reads the source code itself.

### The guard

```text
bedrock_runtime_client() ── every call ──▶ guard (botocore event "provide-client-params")
                                              1. only Converse or ConverseStream
                                              2. check_request: maxTokens 1–4096, input ≤ 100,000 bytes
                                              3. kill switch: /cv-tailor/ai-calls must be exactly "enabled"
                                           ──▶ only then: build, sign, and send to Bedrock
```

## Do

Never run `services/agents/scripts/ai_guard_check.py`: it makes real, paid model calls (rule 5). Use [the practice routine](README.md#the-practice-routine) for G2 to G4.

### G1 Run the tests `[No AWS]`

```bash
cd services/agents
uv run pytest            # fast, no coverage gate
uv run mypy              # strict type check
uv run ruff check        # lint
cd ../..
pnpm --filter @cv-tailor/agents test     # with the 80% coverage gate, as CI runs it
```

Expected: every test passes (`62 passed` today), mypy says `Success`, and ruff says `All checks passed!`.

### G2 Make the kill switch fail open `[No AWS]`

In `kill_switch.py`, change `if self._read() != ENABLED:` to `if self._read() == "disabled":`. Predict, then run:

```bash
(cd services/agents && uv run pytest tests/ai_guard/test_kill_switch.py)
```

Expected: 4 failures, all `test_any_other_value_blocks_calls`, for `Enabled`, `enabled `, `true`, and `on`. The case `disabled` still passes. With the change, a typo in the parameter would turn AI calls on. "Fail closed" means only the exact value `enabled` allows calls. Reset.

### G3 A second way to call a model `[No AWS]`

Create `services/agents/src/cv_tailor_agents/scratch.py`:

```python
import boto3

client = boto3.client("bedrock-runtime")
```

Run `(cd services/agents && uv run pytest tests/ai_guard/test_boundary.py)`.

Expected: 1 failure, `test_only_the_guard_creates_bedrock_clients[scratch.py]`, with `'line 3: names bedrock-runtime'`. A client made anywhere else would skip the guard. Delete the file.

### G4 A name shared by Python and OpenTofu `[No AWS]`

In `kill_switch.py`, change `PARAMETER_NAME` to `"/cv-tailor/ai-calls-v2"`. Predict, then run pytest, and then the OpenTofu tests:

```bash
(cd services/agents && uv run pytest)
bash infra/scripts/tofu-each.sh test
```

Expected: pytest passes, because the tests import the name. The OpenTofu tests fail in `stacks/baseline`, run `kill_switch`: `The AI call guard must read the kill switch parameter by the same name.` That test reads `kill_switch.py` as text and compares it with the parameter OpenTofu creates. Reset.

## Verify

You can explain what happens, step by step, between a call to a Bedrock client from `bedrock_runtime_client()` and the request leaving the computer.

## Check your understanding

1. Why a botocore event handler, and not a check in our own call function?

   <details>
   <summary>Answer</summary>

   The handler runs inside the client, before any request is built, signed, or sent. Every use of the client passes through it, including libraries such as LangChain that are given the client.

   </details>

2. What does "fail closed" mean in `kill_switch.py`?

   <details>
   <summary>Answer</summary>

   Anything uncertain blocks calls: any value except exactly `enabled`, a missing parameter, or a read error. A read error isn't cached, so the next call tries again.

   </details>

3. The tests import `MAX_OUTPUT_TOKENS` instead of writing `4096`. What's the trade-off?

   <details>
   <summary>Answer</summary>

   There's one source of truth, so a deliberate change needs no test edits. But a test can't catch an accidental change to the value itself; a reviewer has to. Changing it fails no test today. Compare `PARAMETER_NAME`, which a test on the OpenTofu side pins (G4).

   </details>

4. How do the tests avoid calling AWS?

   <details>
   <summary>Answer</summary>

   They use botocore's `Stubber` with fake credentials: it answers each expected call, and any unexpected call fails the test.

   </details>

## If you get stuck

- `uv run` says the environment is out of date: run `uv sync` in `services/agents`.
- A Python import fails in a test: under pytest's `importlib` mode, a test file can't import another test file; shared helpers live in `conftest.py` (the S2-11 lesson in the [Sprint 2 review](../sprints/sprint-02-walking-skeleton.md#sprint-review)).
