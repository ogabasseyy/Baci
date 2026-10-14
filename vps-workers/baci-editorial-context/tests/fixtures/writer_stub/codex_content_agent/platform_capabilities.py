"""Fixture stub: re-export the real repo runtime, never a second copy.

The writer-interface stub must verify against the same capability_context
the gate enforces. Importing a second copy of the runtime would drift (as a
scratch copy already did once), so this module only re-exports.
"""
from platform_capabilities import capability_context

__all__ = ["capability_context"]
