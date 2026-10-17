# Ogabassey generative search: research and recommendation

Date: 2 October 2026. Status: researched recommendation; no framework installed or generative-search runtime implemented. Documentation and current source reviewed; candidate SDKs have not been exercised on devices.

## Recommendation

Build controlled generative shopping assistance around the existing search and commerce contracts. Start with a small set of trusted shopping components and reuse Baci's existing presentation approach. If flexible composition merits a renderer dependency, trial `@json-render/react` and `@json-render/react-native` with the same domain catalog. Treat A2UI as an interoperability option, with an explicit protocol-version adapter and compatibility tests.

The keyboard-adjacent input and cards rendering independently of images are ordinary UI/performance work. They do not require an LLM or a generative UI framework. Ship and evaluate them independently so generation latency never blocks ordinary catalog search.

## What Google means by Gen UI

Google's November 2025 [Dynamic View research](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/) describes complete custom interfaces generated as HTML/CSS/JS. Its preference evaluation excluded generation speed, and that historical implementation sometimes took a minute or more. Those observations concern the published research, not a benchmark of today's models or Baci. It does not establish that generating an entire commerce screen improves conversion.

[A2UI](https://a2ui.org/) is a declarative protocol: agents send component descriptions and data, and clients render trusted components. Current documentation labels v0.9.1 current, v0.9 previous stable and v1.0 candidate. It is a UI protocol, not a search engine, model, payment system or keyboard library. Google announced an official React renderer in its [v0.9 update](https://developers.googleblog.com/en/a2ui-v0-9-generative-ui/); React web support must not be assumed to mean official React Native support.

Google's [Flutter GenUI SDK](https://github.com/flutter/genui) is a Flutter implementation. Its README calls it highly experimental and announces a redesign into modular packages with a different API. Baci uses Expo/React Native and Next.js; this SDK would introduce a separate application stack.

## Candidate comparison

| Option | Verified capability | Fit and limitations |
| --- | --- | --- |
| Extend Baci presentation events | Versioned Zod contract, bounded product cards from server-owned tool results, normal cart integration and option-selection routing | Best first production increment; add shared domain events and native renderer. Flexible layout composition would be our responsibility. |
| json-render | Documented React and React Native renderers, custom component registry, state/action providers, progressive JSON patch stream | Preferred external candidate to prototype for both surfaces. Pin compatible releases and verify Expo streaming, custom commerce components and accessibility. Documentation is not proof of production suitability. |
| A2UI with native renderer | Cross-platform protocol and official web React renderer; ecosystem lists community RN renderer | Useful when interoperability is a requirement. Community RN project documents MVP scope; ecosystem table lists v0.8 support. Current v0.9.1 support must be proven before adoption. |
| react-native-gen-ui | Expo streaming chat, OpenAI function calls mapped to components | RN-specific candidate, with OpenAI-focused documented API. No demonstrated shared web contract. README shows a public client key example and explicitly requires a server proxy for production. Our implementation must keep credentials server-side. |
| Flutter GenUI | Flutter widget catalog, A2UI, data binding | Poor fit for this monorepo; experimental API and separate framework. |

Primary sources: [json-render renderers](https://json-render.dev/docs/renderers), [React Native API](https://json-render.dev/docs/api/react-native), [streaming](https://json-render.dev/docs/streaming), [A2UI renderer ecosystem](https://github.com/a2ui-project/a2ui/blob/main/docs/public/ecosystem/renderers.md), [community RN implementation](https://github.com/sivamrudram-eng/a2ui-react-native), [react-native-gen-ui](https://github.com/zerodays/react-native-gen-ui).

json-render's [A2UI integration guide](https://json-render.dev/docs/a2ui) provides an adaptation example. It is not evidence that every native renderer supports the current A2UI protocol unchanged. Keep the domain contract independent of renderer formats.

## What is actually on ground

Verified in the search worktree:

- `apps/web/src/schemas/storefront-agent-ui-contract.ts`: only `present_products` currently, with discover/details/recommend/add_to_cart intents; up to three events and six products per event. This is not full comparison/cart-summary UI.
- `apps/web/src/app/api/chat/create-chat-presentation-event-collector.ts`: maps server-owned search, recommendation, detail and add-to-cart tool results into validated presentation products.
- `apps/web/src/components/storefront/ogabassey/components/chat/agent-ui-event-renderer.tsx`: renders trusted product cards, integrates normal cart, and routes products requiring options to details.
- `apps/web/src/app/api/chat/negotiate-chat-agent-ui-response.ts`: awaits `response.text()` before returning the JSON envelope. Structured responses are buffered rather than streamed incrementally.
- No equivalent assistant presentation-event renderer was found in mobile-storefront by source search. Native search has its own cards, cart and variant-selection flow. Follow-up inspection confirms existing native comparison store/screen and Ogabassey web comparison provider/table; the gap is connecting these to search/assistant and refreshing factual data, not creating comparison from scratch.
- Web manifest specifies AI SDK 6; current public documentation defaults to 7. Use version-matched docs and dependencies; do not copy latest snippets into the installed major without checking.

These are source observations, not deployment or customer-delivery claims.

## Proposed customer experience

1. Focus search: keep the result region stable and animate a single input above the native keyboard. Keep focus, cursor and composition intact. Do not unmount/recreate it during motion. Use the existing keyboard-controller abstraction.
2. Typing ordinary keywords continues regular catalog search. Generative assistance runs on deliberate submission, a suggestion tap or an explicit follow-up, rather than paying for a model request on each keystroke.
3. A request such as “used iPhone under ₦500k, good camera” yields editable Apple/Used/budget filters and real catalog matches. Ask a short clarification when the request is ambiguous; do not silently convert preferences into hard exclusions.
4. Render complete, validated cards when catalog records arrive. Show text/prices immediately, with fixed image placeholders. Do not let streamed prose delay catalog cards. Keep item IDs stable, prevent stale requests from overwriting newer intent and avoid reordering under a shopper's finger.
5. Offer a comparison of selected products using verified specs. Missing data remains missing. The model may summarize supported differences, with an explanation based on the facts shown.
6. A user who already knows the item can choose exact storage/colour/condition in a focused selector, then continue to existing checkout. A user who needs warranty/spec details can still open the product page and return to the same search position.
7. Cart summary, delivery choices and order review use normal commerce components and current server facts. The final purchase remains an explicit customer action.

Desktop keeps its search field in the header with space for results and comparisons. Native uses keyboard-synchronized positioning. Mobile web needs real browser viewport testing; don't assume native geometry is portable. Browser Back, native Back, keyboard dismissal and returning from checkout must preserve query/filter state appropriately.

For electronics, [Baymard's quick-view research](https://baymard.com/research-articles/ecommerce-quick-views) supports exposing meaningful list attributes and comparison rather than inserting a generic product-preview layer. A focused option selector should serve a known purchase decision, not duplicate an incomplete product page.

## Implementation boundaries

Shared package: versioned domain event schemas, request/response IDs and action payload types. Apps own their platform components. Web's app-specific schema cannot be imported directly into native; extract reusable contract logic deliberately and include both consumers in validation.

Proposed component catalog: ProductResults, AppliedFilters, ClarificationChoices, ProductComparison, VariantSelector and CartSummary. Model requests refer to catalog IDs or tool results; clients resolve authoritative commerce records. No model-authored prices, stock, checkout URLs, executable JSX/HTML or unrestricted navigation actions.

Backend: preserve trusted storefront merchant resolution, normal RLS clients, input validation, current AI rate limits, bounded catalog results and explicit mutation handlers. Validate component parameters and action arguments independently. A valid UI schema is not authorization to change a cart, create an order or charge a payment.

Streaming: use a bounded event stream with request IDs, complete validated events, cancellation and termination/error events. Retain a supported buffered response for clients that cannot stream. AI SDK's [Expo guide](https://ai-sdk.dev/docs/getting-started/expo) uses `expo/fetch` for streaming; test the actual installed SDK major, Expo client and deployed endpoint. Test reverse-proxy buffering and disconnects. The renderer library does not itself eliminate backend buffering.

Keep search failure distinct from model failure: if assistance times out or generates invalid UI, ordinary search/filter/cart controls remain usable. Preserve complete cards already shown; never render incomplete actionable product or checkout state.

## Recommended delivery sequence

1. Prototype keyboard positioning and stable progressive cards with deterministic fixtures on iOS/Android and desktop/mobile web.
2. Extend existing presentation contracts and build the native renderer; keep normal keyword search immediate. Add controlled intent-to-filter assistance behind a reversible feature flag.
3. Add comparison and exact-option selection backed by normal product APIs, followed by existing checkout.
4. Trial json-render against the Baci event renderer using the same fixtures. Adopt only if it reduces complexity without worsening latency, behavior or accessibility.
5. Add an A2UI adapter only when external agent interoperability is an actual requirement and current-version compatibility is verified.

Evaluate first usable card time and image-independent rendering, total time/actions to choose and purchase, correct variant/condition/price, cancellation and stale-response behavior, cost per assisted search, keyboard focus/visibility, TalkBack/VoiceOver and reduced-motion behavior. Include slow images, interrupted streams, malformed events, unknown components, empty results, missing specs, stock changes and network loss. Initial measurements establish thresholds; no arbitrary speed or conversion claims.


Implementation plan: [Generative search with existing commerce flow](../superpowers/plans/2026-10-02-ogabassey-generative-search.md).
