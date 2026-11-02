#!/usr/bin/env bash
# Install the Muse Code CLI from a pinned versioned artifact.
#
# No curl-pipe-bash: the exact release binary is downloaded to a file, its
# SHA256 is verified against the committed manifest checksum, and only then
# is it installed. To bump versions, query the channel API for the current
# release and manifest, e.g.:
#   curl -fsSL 'https://api.meta.ai/muse-code/channels/muse-stable'
# then update MUSE_VERSION plus both checksums below from that manifest.
#
# Env in: HOME, GITHUB_PATH. Must run on Linux (runner: ubuntu-latest).
set -euo pipefail

MUSE_VERSION="1.4.14-R7309.1"
# From the stable-channel manifest (retrieved 2026-11-02 over TLS):
# https://api.meta.ai/muse-code/channels/muse-stable
SHA_X86_LINUX="0809aac7cb58d18f5022b6d05e02aa1974683c0ec430e5f04d25b60ed17de2da"
SHA_AARCH64_LINUX="3dc39b8fa26f9963cc2038f2966c0932ed5a39f0f9efb39cc0266a261cbbcf76"

arch="$(uname -m)"
case "${arch}" in
  x86_64) artifact="muse-x86-linux"; want_sha="${SHA_X86_LINUX}" ;;
  aarch64|arm64) artifact="muse-aarch64-linux"; want_sha="${SHA_AARCH64_LINUX}" ;;
  *) echo "::error::Unsupported architecture for pinned Muse install: ${arch}" >&2; exit 1 ;;
esac
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "::error::Pinned Muse install supports Linux runners only." >&2
  exit 1
fi

tmp_bin="$(mktemp)"
trap 'rm -f "${tmp_bin}"' EXIT
# --disable first: curl reads $CURL_HOME/.curlrc or $HOME/.curlrc unless
# disabled as the first parameter; --proto '=https' forbids redirect
# downgrades; --retry rides out flakes. No -K/--config: a config file
# imports arguments as if typed on the command line.
curl --disable --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors \
  --connect-timeout 15 --max-time 600 -fsSL -o "${tmp_bin}" \
  "https://lookaside.facebook.com/lookaside/muse/download/?channel=muse&version=${MUSE_VERSION}&file=${artifact}"

got_sha="$(sha256sum "${tmp_bin}" | awk '{print $1}')"
if [[ "${got_sha}" != "${want_sha}" ]]; then
  echo "::error::Muse binary checksum mismatch for ${MUSE_VERSION}/${artifact}; refusing to install." >&2
  exit 1
fi

install_dir="${HOME}/.local/bin"
mkdir -p "${install_dir}"
install -m 0755 "${tmp_bin}" "${install_dir}/muse"
echo "${install_dir}" >> "${GITHUB_PATH}"
"${install_dir}/muse" --version
