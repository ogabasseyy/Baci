# OTP verification field

Import `OtpVerificationField` from `@/components/ui/otp-verification`.
This is a controlled web UI component. It sends no requests, stores no code and
never infers successful verification from an animation or a complete input.
The existing Oxygen screens use it through their compatibility export.

```tsx
<OtpVerificationField
  value={code}
  onChange={setCode}
  length={6}
  label="Email verification code"
  pending={checking}
  verified={confirmedByServer}
  error={error}
  onComplete={checkCode}
/>
```

Omit `onComplete` when verification requires an explicit button. Support for 4
and 6 digits, form/name/id, custom hint/status messages and concealed digits is
built in. Server verification, resend limits, provider expiry rules and sensitive-data handling
belong to the caller. Clear codes when a flow ends; do not log or persist them.

The visual sequence is active focus → red streak on grey boxes → red stack →
controlled green success. Pending and verified states hide digits and disable
input. Invalid/error states restore entry when the caller clears pending.
`onStackComplete` reports a visual event only: it must never authorize a loan,
login or payment. The Oxygen simulation alone uses it to preview success.

Six fixed-size square cells preserve the existing layout; four-digit layouts
use the same sizing rules. Reduced motion removes movement. Checking/success
announcements use a polite live region. Keyboard navigation, paste normalization
and mobile autofill use the existing input-otp primitive.

Motion uses transform/opacity, a prepainted highlight and conditional layer hints;
there is no animation dependency or per-frame React update. The optional expiry
countdown uses one once-per-second timer.
Do not animate geometry, continuously animate gradients, or change verification
semantics while styling. Local tests and throttled browser checks do not prove
unchanged production Core Web Vitals.

## Five-minute expiry

Pass `sentAt` as the acknowledged request's epoch milliseconds. The default
`OTP_CODE_TTL_SECONDS` is 300, as confirmed for Oxygen on 2026-10-24; other callers
can pass `ttlSeconds` for their provider's contract. Omitting `sentAt` leaves timing
unmanaged rather than inventing a new five-minute window at mount.

The countdown updates once per second from an absolute deadline, catches up after
a background tab resumes, and stops after expiry or verified success. Expired codes
are hidden and cannot trigger completion. The timer is not a live region, so screen
readers do not announce every second. The expired state is announced once.

`onResend` is optional and runs only on an explicit click; it receives no OTP.
Return true only after the provider acknowledges the request, then update `sentAt`
from the persisted request record and clear the caller's code. Failed or uncertain
requests must not reset the window or retry automatically. Request rate limits are
separate from validity: a five-minute lifetime is not a five-minute resend cooldown.
The module does not override the server's final verification decision.

Oxygen approval timing comes from an authenticated, ownership-scoped read of the
existing command ledger, correlated to the exact booking reference. Request-start
time is used conservatively so network delay cannot extend the five-minute window.
Unknown timing stays read-only until a fresh acknowledged request is available.
The simulation has its own demonstration clock and never requests a real code.

Server-confirmed animation: `pending` keeps the red highlight orbiting the separate grey boxes for the whole request. It never starts the stack or indicates success. Set `verified` only after the server has confirmed the operation; this starts the 420 ms stack followed by the green tick. `onStackComplete` is a visual callback after confirmation, never evidence of verification. Oxygen approval holds its confirmed destination briefly for this success sequence, skips the pause for reduced motion, and releases it safely if the component unmounts. Errors and indeterminate responses never receive a success transition.
