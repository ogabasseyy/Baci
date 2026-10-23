"""Prove review continuity across ancestry or an evidence-equivalent squash."""
import re
import subprocess
from pathlib import PurePosixPath

from capability_gate_paths import MAP_PATH, REGISTER_PATH, map_cited_filenames, map_cited_paths, map_link_targets


def _git(args, cwd):
    try:
        return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    except (OSError, UnicodeError):
        return None


def revision_resolves(revision, cwd="."):
    result = _git(["cat-file", "-e", f"{revision}^{{commit}}"], cwd)
    return result is not None and result.returncode == 0


def _ancestor(older, newer, cwd):
    result = _git(["merge-base", "--is-ancestor", older, newer], cwd)
    return result.returncode if result is not None else None


def _manifest(revision, cwd):
    result = _git(["ls-tree", "-r", "-z", revision], cwd)
    if result is None or result.returncode:
        return None
    entries = {}
    for entry in result.stdout.split("\0"):
        if not entry:
            continue
        try:
            descriptor, path = entry.split("\t", 1)
            mode, kind, oid = descriptor.split()
        except ValueError:
            return None
        entries[path] = (mode, kind, oid)
    return entries


def _valid_ref(ref):
    if not isinstance(ref, str) or not ref or ref.startswith("/"):
        return False
    path = ref.rstrip("/")
    return bool(path) and all(part not in ("", ".", "..") for part in path.split("/"))


def _selected(manifest, ref):
    path = ref.rstrip("/")
    selected = {name: entry for name, entry in manifest.items()
                if name == path or name.startswith(path + "/")}
    if not selected or any(mode not in ("100644", "100755") or kind != "blob"
                           for mode, kind, _ in selected.values()):
        return None
    return selected


def _equivalent_squash(new_rev, old_rev, base, register, cwd):
    # The caller supplies the trusted target base and its selected register.
    # A proven non-ancestor (exit 1), never an error, identifies rewrite history.
    if not all(isinstance(rev, str) and re.fullmatch(r"[a-f0-9]{40}", rev)
               for rev in (new_rev, old_rev, base)):
        return False
    if not isinstance(register, dict) or register.get("source_revision") != old_rev:
        return False
    if _ancestor(base, new_rev, cwd) != 0 or _ancestor(old_rev, base, cwd) != 1:
        return False
    rows = register.get("capabilities")
    if not isinstance(rows, list) or not rows:
        return False
    refs = set()
    for row in rows:
        citations = row.get("source_refs") if isinstance(row, dict) else None
        if not isinstance(citations, list) or not citations or not all(_valid_ref(ref) for ref in citations):
            return False
        refs.update(citations)
    old_tree, base_tree = _manifest(old_rev, cwd), _manifest(base, cwd)
    if old_tree is None or base_tree is None:
        return False
    source_map = _git(["show", f"{base}:{MAP_PATH}"], cwd)
    if source_map is None or source_map.returncode:
        return False
    text = source_map.stdout
    map_refs = map_cited_paths(text) | map_link_targets(text)
    for name in map_cited_filenames(text):
        matches = {path for path in old_tree.keys() | base_tree.keys()
                   if PurePosixPath(path).name == name}
        if not matches:
            return False
        map_refs.update(matches)
    # These two files carry review metadata, rather than source evidence.
    map_refs -= {REGISTER_PATH, MAP_PATH}
    if not all(_valid_ref(ref) for ref in map_refs):
        return False
    refs.update(map_refs)
    for ref in refs:
        before, after = _selected(old_tree, ref), _selected(base_tree, ref)
        if before is None or after is None or before != after:
            return False
    return True


def replacement_revision_ok(new_rev, old_rev, cwd=".", *, base=None, base_register=None):
    """Keep ancestry proof; bridge squash history only with identical evidence.

    An unresolved old revision retains the existing explicit re-point behavior.
    A retained old branch requires a trusted-base content proof, including all
    unverified and access-map citations. Later base evidence changes refuse this
    conservative bridge and need a separately established review lineage.
    """
    if not revision_resolves(new_rev, cwd):
        return False
    if not revision_resolves(old_rev, cwd):
        return True
    ancestry = _ancestor(old_rev, new_rev, cwd)
    if ancestry == 0:
        return True
    if ancestry != 1:
        return False
    return _equivalent_squash(new_rev, old_rev, base, base_register, cwd)
