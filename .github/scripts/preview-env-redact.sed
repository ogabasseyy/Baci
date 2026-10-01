# Redact privileged Preview values before the untrusted build can observe
# them. One expression per key (explicit over clever for a security list;
# portable across BSD/GNU sed, unlike alternation backreferences).
#
# These keys are runtime-only (API routes, cron, workers, providers): the
# build never consumes them (SSG uses the anonymous Supabase client; only
# presence is validated), so they are blanked here. SUPABASE_SERVICE_ROLE_KEY
# additionally receives a presence stand-in later (env validation requires
# it non-blank). URL-valued entries (EDGE_CONFIG, *_KV_URL, *_REDIS_URL)
# embed bearer tokens by provider convention, so they are credentials, not
# endpoints. If redaction misses a key, the exposure allowlist check
# fails the workflow: denied keys must NOT appear in preview-env-allowlist.txt.
s/^ADDRESS_AUTOCOMPLETE_KV_REST_API_READ_ONLY_TOKEN=.*/ADDRESS_AUTOCOMPLETE_KV_REST_API_READ_ONLY_TOKEN=""/
s/^ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN=.*/ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN=""/
s/^ADDRESS_AUTOCOMPLETE_KV_URL=.*/ADDRESS_AUTOCOMPLETE_KV_URL=""/
s/^ADDRESS_AUTOCOMPLETE_REDIS_URL=.*/ADDRESS_AUTOCOMPLETE_REDIS_URL=""/
s/^AUTONOMA_SECRET_ID=.*/AUTONOMA_SECRET_ID=""/
s/^BLOG_PREVIEW_SECRET=.*/BLOG_PREVIEW_SECRET=""/
s/^CRON_SECRET=.*/CRON_SECRET=""/
s/^EDGE_CONFIG=.*/EDGE_CONFIG=""/
s/^GEMINI_API_KEY=.*/GEMINI_API_KEY=""/
s/^GO54_API_KEY=.*/GO54_API_KEY=""/
s/^GOOGLE_GENAI_API_KEY=.*/GOOGLE_GENAI_API_KEY=""/
s/^IMPORT_JOB_WORKER_SECRET=.*/IMPORT_JOB_WORKER_SECRET=""/
s/^INTERNAL_API_SECRET=.*/INTERNAL_API_SECRET=""/
s/^KV_REST_API_TOKEN=.*/KV_REST_API_TOKEN=""/
s/^SUPABASE_SERVICE_ROLE_KEY=.*/SUPABASE_SERVICE_ROLE_KEY=""/
s/^VERCEL_OIDC_TOKEN=.*/VERCEL_OIDC_TOKEN=""/
s/^ZEPTOMAIL_MAILAGENT_KEY=.*/ZEPTOMAIL_MAILAGENT_KEY=""/
s/^ZEPTOMAIL_TOKEN=.*/ZEPTOMAIL_TOKEN=""/
s/^ZOHO_CLIENT_SECRET=.*/ZOHO_CLIENT_SECRET=""/
s/^ZOHO_REFRESH_TOKEN=.*/ZOHO_REFRESH_TOKEN=""/
