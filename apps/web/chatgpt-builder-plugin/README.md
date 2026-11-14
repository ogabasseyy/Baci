# Baci Website Builder package source

This directory is a **preparation source**, not an installable or upload-ready plugin. No app ID, submission ID, existing binding, tool refresh or upload is performed.

`plugin.json` uses the Agent Plugins format. Its current listing describes the earlier portable-homepage surface and must be reconciled with the actual qualified full-code capability before packaging. The Baci icon is reused from the existing repository brand asset. Verify the publisher identity, legal URLs and portable `mcp.json` against the deployed Baci endpoint. There is deliberately no invented endpoint binding, `.app.json`, compatibility app alias or fake skills-only ZIP.

An endpoint or local test is not proof of the live connection. After the intended endpoint's OAuth, discovery and host qualification, generate the archive in a separate output directory with one root folder `baci-website-builder/`, containing the manifest, `mcp.json` and referenced assets. Inspect the actual archive, test installation using a synthetic account and bind its hash to the tested source. No dependency directories, symlinks, credential files, provider secrets or reviewer passwords may enter it.

The user authorized preparing and uploading the intended draft for review, but final submission is reserved for the user. Inspect the saved draft before replacing its bundle because an upload can reset saved fields and attestations. The actual callback, synthetic reviewer account, demo recording, policy coverage, qualified live connection and final ZIP remain unverified. Do not confirm storefront publication, create orders or initiate payments during testing.
