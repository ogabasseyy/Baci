"""Resource transitions exposed by the disconnected stage journal."""
from __future__ import annotations

from pathlib import Path


class StageJournalResourceAPI:
    """Keep resource transitions separate from core release phase handling."""

    def create_source_snapshot(self) -> Path:
        value = self._require_journal()
        self._verify_resource_root(value)
        result = self.resources.create(value, "source")
        self._verify_resource_root(value)
        return result

    def create_builder_result(self) -> Path:
        """Record the result directory inode before a builder writes into it."""
        value = self._require_journal()
        self._verify_resource_root(value)
        result = self.resources.create(value, "result")
        self._verify_resource_root(value)
        return result

    def begin_source_transfer(self) -> None:
        value = self._require_journal()
        self._verify_resource_root(value)
        self.resources.begin_transfer(value)

    def mark_source_frozen(self) -> None:
        value = self._require_journal()
        self._verify_resource_root(value)
        self.resources.mark_frozen(value)

    def remove_source_snapshot(self) -> None:
        value = self._require_journal()
        self._verify_resource_root(value)
        self.resources.remove(value, "source")

    def remove_builder_result(self) -> None:
        value = self._require_journal()
        self._verify_resource_root(value)
        self.resources.remove(value, "result")
