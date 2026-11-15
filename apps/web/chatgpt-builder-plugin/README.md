# Baci Website Builder package source

This directory is a **preparation source**, not an installable or upload-ready plugin. No app ID, submission ID, existing binding, tool refresh or upload is performed.

`plugin.json` uses the Agent Plugins format. Its listing targets the full-code storefront surface. The production connection must advertise and pass the experience-tool workflow before this listing may be uploaded; the default portable-homepage listener does not satisfy it. The Baci icon is reused from the existing repository brand asset. Verify the publisher identity, legal URLs and portable `mcp.json` against the deployed Baci endpoint. There is deliberately no invented endpoint binding, `.app.json`, compatibility app alias or fake skills-only ZIP.

An endpoint or local test is not proof of the live connection. After the intended endpoint's OAuth, discovery and host qualification, generate the archive in a separate output directory with one root folder `baci-website-builder/`, containing the manifest, `mcp.json` and referenced assets. Inspect the actual archive, test installation using a synthetic account and bind its hash to the tested source. No dependency directories, symlinks, credential files, provider secrets or reviewer passwords may enter it.

The user authorized preparing and uploading the intended draft for review, but final submission is reserved for the user. Inspect the saved draft before replacing its bundle because an upload can reset saved fields and attestations. The actual callback, synthetic reviewer account, demo recording, policy coverage, qualified live connection and final ZIP remain unverified. Do not confirm storefront publication, create orders or initiate payments during testing.

## Direct Contabo connection candidate

`mcp.config-draft.json` targets the selected dedicated builder hostname and a
provided public PKCE client. It is not active `mcp.json` or an upload-ready
archive. The saved portal draft inspected on 15 November still references the
old MCP URL and contains no provided-client authentication configuration.
The broker disables dynamic registration, so default automatic registration
is not a compatible setup. Qualify the new endpoint and register the exact
ChatGPT callback before promoting this draft config to `mcp.json`. The public
client ID must match the operator config; no client secret is required for the
outer public client. The separate confidential upstream Supabase client still
requires its own secret, stored only in private server configuration.

Configuration shape: https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication
