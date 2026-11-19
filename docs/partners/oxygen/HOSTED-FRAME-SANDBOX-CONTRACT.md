# Oxygen hosted-frame sandbox contract

Status: **unconfirmed; production enablement remains gated.** The payment and
selfie frames currently have no `sandbox` attribute. An allowlisted frame can
navigate the top-level checkout, so the lack of a sandbox is an unresolved
security risk. Do not treat host validation, Permissions Policy, or the
origin-checked selfie message as protection against top-level navigation.

The available evidence does not establish a compatible sandbox token set.
[Hydrogen's single-payment documentation](https://docs.hydrogenpay.com/reference/single-payment)
describes card and bank-transfer checkout and a required post-payment redirect,
but does not state whether the redirect occurs inside the frame or requires
top-level navigation. The local payment recovery record says the hosted link
was not opened or paid in that observation; its status-only read does not prove
the browser checkout or redirect works under a sandbox. The available Oxygen
selfie material does not specify iframe sandbox or camera compatibility.

Before changing either frame, obtain written confirmation from Oxygen and the
relevant hosted-page/payment providers for each configured staging and
production origin:

1. Whether embedding is supported and which sandbox tokens are necessary for
   scripts, forms, same-origin behavior, storage, and camera access.
2. Whether any payment method, bank redirect, card authentication or 3-D Secure
   flow opens a popup, uses an OAuth handoff, downloads a document, or requires
   top-level navigation; specify user-gesture and popup escape requirements.
3. The exact completion and error return behavior, including navigation target,
   redirect origins and any message origin, source and payload contract for
   payment, repayment setup and selfie verification.
4. Whether selfie capture and phone handoff work with sandbox restrictions and
   the existing camera Permissions Policy, including browser-specific needs.
5. Supported test fixtures and an authorized staging procedure covering each
   payment method, cancellation/failure, identity verification, redirects and
   recovery after closing the frame.

Then select the least-permissive independently verified tokens, retain exact
origin validation and authoritative server-side status checks, and test both
frame behavior and denial of unneeded capabilities. Do not add top-navigation
permissions merely to make a blocked flow proceed. A mocked iframe test cannot
establish provider compatibility; record the actual authorized staging evidence
and any remaining risk before enabling production.
