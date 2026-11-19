# Oxygen hosted-page observation

For a controlled production pilot, response evidence retains hosted origins and rejected hostnames encrypted for 24 hours. The diagnostic endpoint is disabled by default and must be enabled only for the pilot user's exact authenticated account. It checks ownership of the workflow and decrypts evidence bound to both the workflow and command ID. It returns hostname strings only, without paths, queries, signed links, or provider response bodies. A hostname is an observation, not authorization to allow it: verify its provider ownership before changing a hosted-origin policy.

An operator can obtain the pilot workflow and its command IDs from the restricted database using a read-only, workflow-scoped query, then call the endpoint while signed in as the configured pilot user. Disable the diagnostic flag after observation. Evidence expires after 24 hours; do not repeat an indeterminate financial operation merely to generate another observation.
