import fcntl
import multiprocessing
import os
import tempfile


def hold_lock(path, ready, release):
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    ready.set()
    release.wait()


def acquire_nonblocking(path):
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        return False
    finally:
        os.close(descriptor)


def main():
    with tempfile.TemporaryDirectory() as directory:
        os.chmod(directory, 0o700)
        path = os.path.join(directory, "runner.lock")
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        ready = multiprocessing.Event()
        release = multiprocessing.Event()
        process = multiprocessing.Process(target=hold_lock, args=(path, ready, release))
        process.start()
        if not ready.wait(5):
            raise RuntimeError("holder did not acquire flock")
        if acquire_nonblocking(path):
            raise RuntimeError("overlapping process acquired flock")
        process.terminate()
        process.join(5)
        if process.is_alive() or process.exitcode is None:
            raise RuntimeError("holder did not exit after simulated crash")
        if not acquire_nonblocking(path):
            raise RuntimeError("flock remained held after process crash")
    print("PASS two-process kernel flock exclusion and crash release")


if __name__ == "__main__":
    main()
