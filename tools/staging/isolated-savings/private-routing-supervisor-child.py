import ctypes
import errno
import os
import signal
import stat
import sys


def launch(arguments):
    if sys.platform != "linux" or os.geteuid() == 0 or len(arguments) != 3 or arguments[2] not in ("--test", "--serve"):
        raise RuntimeError("Unprivileged Linux child required")
    expected_parent = int(arguments[0])
    directory = arguments[1]
    executable = "/usr/sbin/nginx"
    executable_stat = os.stat(executable)
    if not stat.S_ISREG(executable_stat.st_mode) or executable_stat.st_uid != 0 or executable_stat.st_mode & 0o6022:
        raise RuntimeError("Trusted nginx executable required")
    try:
        os.getxattr(executable, "security.capability")
    except OSError as error:
        if error.errno not in (errno.ENODATA, errno.ENOTSUP):
            raise
    else:
        raise RuntimeError("Nginx file capabilities forbidden")
    directory_stat = os.lstat(directory)
    if not stat.S_ISDIR(directory_stat.st_mode) or directory_stat.st_uid != os.geteuid() or directory_stat.st_mode & 0o077:
        raise RuntimeError("Private runtime directory required")
    if os.getppid() != expected_parent:
        raise RuntimeError("Supervisor exited")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise RuntimeError("Parent death guard unavailable")
    if os.getppid() != expected_parent:
        raise RuntimeError("Supervisor exited")
    command = [executable, "-p", directory + "/", "-c", "nginx.conf", "-e", "/dev/null"]
    if arguments[2] == "--test":
        command.append("-t")
    os.execve(executable, command, {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"})


if __name__ == "__main__":
    try:
        launch(sys.argv[1:])
    except Exception:
        sys.exit(1)
