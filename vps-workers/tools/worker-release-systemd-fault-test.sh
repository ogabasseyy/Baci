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
  set +e
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
install -d -o root -g baci-locks -m 0710 "$latch_dir"
install -d -o root -g baci-worker -m 0710 "$runtime_dir"
install -d -o root -g baci-worker -m 0770 "$data_dir"
chmod 0711 "$tmp"

cat >"$tmp/gate.py" <<'PY'
import os, signal, sys, time, threading, runpy
from pathlib import Path
from worker_release_recovery_latch import load_latch, service_allowed
from types import SimpleNamespace
mode, latch, sock, auth, challenged, slow, started, lock, lock_gid, worker_uid, worker_gid = sys.argv[1:]
if mode == "broker":
    from worker_release_quiesce_lease_manager import WorkerQuiesceLeaseManager
    from worker_release_quiesce_gate import HealthGateServer
    manager = object.__new__(WorkerQuiesceLeaseManager)
    manager._guard = threading.Lock()
    manager._lease = SimpleNamespace(_state="active")
    manager._phase = "health_probe"
    manager._fence = load_latch(Path(latch), uid=0, gid=int(lock_gid))["fence"]
    manager.latch_path = Path(latch)
    manager.lock_gid = int(lock_gid)
    try:
        os.unlink(auth)
    except FileNotFoundError:
        pass
    gate = HealthGateServer(worker_uid=int(worker_uid), worker_gid=int(worker_gid),
                            authorize=manager._authorize_unit, path=Path(sock))
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

printf '%s\n' '{"version":1,"phase":"health_probe","fence":{"run_id":"1","run_attempt":1,"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"previous_sha":null,"services_to_restore":[],"stop_intent":[]}' >"$latch"
chown root:baci-locks "$latch"
chmod 0640 "$latch"
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
systemctl start "$broker"
systemctl is-active --quiet "$timer"
systemctl start "$scheduled" || true
systemctl start "$core" || true
if [ -e "$started" ]; then
  echo "restart resumed work with an unresolved recovery latch" >&2
  exit 1
fi

# Simulate authenticated RESTORE clearing the durable latch, then assert one poller.
rm -f "$latch"
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
printf '%s\n' '{"version":1,"phase":"health_probe","fence":{"run_id":"1","run_attempt":1,"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"previous_sha":null,"services_to_restore":[],"stop_intent":[]}' >"$permission_root/locks/release-recovery-latch.json"
chown root:baci-locks "$permission_root/locks/release-recovery-latch.json"
chmod 0640 "$permission_root/locks/release-recovery-latch.json"
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
