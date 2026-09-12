# AI Provider Chain

Every text-based AI feature on the platform runs through one shared provider
chain instead of calling a single vendor. The chain exists so that no AI
feature depends on one vendor's quota, and so the free capacity of several
independent providers is used before any paid Google quota is touched.

## The chain

| # | Provider | Model | Role |
|---|----------|-------|------|
| 1 | Cerebras | `gemma-4-31b` | Primary. Fastest (~1,850 tok/s) and the only healthy Gemma host. |
| 2 | Groq | `openai/gpt-oss-120b` | Overflow when Cerebras is rate-limited. |
| 3 | Google | `gemini-2.5-flash` | Fallback. |
| 4 | Google | `gemini-2.5-flash-lite` | Fallback (separate free-tier pool from Flash). |
| 5 | OpenRouter | `google/gemma-4-31b-it:free` | Opportunistic only — see below. |

Cerebras, Groq and OpenRouter join the chain **only when their API key is
set** (`CEREBRAS_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`). With no keys
configured the chain degrades to Gemini-only, so a self-hosted or preview
deployment keeps working unchanged.

Model names are env-overridable — `COPILOT_CEREBRAS_MODEL` (default
`gemma-4-31b`) and `COPILOT_GROQ_MODEL` (default `openai/gpt-oss-120b`) — so
ops can swap a retired model without a code change. The env vars keep their
`COPILOT_*` names because they were already live in production before the
chain was generalized beyond the builder copilot.

**OpenRouter is opportunistic**: its free Gemma pool is heavily 429-contended
(25/25 probes failed on 2026-07-07). Only the builder route, which explicitly
budgets the route deadline across providers, ever consults it. The generic
chain executors skip it entirely.

## Free-tier limits (2026-07) — the binding constraint

| Provider | Requests | Tokens |
|----------|----------|--------|
| Cerebras `gemma-4-31b` | **5 / min** | 30K/min, 1M/day |
| Groq `gpt-oss-120b` | 30 / min, **1,000 / day** | 8K/min, 200K/day |
| Gemini 2.5 Flash / Lite | ~250 / day, ~1,000 / day | — |

The free tiers are **request**-starved, not token-starved. Cerebras' 5 req/min
is the number that shapes the design: under any concurrency it 429s routinely.
That is expected and handled — the chain falls through — but it means a naive
implementation would pay a doomed Cerebras round-trip on *every* request.

## Rate-limit cooldown

`ai/provider-cooldown.ts` parks a provider after a rate-limit rejection, and
`ai/select-attemptable-providers.ts` skips parked providers so the walk goes
straight to a link that can serve. The window comes from the provider's own
`Retry-After` / `x-ratelimit-reset-*` header when it sends one, otherwise 60s.

Two deliberate rules:

- **Only rate-limit errors park a provider.** A 5xx or network blip must not
  sideline the chain's fastest link — normal fall-through already covers those.
- **If every provider is cooling down, the full chain is attempted anyway.**
  Cooldowns are a per-instance heuristic and can be stale (a cold start forgets
  them), so a doomed-looking attempt beats failing the request without trying.

Like the rate limiter in `ai/provider.ts`, cooldown state lives in process
memory: each warm Vercel instance keeps its own view. That is fine — the
cooldown is a latency optimization, not a correctness guard. A forgotten
cooldown costs one wasted 429; the chain still falls through correctly.

## Using the chain

```ts
// Free text (optionally with native tool calling).
import { generateTextWithChain } from '@/ai/generate-text-with-chain';

const { text, providerName } = await generateTextWithChain({
  system: SYSTEM_PROMPT,
  prompt: userPrompt,
  perProviderTimeoutMs: 10_000, // tighten on interactive paths
});
```

```ts
// Structured JSON.
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';

const { object } = await generateObjectWithChain({
  schema: myZodSchema,
  prompt, // MUST describe the JSON shape — see below
});
```

### Loose JSON mode — the one rule that bites

`generateObjectWithChain` sends **no schema to the provider** (`output:
'no-schema'`) and validates in-code with Zod. This is not a shortcut: the
providers' strict structured-output modes reject schemas in mutually
incompatible ways (Cerebras rejects string `minLength` and empty `{}`
sub-schemas; Groq rejects the `propertyNames` that Zod record types emit).
Loose JSON mode is the only mode all four providers support.

The consequence: **the prompt must describe the JSON shape**, because the
schema no longer reaches the model. A prompt that relied on `generateObject`'s
schema enforcement will produce off-shape JSON, fail the in-code `safeParse`,
and fall through every provider until the chain exhausts. When converting a
call site, append a compact shape description to the prompt.

Off-shape output is treated as a failed attempt, so a provider that ignores the
shape simply falls through — it can never corrupt data.

### Vision

`getVisionProviderChain()` returns the image-input-capable subset (Cerebras +
both Gemini tiers; Groq's `gpt-oss-120b` is text-only). Images **must be passed
as raw bytes**, never as remote URLs: Cerebras accepts only base64 data URIs and
the AI SDK forwards URL parts verbatim rather than downloading them. Use
`lib/fetch-image-bytes.ts` to turn a URL into bytes.

PDFs are Gemini-only (Cerebras cannot accept them) — filter the vision chain to
`google:` providers, as `lib/verify-cac-certificate.ts` does.

**Image generation cannot use the chain at all** — no provider besides Gemini
produces images, so logo/hero/product image generation stays on
`activeImageModel`.

### Side effects

If a chain provider fails *after* one of its tools already created commerce
state (a virtual bank account, an order cancellation), the walk must not
continue — a fresh provider would re-run the conversation. Pass `shouldStopWalk`
to halt the walk; see `app/api/chat/run-chat-provider-chain.ts`.

## Verifying Cerebras

```bash
CEREBRAS_API_KEY=csk-... node scripts/probe-cerebras.mjs
```

Checks the four things the chain depends on: the model is still listed (it is a
**preview** endpoint and may be retired on short notice), text completion, loose
JSON output, and image input. Exits non-zero on failure, so it can gate a
rollout.

## Cost note

Once past the free tiers, `gemma-4-31b` is the *most* expensive option
(~$0.99/M input, $1.49/M output) — more than Gemini 2.5 Flash-Lite ($0.10/M
input) and far more than `gpt-oss-120b` (~$0.04–0.15/M input). Gemma-4 is the
primary for **availability and speed on the free tier**, not for paid economics.
If sustained volume outgrows the free tiers, the cheapest path is
`gpt-oss-120b` on a paid tier — not more Gemma-4 capacity.

Do **not** try to multiply free capacity with multiple Cerebras accounts.
Cerebras applies rate limits at the *organization* level and its Acceptable Use
Policy forbids imposing "disproportionately large load" and transferring API
keys; multi-account free-tier farming is rate-limit circumvention and risks
suspension of every account, including the one serving production.

## Builder semantic editor

`/api/builder/ai-edit` is intentionally separate from the general chain. It
generates a validated, non-persisted edit plan rather than a complete storefront
configuration. Its required, credential-attested target order is Google-hosted
`gemma-4-31b-it`, then Groq `openai/gpt-oss-120b`; a pinned OpenRouter
`google/gemma-4-31b-it:free` transport may be appended only after an explicit,
dated approval for that exact model.

During the staged provider switch, a still-valid Cerebras `gemma-4-31b` plus
Groq attestation remains a temporary runtime-only fallback. The first deployment
therefore keeps Builder AI available while the bootstrap route writes the new
`GOOGLE_BUILDER_*` binding rows for the next deployment snapshot. Once Google
materializes successfully after that deployment, it takes precedence and the
Cerebras transition path can be removed.

Both providers in the selected reliable pair require a fresh deployment-bundle attestation:
non-secret account reference, deployment tier label, exact approved model,
release timestamp, and a provider-domain-separated HMAC binding tag derived
from the active key and a deployment-only pepper. This is an integrity binding,
not provider-verified account or tier truth; confirming provider account/tier
requires separate, dated management-plane evidence. If either deployment
attestation is absent, invalid, or stale, the Builder route and the
paid-provider smoke test refuse before a provider request. The smoke test is externally owner-approved with
`BACI_APPROVE_PAID_AI_SMOKE=1`; it is not an automatic deployment check.

The Builder path uses `generateText` with JSON transport plus local Zod and
semantic validation. It never imports the legacy Gemini, generic provider, or
Ollama chains. The legacy `/api/builder/gemini` endpoint is only a compatibility
adapter that returns `{ config }` from the same validated candidate handler.
