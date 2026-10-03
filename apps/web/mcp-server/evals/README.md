# Category guidance regression eval

This is a live model/tool-argument eval, separate from deterministic MCP tests.
The observed camera failure fixture contains actual ChatGPT-emitted arguments and
empty output captured through supported browser CDP on 2026-10-03. The grader
rejects it. Scorer unit tests are not proof that revised guidance works.

## Run against ChatGPT

1. After deploying the reviewed guidance, refresh the existing QA connection's
   tools through its supported Manage UI. Do not create another connection.
2. In a fresh chat with that connection selected, send each prompt from
   `categoryGuidanceCases` in `category-guidance-cases.ts` verbatim. Use a separate fresh chat for each case.
3. Capture the FIRST Search Products widget's `window.openai.toolInput` and
   `window.openai.toolOutput` using supported browser CDP `Runtime.evaluate`.
   Save the native responses as an ordered JSON array (the same shape as the
   observed fixture's `traces`; the runner also accepts the whole fixture wrapper). Keep the first empty call even if ChatGPT retries.
   Record the conversation, exact prompt, deployed SHA and tools refresh alongside
   the capture. Do not reconstruct arguments from the assistant's answer.
4. From `apps/web`, run:

   ```sh
   pnpm exec tsx mcp-server/evals/run-category-guidance-eval.ts camera /absolute/camera-traces.json
   pnpm exec tsx mcp-server/evals/run-category-guidance-eval.ts tecno /absolute/tecno-traces.json
   pnpm exec tsx mcp-server/evals/run-category-guidance-eval.ts explicitCategory /absolute/explicit-category-traces.json
   ```

All three must exit zero before recording the submission demo. A camera/Tecno
request must omit category in the first emitted arguments; the explicit Cameras
request must preserve Cameras case-insensitively. This measures preservation of
the shopper-requested category, not every substring that the retrieval engine could
accept; runtime substring filtering is unchanged. The model check accepts explicit
verified aliases (including the captured Smart Camera C300) while rejecting added
model suffixes such as Pro or 5G. Each first call must include the case-specific
product ID verified in the actual live catalog readback, as well as the requested
intent. A second successful call cannot mask a failed first call. No cart actions,
orders or payments are needed. Missing/malformed evidence fails the eval.

## Pre-merge model planning eval

`run-category-guidance-model-eval.ts` invokes the existing configured Gemini 2.5
Flash provider with the actual published search descriptor, shared runtime
guidance and the three verbatim prompts. It forces one search tool selection,
uses no tool executor, disables retries and bounds each request to 45 seconds.
It records generated arguments, argument grades, descriptor/transport hashes,
model, base Git head and whether the candidate worktree is dirty.

Run from `apps/web` with the normal approved test environment loaded:

```sh
pnpm exec tsx mcp-server/evals/run-category-guidance-model-eval.ts /absolute/model-evidence.json
```

The actual pre-tightening model captures in `category-guidance-model-observed-before.json`
omitted the camera model and the explicit-category intent constraints (two cases
RED). After explicitly requiring named brand/model constraints in intent, actual
captures in `category-guidance-model-observed-after.json` pass all three argument
checks. A subsequent run of the reusable CLI also passed all three. These are
single samples per case, not a reliability estimate. Mocked invocation tests are
separately labeled and do not call a provider.

Gemini rejects the published JSON Schema's numeric const and inherited conditional
branches at transport validation. The planning harness materializes numeric const
as equal bounds and inherited branch types/properties for that provider, while
retaining the published schema and descriptions. The two hashes record that
transport distinction; production MCP schemas and retrieval are unchanged.

This is actual Gemini model planning evidence, not executed MCP product results
or proof of ChatGPT behavior. The original actual ChatGPT camera failure remains
RED. Post-deployment ChatGPT first-call/browser evaluations above are still
PENDING and required before recording; no ChatGPT live pass is claimed here.

The complete search description is now shared by runtime registration and public discovery. A fresh three-case planning run against that exact shared descriptor passed; `category-guidance-model-observed-shared.json` records the actual calls and descriptor hash, and a regression checks that current guidance still matches this evidence. This remains Gemini planning evidence, not executed MCP or live ChatGPT verification. The CLI has colocated mocked boundary coverage for arguments, missing credentials, provenance, writing evidence, RED exit status and redacted provider/Git/write errors.
