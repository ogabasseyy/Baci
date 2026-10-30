# Sourced by dependency-builder-systemd-test.sh; keep shared setup in one process.

smoke_output="$test_root/smoke.json"
unit_load_state="$(systemctl show -p LoadState --value "$test_unit" 2>/dev/null || true)"
if [ -n "$unit_load_state" ] && [ "$unit_load_state" != not-found ]; then
  echo "refusing pre-existing smoke transient unit" >&2
  exit 1
fi
test_unit_owned=1
systemd-run --quiet --system --wait --pipe --collect --unit="$test_unit" \
  --uid="$builder_uid" --gid="$worker_gid" \
  --property=ProtectSystem=strict --property=ProtectHome=true --property=PrivateTmp=true \
  --property=PrivateDevices=true --property=PrivateNetwork=true --property=NoNewPrivileges=true \
  --property=PrivateUsers=true --property=RestrictSUIDSGID=true --property=LockPersonality=true \
  --property=KillMode=control-group --property=RuntimeMaxSec=45s \
  --property=MemoryMax=1G --property=CPUQuota=100% --property=TasksMax=64 \
  --property=LimitFSIZE=1073741824 --property=LimitNOFILE=4096 \
  --property="ReadOnlyPaths=$release_root" \
  --property="InaccessiblePaths=/srv/baci-workers/runtime /srv/baci-workers/releases /srv/baci-workers/locks" \
  --setenv=PATH=/usr/bin:/bin --setenv=HOME=/nonexistent --setenv=NODE_ENV=production \
  /usr/bin/python3 "$helper_root/dependency-snapshot-smoke.py" "$release_root" \
  "$builder_uid" "$worker_gid" "$lock_gid" >"$smoke_output"
python3 - "$smoke_output" <<'PY'
import json, sys
from pathlib import Path
try:
    result = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except (OSError, UnicodeError, json.JSONDecodeError):
    raise SystemExit("independent smoke returned non-JSON synthetic evidence")
if not isinstance(result, dict):
    raise SystemExit("independent smoke returned non-object synthetic evidence")
hash_value = result.get("snapshot_sha256")
valid = (set(result) == {"snapshot_sha256", "tsx", "dotenv", "worker_sdks"}
        and result.get("tsx") == "passed" and result.get("dotenv") == "passed"
        and result.get("worker_sdks") == "passed"
        and isinstance(hash_value, str)
        and len(hash_value) == 64
        and all(char in "0123456789abcdef" for char in hash_value))
if not valid:
    keys = sorted(str(key)[:64] for key in result.keys())[:20]
    hash_length = len(hash_value) if isinstance(hash_value, str) else -1
    print(f"smoke-evidence-invalid keys={keys} sha256_length={hash_length} "
          f"tsx_pass={result.get('tsx') == 'passed'} dotenv_pass={result.get('dotenv') == 'passed'} "
          f"worker_sdks_pass={result.get('worker_sdks') == 'passed'}",
          file=sys.stderr)
    raise SystemExit("independent smoke returned malformed or incomplete synthetic evidence")
print("independent materialized-snapshot smoke passed")
PY
