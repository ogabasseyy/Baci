# Category guidance regression eval

This is a live model/tool-argument eval, separate from deterministic MCP tests.
The observed camera failure fixture contains actual ChatGPT-emitted arguments and
empty output captured through supported browser CDP on 2026-10-03. The grader
rejects it. Scorer unit tests are not proof that revised guidance works.

## Run against ChatGPT

1. After deploying the reviewed guidance, refresh the existing QA connection's
   tools through its supported Manage UI. Do not create another connection.
2. In a fresh chat with that connection selected, send each prompt from
   `categoryGuidanceCases` verbatim. Use a separate fresh chat for each case.
3. Capture the FIRST Search Products widget's `window.openai.toolInput` and
   `window.openai.toolOutput` using supported browser CDP `Runtime.evaluate`.
   Save the native responses as an ordered JSON array (the same shape as the
   observed fixture's `traces`). Keep the first empty call even if ChatGPT retries.
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
request must preserve it. Each first call must return products with the requested
intent. A second successful call cannot mask a failed first call. No cart actions,
orders or payments are needed. Missing/malformed evidence fails the eval.

The pre-fix observed fixture is RED. Post-fix live model eval results are PENDING
deployment; no live pass is claimed by this repository change.
