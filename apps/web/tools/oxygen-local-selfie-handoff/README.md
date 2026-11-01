# Temporary local Oxygen phone handoff

This bridge is a staging QA helper, not a production deployment. It never proxies the storefront, admin, general APIs, or provider mutations. The public server accepts only `GET /selfie` and `POST /exchange`. Its issuer binds separately to loopback port 3456.

Install the pinned `requirements.txt` in a private Python venv outside the checkout. Set `OXYGEN_HANDOFF_ORIGIN_FILE` to an owner-only text file containing the temporary HTTPS tunnel origin. Run `server.py`, then expose only `http://127.0.0.1:3455` using an owner-authorized tunnel. Store tunnel output and configuration outside Git. The current QA adapter accepts only a `*.trycloudflare.com` HTTPS origin.

The local development checkout's authenticated `phone-handoff` endpoint issues the QR after customer ownership and normal worker/application binding checks. Production and non-local runtimes reject this endpoint. No credentials or provider URLs belong in CLI arguments, logs, screenshots for publication, or this directory.

The QR contains a random, single-use fragment token. The bridge holds only its hash and the trusted provider URL in memory, for at most five minutes and no longer than the provider token's expiry. The phone clears the fragment, exchanges it over HTTPS, and navigates directly to Oxygen without a second confirmation page. Failed or expired links show a short recovery message. Process restart invalidates pending QRs.

Generate a new QR in checkout after restarting the bridge. Keep the laptop's existing application open; its bounded KYC reads confirm selfie completion independently of the phone browser. No NIN retry, booking, approval, activation or settlement is performed by the bridge.

Run `python test_server.py` for the deterministic token/trust/expiry checks. Production support requires an approved public deployment and a shared durable store with the same scope and expiry guarantees; this in-process QA bridge must not be promoted as production infrastructure.
