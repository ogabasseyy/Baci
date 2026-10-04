"""Shared auditor constants: network/loader denylists, compiler-driver
spellings, shell keywords, interpreter allowlists, and environment
poison names. Leaf module (imports re only).
"""
import re


# Bare network-capable commands: no audited helper needs them —
# install.sh's pinned download curl is the single exemption
# (the installer URL rule constrains its target); git stays
# allowed (load-bearing, audited separately) and gh is confined
# to its load-bearing api shapes (see semgrep_sarif_gh). A bare
# curl/nc/ssh falls past every path rule while exfiltrating
# GH_TOKEN, so any other use drifts for human review.
NET_DENY = {"aria2c", "axel", "busybox", "curl", "ftp", "lftp",
            "mail", "msmtp", "nc", "ncat", "netcat", "nmap",
            "openssl", "scp", "sendmail", "sftp", "socat", "ssh",
            "sshpass", "telnet", "tftp", "rsync", "wget"}

# Build/package/container/provisioner drivers: each executes
# repo-controlled files. Canonical names only (variants fail at
# exec when absent); mix/stack/rake/port excluded (prose words).
LOAD_DENY = {"ansible", "ansible-playbook", "apt", "apt-get", "apk",
             "bazel", "bazelisk", "bmake", "brew", "buck2", "bun",
             "bundle", "cargo", "choco", "cmake", "conda", "crictl",
             "ctest", "ctr", "deno", "dnf", "docker", "flatpak",
             "gem", "gmake", "go", "gradle", "gradlew", "guix",
             "hatch", "helm", "installer", "invoke", "just",
             "kubectl", "mamba", "make", "meson", "micromamba",
             "msiexec", "mvn", "mvnw", "nerdctl", "ninja", "nix",
             "nox", "npm", "npx", "pacman", "pants", "pex", "pip",
             "pip3", "pipx", "pkg", "pkg_add", "pnpm", "podman",
             "poetry", "remake", "rustc", "sbt", "snap", "task",
             "terraform", "tofu", "tox", "uv", "vagrant", "winget",
             "yarn", "yum", "zypper", "composer", "conan", "pmake",
             "java", "javac", "run-parts", "sqlite3", "gcc", "cc",
             "g++", "c++", "clang", "clang++", "jshell",
             "ssh-keygen", "pwsh", "powershell", "swift",
             "swiftc", "script", "rpm", "m4", "hg", "julia",
             "lldb", "dotnet", "tclsh", "expect", "wish",
             "autoconf", "autoheader", "autom4te", "autoreconf",
             "autoupdate", "ifnames", "aclocal",
             "kotlinc", "kotlinc-jvm", "kotlin", "kapt"}
# java runs source files, classes, and jars (all repo-
# controlled inputs execute); javac runs annotation
# processors off the classpath; run-parts executes every
# eligible executable in its directory operand; sqlite3 runs
# .shell commands and -init files (dot-command execution);
# the gcc/clang drivers execute subprograms (cc1, cc1plus,
# as, ld) resolved through -B search-path directories, so a
# workspace -B dir runs attacker code with the helper token.
# jshell executes load-file operands; ssh-keygen -D loads a
# PKCS#11 provider .so (its constructor runs before provider
# validation); pwsh/powershell -File runs script operands and
# ship on the ubuntu runner image; swift executes program
# operands (ships on ubuntu-latest); swiftc loads compiler
# plugins (-load-plugin-executable) that execute at build.
# script -c runs its command operand (util-linux, on the
# ubuntu runner); bare script opens an interactive shell.
# rpm --eval feeds %(...) to /bin/sh; m4 runs syscmd/esyscmd
# (both ship on the ubuntu runner). hg runs pre-<command>
# hooks from HGRCPATH-selected config (PR-controlled file
# executes on any command); julia executes program-file
# operands (both ship on the ubuntu runner). lldb -s/--source
# executes command files (platform shell runs repo scripts;
# ships with Swift/LLVM on the ubuntu runner). dotnet executes
# project/dll operands (run/build/test restore and execute
# repo code); ships via the setup-dotnet action on demand.
# tclsh evaluates its file operand as Tcl ($env() reads the
# token); expect/wish are the same interpreter family.
# autoconf/autoheader/autom4te/autoreconf/autoupdate run m4
# over template operands (m4_esyscmd executes repo scripts);
# ifnames/aclocal scan and expand workspace .m4 macros.
# kotlinc -script executes .kts top-level code (kotlin runs
# classes/scripts, kapt runs annotation processors).
_GCC_RE = re.compile(
    r"^(?:[a-z0-9_]+-)*(?:cc|c\+\+|gcc|g\+\+|clang|"
    r"clang\+\+|gfortran)(?:-\d[\d.]*)?$")
# Versioned (gcc-12, g++-13, clang-17) and cross-prefixed
# (x86_64-linux-gnu-gcc) driver spellings share the -B
# mechanism; only dash-joined prefixes match (mycc/acc are
# not drivers). gfortran accepts GCC options (-B plants
# subprograms like f951).
_LD_SO_RE = re.compile(
    r"^ld(-linux.*|-musl.*)?\.so(\.\d+)?$")
# Glibc/musl dynamic linkers run directly (ld-linux-*.so.2,
# ld-musl-*.so.1, ld.so): --preload/--audit load attacker
# DSOs whose constructors run before main. No audited
# helper invokes the linker (verified).
_TCL_RE = re.compile(r"^(?:tclsh|wish)\d+(?:\.\d+)?$")
# Versioned Tcl shells (tclsh8.6, wish8.6, tclsh9.0) share
# the file-operand mechanism; the bare names sit in
# LOAD_DENY. expect ships unversioned only.


SHELL_KEYWORDS = {"if", "then", "else", "elif", "fi", "for",
                  "while", "until", "do", "done", "case", "in",
                  "esac", "select", "function", "time", "!",
                  "[[", "]]", "{", "}"}


INTERP_ALLOW = {"bash", "sh", "source", "."}
STRICT_ALLOW = INTERP_ALLOW | {
    "set", "echo", "exit", "export", "readonly", "local",
    "declare", "typeset", "true", "false", ":", "test"}


# Expected (env NAME, secrets KEY) bindings in the audited
# workflow: any other NAME bound to an exact ${{ secrets.KEY }}
# value drifts (a fresh LEAK binding plus an allowed echo
# would print the key in fragments redaction cannot match).
# SEMGREP_APP_TOKEN lives in security.yml (outside this audit's
# scope) and is pinned here for scope-widening safety.
SECRET_BINDINGS = {("GH_TOKEN", "GITHUB_TOKEN"),
                   ("META_API_KEY", "META_API_KEY"),
                   ("SEMGREP_APP_TOKEN", "SEMGREP_APP_TOKEN")}


# Tighter allowlist for the agent step and job-level env
# (which the agent step inherits): the pinned third-party
# process receives only its own credential. run.sh scrubs
# just GITHUB_TOKEN/GH_TOKEN, so any other secret bound
# here (SEMGREP_APP_TOKEN, an aliased GitHub token) would
# survive into the agent; by design even those two stay out.
AGENT_SECRET_BINDINGS = {("META_API_KEY", "META_API_KEY")}


# Short-lived bearer tokens the runner injects into every
# step: echo/printf of one leaks it to the Actions log even
# in a step that binds no secret of its own.
RUNTIME_TOKEN_VARS = {"ACTIONS_RUNTIME_TOKEN",
                      "ACTIONS_ID_TOKEN_REQUEST_TOKEN"}


# Vars whose assignment redirects execution or the environment
# of later commands in the same step (PATH hijack, preloaded
# libraries, startup files, parser behavior). GCONV_PATH
# resolves iconv conversion modules: a workspace module
# constructor runs with the helper token.
ENV_POISON = ("PATH", "LD_PRELOAD", "LD_LIBRARY_PATH",
              "LD_AUDIT", "GCONV_PATH",
              "BASH_ENV", "ENV", "ZDOTDIR", "PYTHONPATH",
              "PYTHONHOME", "RUBYLIB", "RUBYOPT", "PERL5LIB",
              "PERL5OPT", "PERL5DB", "NODE_PATH", "NODE_OPTIONS",
              "DYLD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
              "IFS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_PAGER",
              "GIT_EDITOR", "GIT_CONFIG_COUNT", "GIT_CONFIG_GLOBAL",
              "GIT_CONFIG_SYSTEM", "GIT_DIR", "GIT_WORK_TREE",
              "GIT_EXTERNAL_DIFF", "GIT_DIFF_OPTS", "GIT_ASKPASS",
              "SSH_ASKPASS", "GIT_CONFIG_PARAMETERS",
              "PAGER", "GH_HOST",
              "SHELLOPTS", "PS4", "BASH_CMDS",
              "TAR_OPTIONS")
# GIT_CONFIG_COUNT gates GIT_CONFIG_KEY_n/VALUE_n (verified: count 0
# ignores keys), so the COUNT exact-match closes the family.
# PERL5DB is inserted before the first line under perl -d;
# SHELLOPTS (xtrace) plus PS4 expand the token into the log
# from env alone (verified imports); BASH_CMDS elements join
# the command hash table (bash 4.0+); SSH_ASKPASS programs
# run on remote auth (sshpass's env counterpart); TAR_OPTIONS
# prepends tar flags (checkpoint-action=exec runs commands).


# Bash exported-function encoding (round 14, P1 4176327352):
# bash imports any environment variable named BASH_FUNC_<name>%%
# as a shell function at startup, so a poisoned mapping of that
# shape inside env: (or exported by a helper) redefines commands
# in every later step. The %% suffix form is the only encoding
# bash honors (the legacy ()-suffix form was removed in bash 4.4
# after Shellshock); names cannot contain whitespace (execve
# NAME=VALUE splits on the first =, and bash rejects names with
# spaces), so \S+%% neither over- nor under-matches.
_BASH_FUNC_ALT = r"BASH_FUNC_\S+%%"


def is_bash_func_key(name):
    """True when an env mapping key is a bash function import."""
    return re.fullmatch(_BASH_FUNC_ALT, name) is not None


STRIP_WORDS = {"if", "while", "until", "time", "!", "then",
               "do", "else", "elif", "{", "}"}


DEFERRED_RE = re.compile(
    r"(?:^|[;&|])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"
    r"(?:(?:export|local|readonly|declare|typeset)\s+"
    r"(?:-\S+\s+)*)?"
    r"(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"
    r"(PS4|PROMPT_COMMAND)\s*="
    r"|(?:^|[;&|])\s*printf\s+(?:--\s+)?-v\s*"
    r"(PS4|PROMPT_COMMAND)\b"
    # ${var@P} prompt-expands its value at the USE site,
    # running embedded $() (no PS4/PROMPT_COMMAND binding
    # needed); the value's shape is unknowable statically, so
    # the expansion itself drifts. @Q/@E/@A only quote.
    r"|\$\{[^${}]*@P\}")
XTRACE_RE = re.compile(
    r"\bset\s+-[A-Za-z]*x|\bset\s+-o\s+xtrace\b"
    r"|\b(?:bash|sh)\s+-[A-Za-z]*x")
_POISON_ALT = "(?:" + "|".join(
    v for v in ENV_POISON if v != "IFS") + "|" + _BASH_FUNC_ALT + ")"
BARE_POISON_RE = re.compile(
    r"(?:^|[;&|])\s*" + _POISON_ALT + r"(\[.*\])?\+?\s*=[^=]"
    r"|(?:^|[;&|])\s*IFS(\[.*\])?\+?\s*=(?![^;\s]*\s+"
    r"(?:command\s+|builtin\s+)?read\b)[^=]")
# Subscripts bind the name (PATH[0]=, BASH_CMDS[k]=) and +=
# appends (PATH+=); the greedy bracket closes nesting.
# Helpers authenticate gh via the environment (never expanding
# the token: the sole legit mention is run.sh's -u scrub), so
# any $GH_TOKEN/$GITHUB_TOKEN expansion stages a secret into a
# log, file, or agent input. \b keeps GH_TOKEN_SUFFIX silent.
SECRET_EXPAND_RE = re.compile(
    r"\$\{[#!]?GH_TOKEN\b|\$GH_TOKEN\b"
    r"|\$\{[#!]?GITHUB_TOKEN\b|\$GITHUB_TOKEN\b")
# Bare ${!name} indirects to a caller-chosen variable (value!);
# [@]/[*] subscripts and !prefix* globs list names only.
INDIRECT_RE = re.compile(
    r"\$\{![A-Za-z_]\w*(\[(?![@*]\])[^]]*\])?\}")
