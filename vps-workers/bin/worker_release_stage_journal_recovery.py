"""Exact-fence cleanup of interrupted staged release resources."""
from __future__ import annotations

from typing import Any, Callable

from worker_release_stage_journal_io import reject


def recover(journal, *, terminal_attempt_proven: Callable[[dict[str, Any]], bool],
            current_link: str, resources_quiesced: Callable[[dict[str, Any]], bool] | None) -> str:
    value = journal._require_journal()
    if value["phase"] == "committed":
        journal._verify_directory(value["release_name"], value, expected_uid=journal.owner_uid,
                                  expected_gid=journal.stage_gid)
        journal._verify_committed_tree(value)
        journal._unlink_journal()
        return "committed"
    if terminal_attempt_proven(value["fence"]) is not True:
        reject("stage recovery requires proof that the owning run attempt is terminal")
    if resources_quiesced is None or resources_quiesced(value["fence"]) is not True:
        reject("stage recovery requires process-quiescence proof")
    if journal._current_sha(current_link) == value["fence"]["sha"]:
        reject("refusing to discard the active release")
    journal._verify_resource_root(value)
    incoming_exists = journal._exists(value["incoming_name"])
    final_exists = journal._exists(value["release_name"])
    if incoming_exists and final_exists:
        reject("both incoming and published release paths exist")
    resource_exists = any(
        journal.resources._exists(journal.resources._fields(value, kind)[0])
        for kind in journal.resources.KINDS
        if value.get(f"{kind}_state") != "disabled"
    )
    journal.resources.recover(value, quiescence_proven=True)
    if incoming_exists:
        if value["incoming_ino"] is None:
            reject("cannot discard an incoming path without its recorded inode")
        if value["phase"] not in ("incoming", "ownership_transfer"):
            reject("incoming path is inconsistent with journal phase")
        allowed = ((journal.stage_uid, journal.owner_uid)
                   if value["phase"] == "ownership_transfer" else journal.stage_uid)
        journal._verify_directory(value["incoming_name"], value, expected_uid=allowed,
                                  expected_gid=journal.stage_gid)
        journal._remove_exact(value["incoming_name"])
    elif final_exists:
        if value["incoming_ino"] is None:
            reject("cannot discard a published path without its recorded inode")
        if value["phase"] not in ("ownership_transfer", "published"):
            reject("published path is inconsistent with journal phase")
        journal._verify_directory(value["release_name"], value,
                                  expected_uid=(journal.stage_uid, journal.owner_uid),
                                  expected_gid=journal.stage_gid)
        journal._remove_exact(value["release_name"])
    journal._sync_releases()
    journal._unlink_journal()
    return "discarded"


__all__ = ["recover"]
