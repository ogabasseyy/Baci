# Oxygen production authentication check — corrected 6 October 2026

## Confirmed result

The user authorized testing the existing production dashboard keys and supplied the
corrected endpoint. Keys were obtained through the portal's Copy controls, kept only
in transient process memory, sent to Oxygen for login, and cleared. The previous
clipboard text was restored. Neither keys nor returned token were printed or saved.

- Portal: `https://now.oxygenx.africa/app/partners/api-keys`.
- Login: `POST https://api.oxygenx.africa/services/partners/v1/partner/login`.
- Request: JSON `reference` and `secret` from the respective Copy controls.
- Result: HTTP 200, token received, Bearer token type, `expires_in: 300`.
- Read-only lookup: authenticated
  `GET https://api.oxygenx.africa/services/partners/v1/eligibility/banks`.
- Result: HTTP 200, JSON bank list with 44 entries.
- Token discarded after the lookup; no token cache or credentials were persisted.

This verifies the current production-dashboard key pair at the user-supplied host
and one authenticated lookup. It does not establish a tested Development/Staging
mapping or a complete financial/customer journey. CR-01 is partially closed for this
production pairing; CR-02 expiry is observed, while rotation/retry guarantees remain open.

## Correction to earlier failed tests

Earlier requests read password-field values through the browser's read-only DOM
representation. That representation substitutes `<redacted>` for real credentials.
Those HTTP 400 `invalid login credentials` results did NOT test the dashboard keys.
The initial interpretation blaming key/account/environment compatibility was unsupported
and is withdrawn. A later metadata check identified the redaction marker; the Copy
controls supplied actual values for the successful test above.

The earlier credentials-free bank lookup and HEAD request returned HTTP 401. They
established only unauthenticated access barriers, not key validity or environment mapping.
No real-key authentication was performed against the earlier `api.theoxygen.com` host,
so its compatibility with this key pair remains untested.

No customer data, loan creation, eligibility request, booking, approval, activation,
payment, webhook configuration, deployment, merge or partner message was performed.
