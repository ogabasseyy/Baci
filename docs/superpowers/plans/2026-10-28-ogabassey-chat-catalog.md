# Ogabassey chat response and catalog grounding

## Goal

Return useful shopping results promptly using the resolved storefront's public catalog. Never present invented product facts or broaden order/payment authority. Keep production release separate from this implementation.

## Work

1. Add a bounded, read-only fast path for recognizable shopping requests without sending additional messages to an AI provider. Resolve catalog categories and candidates through the existing public storefront boundary. Return only validated server-owned product cards, with a safe response on ambiguous requests, empty results, or failures.
2. Preserve the existing order/payment route and its no-replay protections. A fast-path timeout or invalid proposal must not turn an action request into an action or an ungrounded shopping answer.
3. Respect selected variants and price uncertainty. Ordinary phone recommendations must exclude Wi-Fi-only offers; explicitly requested Wi-Fi-only options remain selectable. Do not present an unverified parent price for a selectable family.
4. Remove static provider and availability claims from the widget, and give customers a clear response while catalog retrieval is unavailable.
5. Add regression tests for the observed long fallback and false recommendation, category mismatch, tenant scoping, variant and budget constraints, failed providers, and action isolation. Run affected web tests, lint, typecheck, and required review; record live-provider and deployment validation separately.

## Review focus

- A catalog search for gaming phones must not recommend gaming chairs or laptops.
- A failed provider or catalog read must not produce invented products, specs, prices, or stock claims.
- A timed-out or duplicate request must not replay payment or cancellation actions.
- Phone variant eligibility and prices must be based on public catalog evidence; uncertainty must fail closed.
- Legacy text clients and the storefront's rich-card transport must both receive truthful results.

## Conversation provider continuation

- For the resolved Ogabassey storefront in `auto` mode, keep the catalog path first. When configured, use GPT-6 Luna for general conversation and DeepSeek Flash as its backup, with bounded timeouts and no commerce tools. Other storefronts and explicit provider modes retain their existing paths.
- Keep order, payment, checkout, and related follow-ups on the existing guarded commerce path. Do not turn a failed or ambiguous action into a claimed success. For unsupported catalog questions or unverified product follow-ups, direct the shopper to the catalog or store support rather than inventing product details.
- Storefront chat messages sent to the model providers require an accurate public disclosure. The proposed privacy-page copy names OpenAI and DeepSeek without making retention or compliance promises; confirm the effective page and owner review before release.

## Release evidence still required

Provision usable provider credentials through the owner's approved workflow, without placing secrets in the repository. In a non-production deployment, verify Luna and DeepSeek separately, force the primary to fail to exercise backup, and compare phone and accessory cards, prices, stock, compatibility guidance, follow-ups, and tenant isolation with the current catalog. Test general conversation, negotiation, commerce handoff, client cancellation, safe errors, and the privacy disclosure; record latency and cost. No real order or payment should be created during the smoke test. A release decision also requires checks and review for the exact final commit and PR base.
