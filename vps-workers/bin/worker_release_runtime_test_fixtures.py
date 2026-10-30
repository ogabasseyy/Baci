"""Synthetic dependency layout fixtures shared by broker tests."""
import io
import tarfile


def runtime_archive_entries(prefix="repo"):
    """Represent materialized immutable dependencies, not raw pnpm symlinks."""
    entries = []
    for relative in (
        "node_modules/", "node_modules/runtime/", "apps/", "apps/web/",
        "apps/web/node_modules/", "apps/web/node_modules/runtime/",
        "apps/web/node_modules/.bin/",
    ):
        info = tarfile.TarInfo(f"{prefix}/{relative}")
        info.type = tarfile.DIRTYPE
        entries.append((info, None))
    for relative, payload, mode in (
        ("node_modules/runtime/index.js", b"module.exports = {};\n", 0o644),
        ("apps/web/node_modules/runtime/index.js", b"module.exports = {};\n", 0o644),
        ("apps/web/node_modules/.bin/tsx", b"#!/bin/sh\nexit 0\n", 0o755),
    ):
        info = tarfile.TarInfo(f"{prefix}/{relative}")
        info.size = len(payload)
        info.mode = mode
        entries.append((info, io.BytesIO(payload)))
    return entries


def create_runtime_tree(release):
    """Create frozen directories and regular files accepted by preflight."""
    for relative in (
        "node_modules/runtime", "apps/web/node_modules/runtime",
        "apps/web/node_modules/.bin",
    ):
        (release / relative).mkdir(parents=True, exist_ok=True)
    (release / "node_modules/runtime/index.js").write_text("module.exports = {};\n")
    (release / "apps/web/node_modules/runtime/index.js").write_text("module.exports = {};\n")
    tsx = release / "apps/web/node_modules/.bin/tsx"
    tsx.write_text("#!/bin/sh\nexit 0\n")
    for relative in (
        "node_modules/runtime/index.js", "apps/web/node_modules/runtime/index.js",
    ):
        (release / relative).chmod(0o440)
    tsx.chmod(0o550)
    for relative in (
        "node_modules/runtime", "node_modules", "apps/web/node_modules/runtime",
        "apps/web/node_modules/.bin", "apps/web/node_modules", "apps/web", "apps",
    ):
        (release / relative).chmod(0o550)
