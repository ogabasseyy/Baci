#!/usr/bin/env bash
# Disposable systemd fault tests. Runs only on an ephemeral systemd Linux VM.
set -euo pipefail

if [ "$(ps -p 1 -o comm= | tr -d ' ')" != systemd ] || ! command -v systemctl >/dev/null; then
  echo "systemd fault test requires systemd as PID 1" >&2
  exit 77
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "systemd fault test requires root on the disposable VM" >&2
  exit 77
fi

suffix="$(python3 -c 'import secrets; print(secrets.token_hex(5))')"
prefix="baci-release-fault-${suffix}"
tmp="$(mktemp -d "/run/${prefix}.XXXXXX")"
unit_dir=/run/systemd/system
broker="${prefix}-broker.service"
core="${prefix}-core.service"
scheduled="${prefix}-scheduled.service"
timer="${prefix}-scheduled.timer"
lock="${tmp}/poller.lock"
latch_dir="${tmp}/locks"
latch="${latch_dir}/release-recovery-latch.json"
runtime_dir="${tmp}/gate-run"
socket="${runtime_dir}/health.sock"
auth="${tmp}/authorized"
data_dir="${tmp}/worker-data"
releases_dir="${tmp}/releases"
current_link="${tmp}/current"
release_state="${tmp}/release-state.json"
candidate_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
previous_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
challenged="${data_dir}/challenged"
slow="${tmp}/slow-gate"
started="${data_dir}/worker-started"
permission_root="/run/${prefix}-permission-layout"
helper_dir="${permission_root}/helper"
units=("$broker" "$core" "$scheduled" "$timer")
created_lock_group=0
created_worker=0
created_bassey=0

cleanup() {
  local exit_status=$?
  set +e
  if [ "$exit_status" -ne 0 ]; then
    echo "systemd fault harness diagnostics (${suffix})" >&2
    for unit in "${units[@]}"; do
      systemctl show "$unit" -p LoadState -p ActiveState -p SubState -p Result \
        -p ExecCondition -p ExecConditionExits -p ExecMainStatus -p After -p BindsTo >&2
      systemctl status --no-pager --full "$unit" >&2
      journalctl --no-pager -n 40 -u "$unit" >&2
    done
    id baci-worker >&2
    id bassey >&2
    stat -c '%A %U:%G %n' "$permission_root" "$helper_dir" \
      "$helper_dir/worker_release_recovery_latch.py" \
      "$helper_dir/worker_release_quiesce_gate.py" \
      "$helper_dir/worker-release-launch-gate" "$latch_dir" "$latch" >&2
  fi
  systemctl stop "${units[@]}" >/dev/null 2>&1
  rm -f "${units[@]/#/${unit_dir}/}"
  systemctl daemon-reload >/dev/null 2>&1
  [ "$created_worker" -eq 0 ] || userdel baci-worker >/dev/null 2>&1
  [ "$created_bassey" -eq 0 ] || userdel bassey >/dev/null 2>&1
  [ "$created_worker" -eq 0 ] || groupdel baci-worker >/dev/null 2>&1
  [ "$created_bassey" -eq 0 ] || groupdel bassey >/dev/null 2>&1
  [ "$created_lock_group" -eq 0 ] || groupdel baci-locks >/dev/null 2>&1
  rm -rf -- "$permission_root"
  rm -rf -- "$tmp"
}
trap cleanup EXIT

if getent group baci-locks >/dev/null || getent passwd baci-worker >/dev/null || getent passwd bassey >/dev/null; then
  echo "refusing to reuse pre-existing baci-locks/baci-worker/bassey identities" >&2
  exit 1
fi
groupadd --system baci-locks
created_lock_group=1
useradd --system --no-create-home --shell /usr/sbin/nologin --groups baci-locks baci-worker
created_worker=1
useradd --system --no-create-home --shell /usr/sbin/nologin --groups baci-locks bassey
created_bassey=1
worker_uid="$(id -u baci-worker)"
worker_gid="$(id -g baci-worker)"
lock_gid="$(getent group baci-locks | cut -d: -f3)"
install -d -o root -g root -m 0711 "$permission_root"
install -d -o root -g root -m 0755 "$helper_dir"
install -o root -g baci-locks -m 0440 \
  "$(dirname "$0")/../bin/worker_release_recovery_latch.py" \
  "$helper_dir/worker_release_recovery_latch.py"
install -o root -g baci-locks -m 0440 \
  "$(dirname "$0")/../bin/worker_release_quiesce_gate.py" \
  "$helper_dir/worker_release_quiesce_gate.py"
install -o root -g baci-locks -m 0550 \
  "$(dirname "$0")/../bin/worker-release-launch-gate" \
  "$helper_dir/worker-release-launch-gate"
for module in worker_release_quiesce_lease.py worker_release_quiesce_lease_identity.py \
  worker_release_quiesce_locks.py worker_release_quiesce_lease_runtime.py \
  worker_release_quiesce_lease_core.py worker_release_quiesce_lease_manager.py \
  worker_release_lifecycle.py worker_release_recovery_lifecycle.py; do
  install -o root -g root -m 0444 "$(dirname "$0")/../bin/$module" "$helper_dir/$module"
done
install -d -o root -g baci-locks -m 0710 "$latch_dir"
install -d -o root -g baci-worker -m 0710 "$runtime_dir"
install -d -o root -g baci-worker -m 0770 "$data_dir"
chmod 0711 "$tmp"
install -d -o root -g root -m 0755 "$releases_dir/$candidate_sha" "$releases_dir/$previous_sha"
ln -s "releases/$candidate_sha" "$current_link"

cat >"$tmp/gate.py" <<'PY'
import os, signal, sys, time, threading, runpy
from pathlib import Path
from worker_release_recovery_latch import load_latch, service_allowed
from types import SimpleNamespace
mode, latch, sock, auth, challenged, slow, started, lock, lock_gid, worker_uid, worker_gid = sys.argv[1:]
if mode == "broker":
    from worker_release_quiesce_lease import WorkerQuiesceLeaseManager
    from worker_release_quiesce_gate import HealthGateServer
    manager = object.__new__(WorkerQuiesceLeaseManager)
    manager._guard = threading.Lock()
    manager._fence = load_latch(Path(latch), uid=0, gid=int(lock_gid))["fence"]
    manager._lease = SimpleNamespace(_state="active", _fence=manager._fence)
    manager._phase = "quiescing"
    manager.latch_path = Path(latch)
    manager.lock_gid = int(lock_gid)
    try:
        os.unlink(auth)
    except FileNotFoundError:
        pass
    def authorize(unit):
        if os.path.exists(auth) and manager._phase != "health_probe":
            manager._set_phase(manager._lease, "health_probe")
        return manager._authorize_unit(unit)
    gate = HealthGateServer(worker_uid=int(worker_uid), worker_gid=int(worker_gid),
                            authorize=authorize, path=Path(sock))
    gate.start()
    signal.pause()
elif mode == "core":
    import worker_release_recovery_latch as recovery
    recovery.LATCH_PATH = Path(latch)
    recovery.GATE_SOCKET_PATH = Path(sock)
    original = recovery.service_allowed
    recovery.service_allowed = lambda service: original(
        service, path=Path(latch), socket_path=Path(sock), uid=0, gid=int(lock_gid))
    launcher = runpy.run_path(os.environ["WORKER_RELEASE_LAUNCH_GATE"], run_name="worker_release_launch_gate_test")
    if launcher["main"](["unit", "baci-domain-event-router"]) != 0:
        sys.exit(1)
    open(challenged, "w").close()
    if os.path.exists(slow):
        time.sleep(3)
elif mode == "scheduled":
    import worker_release_recovery_latch as recovery
    recovery.LATCH_PATH = Path(latch)
    recovery.GATE_SOCKET_PATH = Path(sock)
    original = recovery.service_allowed
    recovery.service_allowed = lambda service: original(
        service, path=Path(latch), socket_path=Path(sock), uid=0, gid=int(lock_gid))
    launcher = runpy.run_path(os.environ["WORKER_RELEASE_LAUNCH_GATE"], run_name="worker_release_launch_gate_test")
    sys.exit(launcher["main"](["scheduled"]))
elif mode == "run":
    with open(started, "a") as stream:
        stream.write("start\n")
    os.execv("/usr/bin/flock", ["flock", "-n", lock, "/bin/sleep", "600"])
PY
chmod 0444 "$tmp/gate.py"

core_fragment="$(dirname "$0")/../systemd/baci-domain-event-router.service"
timer_fragment="$(dirname "$0")/../systemd/baci-cache-invalidation-drain.timer"
unit_relations() {
  grep -E '^(After|Wants|BindsTo)=' "$1" | sed "s/baci-worker-release-broker.service/${broker}/g"
}

PYTHONPATH="$helper_dir" /usr/bin/python3 - "$latch" "$lock_gid" <<'PY'
import sys
from pathlib import Path
from worker_release_recovery_latch import SERVICES, create_latch
path, gid = Path(sys.argv[1]), int(sys.argv[2])
fence = {"run_id": "1", "run_attempt": 1, "sha": "a" * 40}
create_latch(fence, "b" * 40, path=path, job_id="2", active_services=list(SERVICES), uid=0, gid=gid)
PY
cat >"${unit_dir}/${broker}" <<EOF
[Unit]
Description=Disposable broker ${suffix}
Wants=${core} ${timer}
[Service]
Type=simple
Environment=PYTHONPATH=${helper_dir}
ExecStart=/usr/bin/python3 ${tmp}/gate.py broker ${latch} ${socket} ${auth} ${challenged} ${slow} ${started} ${lock} ${lock_gid} ${worker_uid} ${worker_gid}
EOF
cat >"${unit_dir}/${core}" <<EOF
[Unit]
Description=Disposable core worker ${suffix}
$(unit_relations "$core_fragment")
[Service]
Type=simple
User=baci-worker
Group=baci-worker
Environment=PYTHONPATH=${helper_dir}
Environment=WORKER_RELEASE_LAUNCH_GATE=${helper_dir}/worker-release-launch-gate
ExecCondition=/usr/bin/python3 ${tmp}/gate.py core ${latch} ${socket} ${auth} ${challenged} ${slow} ${started} ${lock} ${lock_gid} ${worker_uid} ${worker_gid}
ExecStart=/usr/bin/python3 ${tmp}/gate.py run ${latch} ${socket} ${auth} ${challenged} ${slow} ${started} ${lock} ${lock_gid} ${worker_uid} ${worker_gid}
EOF
cat >"${unit_dir}/${scheduled}" <<EOF
[Unit]
Description=Disposable scheduled worker ${suffix}
$(unit_relations "$timer_fragment")
[Service]
Type=oneshot
User=baci-worker
Group=baci-worker
Environment=PYTHONPATH=${helper_dir}
Environment=WORKER_RELEASE_LAUNCH_GATE=${helper_dir}/worker-release-launch-gate
ExecCondition=/usr/bin/python3 ${tmp}/gate.py scheduled ${latch} ${socket} ${auth} ${challenged} ${slow} ${started} ${lock} ${lock_gid} ${worker_uid} ${worker_gid}
ExecStart=/bin/true
EOF
cat >"${unit_dir}/${timer}" <<EOF
[Unit]
Description=Disposable scheduled timer ${suffix}
$(unit_relations "$timer_fragment")
[Timer]
OnActiveSec=1h
Unit=${scheduled}
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl start "$broker"
systemctl is-active --quiet "$timer"

# A persistent latch suppresses scheduled work and denies a core launch.
systemctl start "$scheduled" || true
if systemctl is-active --quiet "$core"; then
  echo "core worker bypassed recovery latch" >&2
  exit 1
fi
if [ -e "$started" ]; then
  echo "worker ran while recovery was unresolved" >&2
  exit 1
fi

# Kill the broker after the gate challenge has succeeded but before ExecStart.
touch "$auth" "$slow"
rm -f "$challenged"
systemctl start --no-block "$core"
for _ in $(seq 1 100); do [ -e "$challenged" ] && break; sleep 0.05; done
[ -e "$challenged" ] || { echo "core gate was not challenged" >&2; exit 1; }
systemctl kill --kill-who=all --signal=KILL "$broker"
for _ in $(seq 1 100); do
  if ! systemctl is-active --quiet "$core"; then break; fi
  sleep 0.05
done
sleep 3.2
if systemctl is-active --quiet "$core" || [ -e "$started" ]; then
  echo "worker started after broker death during gate challenge" >&2
  exit 1
fi
if systemctl is-active --quiet "$timer"; then
  echo "timer survived broker death" >&2
  exit 1
fi

# Broker restart retains the latch, reactivates its timer, and keeps worker gated.
rm -f "$auth"
systemctl start "$broker"
systemctl is-active --quiet "$timer"
systemctl start "$scheduled" || true
systemctl start "$core" || true
if [ -e "$started" ]; then
  echo "restart resumed work with an unresolved recovery latch" >&2
  exit 1
fi

# Exercise the shipped pointer-restore and durable latch-clear primitives with
# synthetic state. Coordinator terminal-proof/authentication is tested
# separately; this disposable systemd test verifies the actual restore/clear path.
PYTHONPATH="$helper_dir" /usr/bin/python3 - "$latch" "$release_state" "$current_link" "$releases_dir" "$lock_gid" <<'PY'
import json, os, sys
from contextlib import contextmanager
from pathlib import Path
from worker_release_recovery_lifecycle import restore_recorded_prior
from worker_release_recovery_latch import clear_latch, load_latch

class Lease:
    @contextmanager
    def operation(self):
        yield
    def require_active(self):
        pass

latch_path, state_path, current, releases = map(Path, sys.argv[1:5])
gid = int(sys.argv[5])
latch = load_latch(latch_path, uid=0, gid=gid)
fence = latch["fence"]
result = restore_recorded_prior(
    current_link=current, releases_root=releases,
    release_sha=latch["release_sha"], previous_sha=latch["previous_sha"],
    quiescence_lease=Lease(),
)
assert result["sha"] == latch["previous_sha"]
state = {"version": 1, "status": "rolled_back", "sha": latch["release_sha"],
         "previous_sha": latch["previous_sha"], "fence": {**fence, "job_id": latch["job_id"]}}
state_path.write_text(json.dumps(state), encoding="utf-8")
os.chmod(state_path, 0o600)
clear_latch(path=latch_path, fence=fence, state_path=state_path,
            uid=0, gid=gid, state_gid=0)
assert not latch_path.exists()
assert os.readlink(current) == f"releases/{latch['previous_sha']}"
PY
systemctl start "$core"
systemctl is-active --quiet "$core"
if [ "$(wc -l <"$started")" -ne 1 ]; then
  echo "expected one active worker start after recovery" >&2
  exit 1
fi
systemctl stop "$core"

# Rehearse the actual cron and ExecCondition identities against installed-file
# permissions and the root-owned lock-group latch layout.
install -d -o root -g baci-locks -m 0710 "$permission_root/locks"
PYTHONPATH="$helper_dir" /usr/bin/python3 - "$permission_root/locks/release-recovery-latch.json" "$lock_gid" <<'PY'
import sys
from pathlib import Path
from worker_release_recovery_latch import SERVICES, create_latch, update_latch
path, gid = Path(sys.argv[1]), int(sys.argv[2])
fence = {"run_id": "1", "run_attempt": 1, "sha": "a" * 40}
create_latch(fence, None, path=path, job_id="2", active_services=list(SERVICES), uid=0, gid=gid)
update_latch(path=path, phase="health_probe", fence=fence, uid=0, gid=gid)
PY
for account in baci-worker bassey; do
  runuser -u "$account" -- env \
    PYTHONPATH="$helper_dir" \
    LATCH_PATH="$permission_root/locks/release-recovery-latch.json" \
    /usr/bin/python3 -c 'import grp, os; from pathlib import Path; from worker_release_recovery_latch import load_latch; assert load_latch(Path(os.environ["LATCH_PATH"]), uid=0, gid=grp.getgrnam("baci-locks").gr_gid)["phase"] == "health_probe"'
  runuser -u "$account" -- env \
    PYTHONPATH="$helper_dir" GATE_SCRIPT="$helper_dir/worker-release-launch-gate" \
    LATCH_PATH="$permission_root/locks/release-recovery-latch.json" GATE_SOCKET="$permission_root/missing.sock" \
    /usr/bin/python3 -c 'import os, runpy; from pathlib import Path; import worker_release_recovery_latch as recovery; original = recovery.service_allowed; recovery.service_allowed = lambda service: original(service, path=Path(os.environ["LATCH_PATH"]), socket_path=Path(os.environ["GATE_SOCKET"]), uid=0, gid=__import__("grp").getgrnam("baci-locks").gr_gid); gate = runpy.run_path(os.environ["GATE_SCRIPT"], run_name="worker_gate_test"); assert gate["main"](["scheduled"]) == 0; assert gate["main"](["unit", "baci-domain-event-router"]) == 1'
  set +e
  runuser -u "$account" -- env PYTHONPATH="$helper_dir" \
    "$helper_dir/worker-release-launch-gate" invalid
  result=$?
  set -e
  [ "$result" -eq 64 ] || { echo "$account cannot execute/import the installed launch gate" >&2; exit 1; }
done
echo "systemd worker release fault tests passed (${suffix})"
