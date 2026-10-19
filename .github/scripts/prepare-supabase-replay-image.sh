#!/usr/bin/env bash
set -euo pipefail

# CLI v2.95.4 pins postgres:17.6.1.106 in pkg/config/templates/Dockerfile:
# https://github.com/supabase/cli/blob/v2.95.4/pkg/config/templates/Dockerfile
# Both official registries publish the same linux/amd64 manifest digest.
# Keep this pin aligned with the replay CLI toolchain; never use a floating image.
if [[ "$(supabase --version)" != "2.95.4" ]]; then
  echo "Supabase replay image pin requires CLI 2.95.4" >&2
  exit 1
fi

digest='sha256:5e52ca81790ae3aa1c2f8c20df41dd96404c8ab29632dddf113b881de785ee92'
cli_image='public.ecr.aws/supabase/postgres:17.6.1.106'
for registry in public.ecr.aws docker.io; do
  image="${registry}/supabase/postgres@${digest}"
  if docker pull --platform linux/amd64 "$image"; then
    # The CLI uses this exact tag and skips its own pull when it is cached.
    docker tag "$image" "$cli_image"
    echo "Pinned Supabase replay database image prepared"
    exit 0
  fi
done

echo "Both official registries failed to provide the pinned replay image" >&2
exit 1
