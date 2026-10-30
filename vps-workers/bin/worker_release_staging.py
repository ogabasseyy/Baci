"""Untrusted archive staging and release tree validation."""
import worker_release_broker as broker
import io, os, re, shutil, signal, stat, time


def _close_inherited_descriptors(keep_fds: set[int]) -> None:
    """Close broker lock FDs in the no-exec archive child before UID drop."""
    descriptor_dir = "/proc/self/fd" if broker.os.path.isdir("/proc/self/fd") else "/dev/fd"
    try:
        inherited = [int(name) for name in broker.os.listdir(descriptor_dir) if name.isdigit()]
    except OSError as error:
        raise broker.BrokerProtocolError("extractor descriptor isolation failed") from error
    for fd in inherited:
        if fd > 2 and fd not in keep_fds:
            try:
                broker.os.close(fd)
            except OSError:
                pass


def _drop_extractor_privileges(worker_uid: int, worker_gid: int, lock_gid: int) -> None:
    """Keep only the provisioned traversal group before changing identity."""
    broker.os.setgroups([lock_gid])
    broker.os.setgid(worker_gid)
    broker.os.setuid(worker_uid)


def _assert_root_owned_executable(path: str) -> None:
    metadata = broker.os.stat(path, follow_symlinks=False)
    if not broker.stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise PermissionError("trusted dispatcher files must be root-owned regular files")
    if not metadata.st_mode & 0o111:
        raise PermissionError("trusted dispatcher is not executable")


def _run_as_worker_extractor(archive_bytes: bytes, destination: str, worker_uid: int, worker_gid: int) -> int:
    """Fork a one-shot child, retain only baci-locks, then drop UID/GID and parse tar."""
    try:
        lock_gid = broker.grp.getgrnam("baci-locks").gr_gid
    except KeyError as error:
        raise broker.BrokerProtocolError("required worker lock group is unavailable") from error
    read_fd, write_fd = broker.os.pipe()
    child = broker.os.fork()
    if child == 0:
        try:
            broker.os.close(read_fd)
            _close_inherited_descriptors({write_fd})
            # /srv/baci-workers is root:baci-locks 0710. The extractor needs
            # this one provisioned supplementary group to traverse it.
            _drop_extractor_privileges(worker_uid, worker_gid, lock_gid)
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


def _validate_runtime_dependencies(root: str, *, owner_uid: int, worker_gid: int) -> None:
    """Require the frozen dependency paths consumed by worker launchers.

    This is a structural gate only: it proves that the immutable release has
    the required materialized paths, not where their contents came from.
    Dependency builders must materialize pnpm links before this boundary;
    staged releases reject symlinks throughout.
    """
    def require_directory(relative: str) -> str:
        path = broker.os.path.join(root, relative)
        try:
            metadata = broker.os.lstat(path)
        except OSError as error:
            raise broker.BrokerProtocolError("staged release is missing required runtime dependencies") from error
        if (not broker.stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid
                or metadata.st_gid != worker_gid or broker.stat.S_IMODE(metadata.st_mode) != 0o550):
            raise broker.BrokerProtocolError("staged runtime dependency directory is unsafe")
        return path

    root_modules = require_directory("node_modules")
    web_modules = require_directory("apps/web/node_modules")
    bin_dir = require_directory("apps/web/node_modules/.bin")
    # Empty dependency roots are the archive-only case this gate is meant to
    # prevent. Inspect entry types without following links.
    for path in (root_modules, web_modules):
        try:
            entries = list(broker.os.scandir(path))
        except OSError as error:
            raise broker.BrokerProtocolError("staged release runtime dependencies are unreadable") from error
        if not entries or any(entry.is_symlink() for entry in entries):
            raise broker.BrokerProtocolError("staged release is missing required runtime dependencies")
    tsx = broker.os.path.join(bin_dir, "tsx")
    try:
        metadata = broker.os.lstat(tsx)
    except OSError as error:
        raise broker.BrokerProtocolError("staged release is missing required web runtime dependencies") from error
    if (not broker.stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner_uid
            or metadata.st_gid != worker_gid or broker.stat.S_IMODE(metadata.st_mode) != 0o550
            or not metadata.st_mode & 0o111):
        raise broker.BrokerProtocolError("staged web runtime entrypoint is unsafe")


def _stage_archive(archive: bytes, releases_root: str, sha: str, worker_uid: int, worker_gid: int,
                   *, owner_uid: int = 0) -> int:
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
        # Worker services consume a root-level runtime layout, while the
        # repository archive nests these directories under vps-workers/.
        repository_workers = broker.os.path.join(destination, "vps-workers")
        if broker.os.path.isdir(repository_workers) and not broker.os.path.islink(repository_workers):
            for entry in ("bin", "jobs", "lib", "config", "systemd"):
                source = broker.os.path.join(repository_workers, entry)
                target = broker.os.path.join(destination, entry)
                if not broker.os.path.lexists(source):
                    continue
                if not broker.os.path.isdir(source) or broker.os.path.islink(source):
                    raise broker.BrokerProtocolError("repository worker layout contains an unsafe directory")
                if broker.os.path.lexists(target):
                    raise broker.BrokerProtocolError("release archive conflicts with the worker runtime layout")
                broker.shutil.copytree(source, target, copy_function=broker.shutil.copy2)
            dotenv = broker.os.path.join(destination, ".github", "scripts", "gigl-dotenv.sh")
            target = broker.os.path.join(destination, "bin", "gigl-dotenv.sh")
            if not broker.os.path.isfile(dotenv) or broker.os.path.islink(dotenv) or broker.os.path.lexists(target):
                raise broker.BrokerProtocolError("release archive is missing the trusted dotenv reader")
            broker.shutil.copy2(dotenv, target)
        broker._freeze_release_tree(destination, worker_gid, owner_uid=owner_uid)
        _validate_runtime_dependencies(destination, owner_uid=owner_uid, worker_gid=worker_gid)
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
    _validate_runtime_dependencies(root, owner_uid=owner_uid, worker_gid=worker_gid)
    return entries
