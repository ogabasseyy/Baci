# Builder AI provider release attestation

Reliable Builder providers are enabled only when the deployment contains a
fresh release-attestation record for each provider. Each record has a
non-secret account reference, deployment tier label, approved model, release
timestamp, and a provider-domain-separated HMAC-SHA-256 binding tag derived
from the active credential and a dedicated deployment pepper. The runtime
recomputes that tag and fails closed when the tag, model, or timestamp does
not match. Neither the tag nor the pepper is logged or returned.

This is a deployment-bundle integrity control, not a provider identity check.
The installed inference SDKs do not expose provider account, project, billing,
or tier identity offline. Consequently Baci does not claim that the deployment
has provider-verified tier access. Confirming account or tier truth requires
separate, dated management-plane or console evidence; that live check is kept
outside request handling and must never expose credentials.
