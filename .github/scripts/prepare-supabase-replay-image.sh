#!/usr/bin/env bash
set -euo pipefail

# CLI 3.1.0 starts exactly these database/schema-init images because the replay writes their tags into the
# project's supabase/.temp/*-version pin files before `db start`
# (apps/web/tools/db/supabase-replay-image-pins.ts). They are the images CLI v2.111.0 shipped as defaults:
# https://github.com/supabase/cli/blob/v2.111.0/apps/cli-go/pkg/config/templates/Dockerfile
# and they keep the replay on PostgreSQL 17.6 (server_version_num 170006) like the committed production
# fixture. CLI 3.1.0's own, newer defaults are in:
# https://github.com/supabase/cli/blob/v3.1.0/apps/cli/src/shared/services/Dockerfile
# Both official registries publish identical linux/amd64 manifest digests.
# This covers db start; optional gen-types additionally needs postgres-meta.
if [[ "$(supabase --version)" != "3.1.0" ]]; then
  echo "Supabase replay image pins require CLI 3.1.0" >&2
  exit 1
fi

images=(
  'postgres:17.6.1.156@sha256:665efa7e234a3c324718fd2b7fbbaaaf7263f2565bc2e8fce8555c4def4c4985'
  'realtime:v2.120.3@sha256:3b115d5371c88ee76fa0be4823d9f692808113bd659b9cad5b5985f3d00d83bc'
  'storage-api:v1.67.20@sha256:485a417706a07ae9c5b71a2b4f1e24fdadb84add63ecf30cd54b262fb342fae8'
  'gotrue:v2.194.0@sha256:916d2a32665b1f511a67b80bb909737db16978d9bffaa2ce50c07c73fe735ab6'
)
for entry in "${images[@]}"; do
  versioned="${entry%@*}"
  name="${versioned%%:*}"
  digest="${entry#*@}"
  prepared=false
  for registry in public.ecr.aws docker.io; do
    image="${registry}/supabase/${name}@${digest}"
    if docker pull --platform linux/amd64 "$image"; then
      # The CLI skips its pull only when this exact versioned tag is cached.
      docker tag "$image" "public.ecr.aws/supabase/${versioned}"
      prepared=true
      break
    fi
  done
  if [[ "$prepared" != true ]]; then
    echo "Both official registries failed to provide pinned ${versioned}" >&2
    exit 1
  fi
done

echo "All pinned Supabase replay schema initialization images prepared"
