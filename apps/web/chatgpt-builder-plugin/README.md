# Baci Website Builder package source

This directory is a **preparation source**, not an installable or upload-ready plugin. No app ID, submission ID, existing binding, tool refresh or upload is performed.

`plugin.json` uses the Agent Plugins format documented by OpenAI on 2026-10-22. Listing and feature boundaries are prepared here; the Baci icon is reused from the existing repository brand asset. Before final packaging, review identity/legal URLs and create a verified portable `mcp.json` for the newly deployed Baci endpoint. There is deliberately no invented endpoint binding, `.app.json`, compatibility app alias or fake skills-only ZIP.

The proposed staging endpoint is not proof of a deployed server. After its real OAuth/discovery/host qualification, generate the archive in a separate output directory with one root folder `baci-website-builder/`, containing the manifest, `mcp.json` and referenced assets. Inspect the actual archive, test installation in an isolated developer connection and bind its hash to the tested SHA. No dependency directories, symlinks, credential files, provider secrets or real reviewer passwords may enter it.

Do not upload, create a new app/submission, change either existing submission or publish without a later instruction. Reviewer account provisioning, the exact callback from the new developer connection, demo recording and final ZIP are pending staging qualification.
