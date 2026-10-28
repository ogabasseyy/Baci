"""Untrusted archive staging and release tree validation."""
import worker_release_broker as broker
import io, os, re, shutil, signal, stat, time

def _assert_root_owned_executable(path: str) -> None:
    metadata = broker.os.stat(path, follow_symlinks=False)
    if not broker.stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise PermissionError("trusted dispatcher files must be root-owned regular files")
    if not metadata.st_mode & 0o111:
        raise PermissionError("trusted dispatcher is not executable")


def _run_as_worker_extractor(archive_bytes: bytes, destination: str, worker_uid: int, worker_gid: int) -> int:
    """Fork a one-shot child, drop all groups/UID/GID, then parse untrusted tar."""
    read_fd, write_fd = broker.os.pipe()
    child = broker.os.fork()
    if child == 0:
        try:
            broker.os.close(read_fd)
            broker.os.setgroups([])
            broker.os.setgid(worker_gid)
            broker.os.setuid(worker_uid)
            count = broker.extract_github_tarball(broker.io.BytesIO(archive_bytes), destination)
            broker.os.write(write_fd, str(count).encode("ascii"))
            broker.os._exit(0)
        except BaseException:
            try:
                broker.os.write(write_fd, b"rejected")
            except OSError:
                pass
            broker.os._exit(1)
    broker.os.close(write_fd)
    deadline = broker.time.monotonic() + broker.MAX_EXTRACTION_SECONDS
    status = None
    try:
        while broker.time.monotonic() < deadline:
            waited, status = broker.os.waitpid(child, broker.os.WNOHANG)
            if waited == child:
                break
            broker.time.sleep(0.05)
        else:
            broker.os.kill(child, broker.signal.SIGKILL)
            broker.os.waitpid(child, 0)
            raise broker.BrokerProtocolError("source archive extraction timed out")
        with broker.os.fdopen(read_fd, "rb") as result_pipe:
            result = result_pipe.read(64)
    except BaseException:
        try:
            broker.os.close(read_fd)
        except OSError:
            pass
        raise
    if not broker.os.WIFEXITED(status) or broker.os.WEXITSTATUS(status) != 0:
        raise broker.BrokerProtocolError("source archive extraction failed")
    try:
        return int(result.decode("ascii"))
    except ValueError:
        raise broker.BrokerProtocolError("source archive extraction failed") from None


def _freeze_release_tree(destination: str, worker_gid: int, *, owner_uid: int = 0) -> None:
    """Make staged source immutable to the worker after extraction completes."""
    for current, directories, files in broker.os.walk(destination, topdown=False, followlinks=False):
        for name in files:
            path = broker.os.path.join(current, name)
            metadata = broker.os.lstat(path)
            if not broker.stat.S_ISREG(metadata.st_mode):
                raise broker.BrokerProtocolError("staged source contains a non-regular file")
            executable = bool(metadata.st_mode & 0o111)
            broker.os.chown(path, owner_uid, worker_gid, follow_symlinks=False)
            broker.os.chmod(path, 0o550 if executable else 0o440, follow_symlinks=False)
        for name in directories:
            path = broker.os.path.join(current, name)
            metadata = broker.os.lstat(path)
            if not broker.stat.S_ISDIR(metadata.st_mode):
                raise broker.BrokerProtocolError("staged source contains a non-directory entry")
            broker.os.chown(path, owner_uid, worker_gid, follow_symlinks=False)
            broker.os.chmod(path, 0o550, follow_symlinks=False)
    broker.os.chown(destination, owner_uid, worker_gid)
    broker.os.chmod(destination, 0o550)


def _stage_archive(archive: bytes, releases_root: str, sha: str, worker_uid: int, worker_gid: int) -> int:
    """Extract into a private incoming directory, then publish it atomically by SHA."""
    if not broker.re.fullmatch(r"[0-9a-f]{40}", sha):
        raise broker.BrokerProtocolError("invalid source identity")
    destination = broker.os.path.join(releases_root, f".{sha}.incoming")
    release_path = broker.os.path.join(releases_root, sha)
    if broker.os.path.lexists(destination) or broker.os.path.lexists(release_path):
        raise broker.BrokerProtocolError("release staging directory already exists")
    broker.os.mkdir(destination, 0o700)
    try:
        broker.os.chown(destination, worker_uid, worker_gid)
        broker.os.chmod(destination, 0o700)
        count = broker._run_as_worker_extractor(archive, destination, worker_uid, worker_gid)
        broker._freeze_release_tree(destination, worker_gid)
        # releases_root is root-owned and not writable by the extractor identity;
        # the SHA name is therefore stable between the collision check and rename.
        if broker.os.path.lexists(release_path):
            raise broker.BrokerProtocolError("release already staged")
        broker.os.rename(destination, release_path)
        return count
    except BaseException:
        # The incoming path is created by this invocation in the protected parent.
        # Remove partial output so retries cannot mistake it for a completed release.
        broker.shutil.rmtree(destination, ignore_errors=True)
        raise


def _validate_staged_release(releases_root: str, sha: str, worker_gid: int, *, owner_uid: int = 0) -> int:
    """Read-only check that a staged SHA tree is complete and immutable to the worker."""
    root = broker.os.path.join(releases_root, sha)
    root_metadata = broker.os.lstat(root)
    if not broker.stat.S_ISDIR(root_metadata.st_mode) or root_metadata.st_uid != owner_uid or root_metadata.st_gid != worker_gid or broker.stat.S_IMODE(root_metadata.st_mode) != 0o550:
        raise broker.BrokerProtocolError("staged release root ownership or mode is invalid")
    entries = 0
    for current, directories, files in broker.os.walk(root, topdown=True, followlinks=False):
        for name in directories:
            metadata = broker.os.lstat(broker.os.path.join(current, name))
            if not broker.stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid or metadata.st_gid != worker_gid or broker.stat.S_IMODE(metadata.st_mode) != 0o550:
                raise broker.BrokerProtocolError("staged release directory ownership or mode is invalid")
            entries += 1
        for name in files:
            metadata = broker.os.lstat(broker.os.path.join(current, name))
            mode = broker.stat.S_IMODE(metadata.st_mode)
            if not broker.stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner_uid or metadata.st_gid != worker_gid or mode not in (0o440, 0o550):
                raise broker.BrokerProtocolError("staged release file ownership or mode is invalid")
            entries += 1
    if entries == 0:
        raise broker.BrokerProtocolError("staged release is empty")
    return entries
