export const gigl42SshStub = `#!/usr/bin/env bash
touch "\${TEST_SSH_MARKER}"
args="$*"
payload="$(cat)"
case "$args" in
  *".config/baci/remediation.disabled"*)
    echo enabled
    exit 0
    ;;
  *"verify-gigl-tracking-worker-capability.sh"*)
    exit 42
    ;;
  *".gigl-capability-smoke-ok"*)
    if [ "\${TEST_SCENARIO:-}" = "gigl-42-vacuous-latch" ]; then
      echo "disabled:0123456789abcdef0123456789abcdef01234567:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      exit 0
    fi
    if [ "\${TEST_SCENARIO:-}" = "gigl-42-proven-latch" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-migration-transition" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-unknown-sha" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-unrelated-migration" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-context-mention" ] || [ "\${TEST_SCENARIO:-}" = "gigl-42-fetch-resolves" ]; then
      echo "enabled:0123456789abcdef0123456789abcdef01234567:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
      exit 0
    fi
    exit 1
    ;;
esac
case "$args $payload" in
  *"command -v node"*)
    echo /usr/bin/node
    ;;
  *"find /home/bassey/.local"*)
    echo /opt/codex/bin/codex
    ;;
  *"rsync -a --delete"*)
    touch "\${TEST_PROMOTION_MARKER}"
    ;;
esac
exit 0
`;
