# Oxygen application continuation across chat channels

## Implemented boundary

`POST /api/payments/oxygen/chat` is the shared deterministic continuation API for
webchat and an authenticated, account-linked WhatsApp adapter. Both resume the
existing `oxygen_workflows` row for the supplied order through
`oxygen_start_workflow`. The database checks the authenticated customer's order
ownership, including merchant membership. A unique order constraint prevents a
second workflow when a transport retries or another channel resumes.

This endpoint does not collect sensitive data in conversation, call an LLM, send
messages, invoke Oxygen, enqueue commands, approve, activate, or settle anything.
Activation and settlement flags are always false. This is staging-only; production
workflow snapshots fail closed. The public commerce `/api/chat` route has no new
Oxygen authority.

## Input and response

```json
{
  "orderId": "8bb42a9f-9fb5-4ab4-a546-670e28f005f9",
  "messageId": "transport-message-1",
  "channel": "webchat",
  "intent": "resume"
}
```

`channel` is `webchat` or `whatsapp`; `intent` is `resume` or `status`.
`messageId` is a bounded transport correlation identifier, not an authentication
credential or an exactly-once outbound-message ledger. Do not embed phone numbers,
identifiers, session credentials or raw message text in it. The API accepts no
extra fields. Both intents can create a metadata-only workflow when one is absent;
neither starts the provider application. Repeated deliveries are safe because
workflow creation/resumption is unique per owned order and queues no work. Replies
may show a newer authoritative stage after a concurrent form update, rather than
replaying a stale cached status. Transport sending still needs its own delivery
idempotency record keyed by transport/message ID.

The response contains only:

- Correlation ID and channel.
- Workflow ID, stage and version.
- A static stage-specific prompt.
- A `secure_handoff` action pointing to `/payments/oxygen/{orderId}`.
- `activationEnabled: false` and `settlementEnabled: false`.

No BVN, NIN, date of birth, account information, checkout phone, address, provider
reference, hosted provider URL, OTP, identity token or decrypted draft is projected.
The handoff route requires the customer's authenticated web session and rechecks
ownership. It resumes the same secure form, which owns autosave and verification.
This is secure-form continuation, not sensitive identity collection inside chat.
A bearer token used by a linked adapter is never put into that link; if the browser
has no session, the customer must sign in. Preserve the handoff destination through
the normal login flow rather than creating a bearer-in-URL login workaround.

## Reusable adapters

`createOxygenChatAdapter(channel, transport)` validates structured commands and
responses. The injected transport calls the endpoint with the customer's existing
normal Supabase authentication. It rejects unexpected response fields, mismatched
message/channel correlation and a handoff for a different order.

`formatOxygenWebchatReply` returns renderer-neutral text/action descriptors.
`formatOxygenWhatsAppReply` returns a text payload with a secure application link.
Neither sends anything. The application origin is a trusted configured HTTPS
origin, not a message field or unvalidated Host header. Raw provider/payment URLs
are never inserted into a reply.

For signed-in webchat, the transport uses same-origin cookies and the normal CSRF
header, just like existing application mutations. The endpoint verifies CSRF for
cookie requests. A normal, verified customer bearer session is accepted for linked
server adapters; it does not require a browser CSRF token. Responses are no-store.

## WhatsApp connection still required

A future inbound adapter must first validate the provider's webhook signature and
resolve an explicitly linked customer account. A verified webhook proves the
transport, not ownership of an Ogabassey customer or order. Never derive customer
authority from sender phone alone, an order ID, LLM arguments, a channel value, or
a service-role client. Do not store customer bearer sessions in chat transcripts.
Any server credential storage/account linking needs a separately reviewed session
lifecycle, revocation and transport replay protection.

After linking, pass the customer's normal scoped session to the continuation
transport and use the formatter for the outgoing reply. Unlinked senders should
receive an account-link/sign-in flow before any application metadata is read.
There is no deployed Meta webhook, new WhatsApp registration, outbound send or
phone-to-account binding in this implementation. Provider credentials, callback
registration and transport verification must be configured/tested before claiming
WhatsApp is live. The deterministic pipeline can be exercised now using a normal
signed-in customer session.

## Verification

Colocated tests cover cross-channel same-order continuation, duplicate delivery,
CSRF/bearer boundaries, authentication and ownership errors, strict rejection of
sensitive/financial input, sanitized projections for every stage, matching reply
correlation and trusted HTTPS handoff formatting. Integration with a real
WhatsApp transport and outbound delivery are separate checks.
