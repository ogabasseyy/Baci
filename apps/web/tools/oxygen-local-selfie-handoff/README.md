# Temporary local Oxygen phone handoff

This bridge is a staging QA helper, not a production deployment. It never proxies the storefront, admin, general APIs, or provider mutations. The public server accepts only `GET /selfie` and `POST /exchange`. Its issuer binds separately to loopback port 3456.

Install the pinned `requirements.txt` in a private Python venv outside the checkout. Set `OXYGEN_HANDOFF_ORIGIN_FILE` to an owner-only text file containing the temporary HTTPS tunnel origin, and set `OXYGEN_HANDOFF_ALLOWED_ORIGIN` to that exact origin (no path, credentials, port, query or fragment). Generate a random 32-byte hex `OXYGEN_HANDOFF_ISSUER_SECRET` and supply it securely to both the bridge and the local web server. Use owner-only files outside the checkout or a secret manager; do not print it. Start the bridge and web server with these environment variables, then expose only `http://127.0.0.1:3455` using an owner-authorized tunnel. The issuer port 3456 must remain loopback-only. The origin file must match the pinned origin exactly; update both if a newly authorized tunnel changes it. Missing or mismatched configuration fails closed. The current QA adapter accepts only a `*.trycloudflare.com` HTTPS origin.

The local development checkout's authenticated `phone-handoff` endpoint issues the QR after customer ownership and normal worker/application binding checks. Production and non-local runtimes reject this endpoint. No credentials or provider URLs belong in CLI arguments, logs, screenshots for publication, or this directory.

The QR contains a random, single-use fragment token. The bridge holds only its hash and the trusted provider URL in memory, for at most five minutes and no longer than the provider token's expiry. The phone clears the fragment, exchanges it over HTTPS, and navigates directly to Oxygen without a second confirmation page. Failed or expired links show a short recovery message. Process restart invalidates pending QRs.

Generate a new QR in checkout after restarting the bridge. Keep the laptop's existing application open; its bounded KYC reads confirm selfie completion independently of the phone browser. No NIN retry, booking, approval, activation or settlement is performed by the bridge.

Run `python test_server.py` for the deterministic token/trust/expiry checks. Production support requires an approved public deployment and a shared durable store with the same scope and expiry guarantees; this in-process QA bridge must not be promoted as production infrastructure.
