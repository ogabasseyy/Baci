#!/usr/bin/env bash
# Disposable Linux/systemd test of the real dependency builder and snapshot smoke.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$script_dir/dependency-builder-systemd-test-setup.sh"
source "$script_dir/dependency-builder-systemd-test-seed.sh"
source "$script_dir/dependency-builder-systemd-test-build.sh"
source "$script_dir/dependency-builder-systemd-test-smoke.sh"
