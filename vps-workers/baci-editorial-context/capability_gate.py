"""Decide whether the capability-register binding suite must run for a change.

Runs the suite unless the change provably touches neither the register, the
binding code, nor any cited source. If the changed-path set cannot be
computed (unknown base, git error), the gate fails outright: running the
suite against a fresh register would still pass an unverified-source change,
because those sources are intentionally excluded from evidence binding.
"""
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path


def _load_paths_module():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "capability_gate_paths", Path(__file__).parent / "capability_gate_paths.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["capability_gate_paths"] = module
    spec.loader.exec_module(module)
    return module


_paths = _load_paths_module()
REGISTER_PATH = _paths.REGISTER_PATH
MAP_PATH = _paths.MAP_PATH
SUITE_DIR = _paths.SUITE_DIR
ACTION_PATH = _paths.ACTION_PATH
FRESHNESS_WORKFLOW = _paths.FRESHNESS_WORKFLOW
map_cited_paths = _paths.map_cited_paths
map_cited_filenames = _paths.map_cited_filenames
map_link_targets = _paths.map_link_targets
relevant_paths = _paths.relevant_paths
_comparison_base = _paths._comparison_base
newer_base_register = _paths.newer_base_register
_resolve_cited_filenames = _paths._resolve_cited_filenames
_canon = _paths._canon
_matches = _paths._matches
_is_ancestor = _paths._is_ancestor
_touches_unverified_refs = _paths._touches_unverified_refs
_touches_cited_refs = _paths._touches_cited_refs
_changed_refs_unbound = _paths._changed_refs_unbound


def changed_paths(base, cwd=".", mode=None):
    # Push events compare the previous tip directly (two-dot): a three-dot
    # merge-base diff would hide paths removed by a force-push. Pull requests
    # keep the three-dot merge-base comparison.
    if mode is None:
        mode = "push" if os.environ.get("GITHUB_EVENT_NAME") == "push" else "pull_request"
    spec = f"{base}..HEAD" if mode == "push" else f"{base}...HEAD"
    proc = subprocess.run(
        ["git", "-C", str(cwd), "diff", "--name-status", "-z", spec],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return None
    # -z name-status emits STATUS\0path\0, with renames as R###\0old\0new\0.
    # Both sides of a rename count: dropping the old cited path must not
    # bypass the gate just because the register still lists it.
    fields = [p for p in proc.stdout.split("\0") if p]
    paths = set()
    i = 0
    while i < len(fields):
        status = fields[i]
        i += 1
        if status.startswith(("R", "C")):
            paths.update(fields[i : i + 2])
            i += 2
        else:
            paths.add(fields[i])
            i += 1
    return paths



def _register_stale(register):
    try:
        reviewed = dt.datetime.fromisoformat(str(register["reviewed_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return True
    if reviewed.tzinfo is None:
        return True  # Mirror the runtime and status probe: naive dates are invalid.
    # Mirror the runtime window: future-dated registers are rejected, not fresh.
    age = dt.datetime.now(dt.timezone.utc) - reviewed
    return not dt.timedelta() <= age <= dt.timedelta(days=14)


def freshness_required(register, changed):
    """Freshness hard-gates register changes, stale registers, unverified refs."""
    if changed is None or register is None:
        return True
    if REGISTER_PATH in changed or _register_stale(register):
        return True
    return _touches_unverified_refs(register, changed)


def _reviewed_moment(register):
    moment = dt.datetime.fromisoformat(str(register["reviewed_at"]).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.timezone.utc)
    return moment


def _revision_resolves(revision, cwd="."):
    """Whether revision names a commit in this checkout's history."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(cwd), "cat-file", "-e", f"{revision}^{{commit}}"],
            capture_output=True, text=True,
        )
    except Exception:
        return False
    return proc.returncode == 0


def _replacement_revision_ok(new_rev, old_rev, cwd="."):
    """The newly bound tree must descend from the previously bound one.

    Mere existence proves nothing: an older ancestor predating the reviewed
    change also resolves. Content validation stays with the binding test's
    provenance check; here the tripwire is continuity — rebase onto current
    history and re-point when it fails. When the old revision no longer
    resolves (rewritten/squash-merged history), continuity is unestablishable:
    accept an explicit re-point to a resolvable tree rather than deadlocking
    every future re-review.
    """
    if not _revision_resolves(new_rev, cwd):
        return False
    if not _revision_resolves(old_rev, cwd):
        return True
    return _is_ancestor(old_rev, new_rev, cwd)


def _base_register(base, cwd="."):
    probe = subprocess.run(
        ["git", "-C", str(cwd), "show", f"{base}:{REGISTER_PATH}"],
        capture_output=True, text=True,
    )
    if probe.returncode != 0:
        return None
    try:
        return json.loads(probe.stdout)
    except ValueError:
        return None


def requires_register_update(register, changed, base_register=None, rev_acceptable=None, map_text=None):
    """A fresh register whose cited sources changed needs re-review.

    Freshness alone cannot catch this: the register is still inside its
    evidence window, the content digest excludes unverified refs by design,
    and provenance ignores them too. A change to an unverified cited source
    (e.g. the pricing page gaining wholesale support) can therefore leave a
    stale "not established by this audit" claim reaching writers with every
    check green. The same change must re-review the register in the same PR:
    a path touch alone (whitespace-only edit) does not count — reviewed_at
    must advance past the base revision's, and source_revision must move to
    the newly reviewed tree instead of carrying the old binding forward.
    When the base register cannot be loaded, the path touch is the only
    available signal and is accepted. Unknown inputs fail closed elsewhere;
    here there is nothing to enforce.
    """
    if changed is None or register is None:
        return False
    if _register_stale(register):
        return False
    # Union of head and base cited refs across all statuses: editing a cited
    # file while replacing or removing its reference (reviewed_at unchanged)
    # must not slip through just because the head register no longer cites
    # it, and a redigest of a content-bound change without a date advance is
    # still pending re-review.
    registers = [register] if base_register is None else [register, base_register]
    touched = any(_touches_cited_refs(item, changed) for item in registers)
    # Map-cited sources carry the map's behavioral claims: changing one
    # without touching the map or register would keep the old review date
    # and revision over new evidence, so map citations count as touches.
    if not touched and isinstance(map_text, str):
        map_refs = map_cited_paths(map_text) | map_link_targets(map_text) | map_cited_filenames(map_text)
        touched = any(_matches(p, map_refs) for p in changed)
    # The access map carries its own audit provenance (reviewed date +
    # source revision): a map-only edit that keeps the old metadata presents
    # rewritten claims as previously audited, so it re-reviews like the
    # register itself.
    register_touched = REGISTER_PATH in changed or MAP_PATH in changed
    if not touched and not register_touched:
        return False
    # A register-only edit (claims, limitations, statuses, refs) with the old
    # review metadata presents new writer claims as previously audited: the
    # metadata comparisons below apply with or without a cited touch.
    if not register_touched:
        return True
    if base_register is None:
        return False
    try:
        advanced = _reviewed_moment(register) > _reviewed_moment(base_register)
    except (KeyError, TypeError, ValueError):
        return True
    if not advanced:
        return True
    old_rev = base_register.get("source_revision")
    new_rev = register.get("source_revision")
    if not isinstance(new_rev, str) or not isinstance(old_rev, str):
        return True
    if new_rev == old_rev:
        return True
    # A merely different revision proves nothing: it must resolve to a
    # reviewed tree descending from the previous one, or provenance degrades
    # and a redigest passes blind.
    if rev_acceptable is not None and not rev_acceptable(new_rev, old_rev):
        return True
    return False


def should_run(base, register, changed, cwd="."):
    if changed is None:
        return True
    relevant = relevant_paths(register, cwd, base)
    return any(
        _matches(p, relevant) or p.startswith(SUITE_DIR + "/") for p in changed
    )


def main(cwd="."):
    """Run the gate against the checkout at cwd (default: process cwd)."""
    # Resolve once: a relative checkout would otherwise prefix both the
    # suite path and the child cwd, doubling the path during discovery.
    root = os.path.abspath(str(cwd))
    base = os.environ.get("BASE_SHA", "")
    env = dict(os.environ)
    if base and set(base) != {"0"}:
        try:
            register = json.loads(Path(root, REGISTER_PATH).read_text())
        except (OSError, ValueError):
            register = None  # Broken register: run the suite for its diagnosis.
        changed = changed_paths(base, cwd)
        if changed is None:
            print(f"capability gate: cannot compute the changed-path set for base {base[:12]}; refusing to run blind")
            return 1
        # Baseline against the newer of the fork-point and target-tip
        # registers: a stale branch copying the target's newer metadata must
        # advance past it, not just past its own fork point.
        fork_base = _comparison_base(base, cwd)
        base_register = None
        if register is not None:
            fork_register = _base_register(fork_base, cwd)
            tip_register = _base_register(base, cwd) if base != fork_base else None
            base_register = newer_base_register(tip_register, fork_register)
        rev_ok = lambda new, old: _replacement_revision_ok(new, old, cwd)  # noqa: E731
        try:
            map_text = Path(root, MAP_PATH).read_text()
        except OSError:
            map_text = None
        if requires_register_update(register, changed, base_register, rev_ok, map_text):
            print(
                "capability sources changed without a register re-review; "
                f"update {REGISTER_PATH} (reviewed_at + digests) in this change"
            )
            return 1
        if register is not None:
            unbound = _changed_refs_unbound(register, changed, cwd)
            if unbound:
                print("capability register re-review does not bind its changed sources:")
                for failure in unbound:
                    print(f"  - {failure}")
                return 1
        if register is not None and not should_run(base, register, changed, cwd):
            print("capability register and cited sources untouched; skipping binding suite")
            return 0
        if not freshness_required(register, changed):
            # Fresh register + content-bound-only change: the digest check
            # already forces a register re-review in the same change, so the
            # freshness hard-fail must not block unrelated fixes. A stale
            # register keeps the hard gate everywhere (re-digesting alone
            # cannot bypass it); staleness is also enforced by the scheduled
            # workflow and the runtime window.
            env.pop("BACI_REGISTER_REQUIRE_FRESH", None)
    # Explicit cwd: every other git call in this module pins its checkout, and
    # the suite's own tests shell out to git and read the tree — an inherited
    # cwd from a scheduler or wrapper would run them against the wrong tree.
    # The environment stays inherited (callers such as the writer-stub tests
    # pass PYTHONPATH through it).
    return subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", str(Path(root, SUITE_DIR)), "-p", "test_*capabilit*.py"],
        env=env,
        cwd=root,
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
