#!/usr/bin/env bash
set -euo pipefail

# CLI v2.95.4 pins these database/schema-init jobs in:
# https://github.com/supabase/cli/blob/v2.95.4/pkg/config/templates/Dockerfile
# Both official registries publish identical linux/amd64 manifest digests.
# This covers db start; optional gen-types additionally needs postgres-meta.
if [[ "$(supabase --version)" != "2.95.4" ]]; then
  echo "Supabase replay image pins require CLI 2.95.4" >&2
  exit 1
fi

images=(
  'postgres:17.6.1.106@sha256:5e52ca81790ae3aa1c2f8c20df41dd96404c8ab29632dddf113b881de785ee92'
  'realtime:v2.86.3@sha256:630c1f1e1443762c100147decca9cf87afe52f22a8a96d30fe7d8782741f19fb'
  'storage-api:v1.54.1@sha256:6395ec6600b89e8133ae65e2b203d04f37a24d3626144ea2cb21973bfaa2471c'
  'gotrue:v2.188.1@sha256:61f1099e790c4f364b70d6fb92cc07e5f90275abf2cf690ff045c63f1d96ee4b'
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
