#!/usr/bin/env bash
# Prepare host third-party sources matching React Native 0.86.2 third-party-ndk.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RN_DIR="${REACT_NATIVE_DIR:-$ROOT/node_modules/react-native}"
JNI_3P="$RN_DIR/ReactAndroid/src/main/jni/third-party"
WORK="${BACI_RN_GTEST_WORK:-$ROOT/tools/rn-find-shadow-node-gtest/.work}"
DOWNLOADS="$WORK/downloads"
NDK="$WORK/third-party-ndk"
GTEST_DIR="$WORK/googletest"

BOOST_VERSION="1_83_0"
DOUBLE_CONVERSION_VERSION="1.1.6"
FAST_FLOAT_VERSION="8.0.0"
FMT_VERSION="12.1.0"
FOLLY_VERSION="2024.11.18.00"
GLOG_VERSION="0.3.5"
GTEST_VERSION="1.15.2"

mkdir -p "$DOWNLOADS" "$NDK"

download() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" ]]; then
    echo "cached: $(basename "$dest")"
    return 0
  fi
  echo "download: $url"
  curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 30 -o "$dest.partial" "$url"
  mv "$dest.partial" "$dest"
}

# --- boost: prefer system headers (Homebrew / apt libboost-dev) ---
if [[ ! -f "$NDK/boost/CMakeLists.txt" ]]; then
  BOOST_INC=""
  for candidate in \
      "${BACI_RN_GTEST_BOOST_INCLUDE:-}" \
      /opt/homebrew/include \
      /usr/local/include \
      /usr/include
  do
    if [[ -n "$candidate" && -f "$candidate/boost/version.hpp" ]]; then
      BOOST_INC="$candidate"
      break
    fi
  done

  rm -rf "$NDK/boost"
  mkdir -p "$NDK/boost"

  if [[ -n "$BOOST_INC" ]]; then
    echo "using system boost headers: $BOOST_INC/boost (isolated include tree)"
    # Isolate so /usr/include or Homebrew's sibling headers (e.g. glog) are not
    # injected ahead of our prepared third-party-ndk/glog/exported.
    mkdir -p "$NDK/boost/include"
    ln -sfn "$BOOST_INC/boost" "$NDK/boost/include/boost"
    cat >"$NDK/boost/CMakeLists.txt" <<'EOF'
cmake_minimum_required(VERSION 3.13)
add_library(boost INTERFACE)
target_include_directories(boost INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
EOF
  else
    # Ubuntu CI without libboost-dev: download headers-only extract.
    download \
      "https://archives.boost.io/release/${BOOST_VERSION//_/.}/source/boost_${BOOST_VERSION}.tar.gz" \
      "$DOWNLOADS/boost_${BOOST_VERSION}.tar.gz"
    tar -xzf "$DOWNLOADS/boost_${BOOST_VERSION}.tar.gz" -C "$NDK/boost" \
      "boost_${BOOST_VERSION}/boost"
    cat >"$NDK/boost/CMakeLists.txt" <<'EOF'
cmake_minimum_required(VERSION 3.13)
add_library(boost INTERFACE)
target_include_directories(boost INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/boost_1_83_0)
EOF
  fi
fi

# --- double-conversion ---
if [[ ! -f "$NDK/double-conversion/CMakeLists.txt" ]]; then
  download \
    "https://github.com/google/double-conversion/archive/v${DOUBLE_CONVERSION_VERSION}.tar.gz" \
    "$DOWNLOADS/double-conversion-${DOUBLE_CONVERSION_VERSION}.tar.gz"
  rm -rf "$NDK/double-conversion" "$WORK/tmp-dc"
  mkdir -p "$WORK/tmp-dc" "$NDK/double-conversion/double-conversion"
  tar -xzf "$DOWNLOADS/double-conversion-${DOUBLE_CONVERSION_VERSION}.tar.gz" -C "$WORK/tmp-dc"
  cp -R "$WORK/tmp-dc/double-conversion-${DOUBLE_CONVERSION_VERSION}/src/"* \
    "$NDK/double-conversion/double-conversion/"
  cp "$JNI_3P/double-conversion/CMakeLists.txt" "$NDK/double-conversion/CMakeLists.txt"
  rm -rf "$WORK/tmp-dc"
fi

# --- fast_float ---
if [[ ! -f "$NDK/fast_float/CMakeLists.txt" ]]; then
  download \
    "https://github.com/fastfloat/fast_float/archive/v${FAST_FLOAT_VERSION}.tar.gz" \
    "$DOWNLOADS/fast_float-${FAST_FLOAT_VERSION}.tar.gz"
  rm -rf "$NDK/fast_float" "$WORK/tmp-ff"
  mkdir -p "$WORK/tmp-ff" "$NDK/fast_float"
  tar -xzf "$DOWNLOADS/fast_float-${FAST_FLOAT_VERSION}.tar.gz" -C "$WORK/tmp-ff"
  cp -R "$WORK/tmp-ff/fast_float-${FAST_FLOAT_VERSION}/include" "$NDK/fast_float/include"
  cp "$JNI_3P/fast_float/CMakeLists.txt" "$NDK/fast_float/CMakeLists.txt"
  rm -rf "$WORK/tmp-ff"
fi

# --- fmt ---
if [[ ! -f "$NDK/fmt/CMakeLists.txt" ]]; then
  download \
    "https://github.com/fmtlib/fmt/archive/${FMT_VERSION}.tar.gz" \
    "$DOWNLOADS/fmt-${FMT_VERSION}.tar.gz"
  rm -rf "$NDK/fmt" "$WORK/tmp-fmt"
  mkdir -p "$WORK/tmp-fmt" "$NDK/fmt"
  tar -xzf "$DOWNLOADS/fmt-${FMT_VERSION}.tar.gz" -C "$WORK/tmp-fmt"
  cp -R "$WORK/tmp-fmt/fmt-${FMT_VERSION}/src" "$NDK/fmt/src"
  cp -R "$WORK/tmp-fmt/fmt-${FMT_VERSION}/include" "$NDK/fmt/include"
  cp "$JNI_3P/fmt/CMakeLists.txt" "$NDK/fmt/CMakeLists.txt"
  rm -rf "$WORK/tmp-fmt"
fi

# --- folly (host-adjusted flags; includes SanitizeLeak.cpp for ASAN) ---
if [[ ! -d "$NDK/folly/folly" ]]; then
  download \
    "https://github.com/facebook/folly/archive/v${FOLLY_VERSION}.tar.gz" \
    "$DOWNLOADS/folly-${FOLLY_VERSION}.tar.gz"
  rm -rf "$NDK/folly" "$WORK/tmp-folly"
  mkdir -p "$WORK/tmp-folly" "$NDK/folly"
  tar -xzf "$DOWNLOADS/folly-${FOLLY_VERSION}.tar.gz" -C "$WORK/tmp-folly"
  cp -R "$WORK/tmp-folly/folly-${FOLLY_VERSION}/folly" "$NDK/folly/folly"
  rm -rf "$WORK/tmp-folly"
fi
# Always refresh host folly CMakeLists so ASAN SanitizeLeak.cpp stays wired.
mkdir -p "$NDK/folly"
cat >"$NDK/folly/CMakeLists.txt" <<'EOF'
cmake_minimum_required(VERSION 3.13)
set(folly_FLAGS
  -DFOLLY_NO_CONFIG=1
  -DFOLLY_HAVE_CLOCK_GETTIME=1
  -DFOLLY_CFG_NO_COROUTINES=1
  -DFOLLY_MOBILE=1
  -DFOLLY_HAVE_RECVMMSG=1
  -DFOLLY_HAVE_PTHREAD=1
)
if(APPLE)
  list(APPEND folly_FLAGS -DFOLLY_USE_LIBCPP=1)
else()
  list(APPEND folly_FLAGS -DFOLLY_HAVE_XSI_STRERROR_R=1)
endif()
set(folly_runtime_SRC
  folly/Conv.cpp folly/Demangle.cpp folly/FileUtil.cpp folly/Format.cpp
  folly/ScopeGuard.cpp folly/SharedMutex.cpp folly/String.cpp folly/Unicode.cpp
  folly/concurrency/CacheLocality.cpp folly/container/detail/F14Table.cpp
  folly/detail/FileUtilDetail.cpp folly/detail/Futex.cpp
  folly/detail/SplitStringSimd.cpp folly/detail/UniqueInstance.cpp
  folly/hash/SpookyHashV2.cpp folly/json/dynamic.cpp folly/json/json_pointer.cpp
  folly/json/json.cpp folly/lang/CString.cpp folly/lang/Exception.cpp
  folly/lang/SafeAssert.cpp folly/lang/ToAscii.cpp
  folly/memory/detail/MallocImpl.cpp folly/memory/SanitizeLeak.cpp
  folly/net/NetOps.cpp folly/portability/SysUio.cpp
  folly/synchronization/SanitizeThread.cpp folly/synchronization/ParkingLot.cpp
  folly/system/AtFork.cpp folly/system/ThreadId.cpp)
add_library(folly_runtime STATIC ${folly_runtime_SRC})
target_compile_options(folly_runtime PRIVATE
  -fexceptions -fno-omit-frame-pointer -frtti -Wno-sign-compare ${folly_FLAGS})
target_compile_options(folly_runtime PUBLIC ${folly_FLAGS})
target_include_directories(folly_runtime PUBLIC .)
target_link_libraries(folly_runtime glog double-conversion boost fmt fast_float)
if(NOT APPLE)
  find_package(Threads REQUIRED)
  target_link_libraries(folly_runtime Threads::Threads)
endif()
EOF

# --- glog (PrepareGlogTask-equivalent token replace) ---
if [[ ! -f "$NDK/glog/CMakeLists.txt" ]]; then
  download \
    "https://github.com/google/glog/archive/v${GLOG_VERSION}.tar.gz" \
    "$DOWNLOADS/glog-${GLOG_VERSION}.tar.gz"
  rm -rf "$NDK/glog" "$WORK/tmp-glog"
  mkdir -p "$WORK/tmp-glog" "$NDK/glog"
  tar -xzf "$DOWNLOADS/glog-${GLOG_VERSION}.tar.gz" -C "$WORK/tmp-glog"
  cp -R "$WORK/tmp-glog/glog-${GLOG_VERSION}" "$NDK/glog/glog-${GLOG_VERSION}"
  cp "$JNI_3P/glog/CMakeLists.txt" "$NDK/glog/CMakeLists.txt"
  cp "$JNI_3P/glog/config.h" "$NDK/glog/config.h"
  # Source files `#include "config.h"` resolve relative to src/ first.
  cp "$JNI_3P/glog/config.h" "$NDK/glog/glog-${GLOG_VERSION}/src/config.h"
  # Host: enable execinfo for symbolize on macOS/Linux.
  if grep -q '/\* #undef HAVE_EXECINFO_H \*/' "$NDK/glog/glog-${GLOG_VERSION}/src/config.h"; then
    sed -i.bak 's|/\* #undef HAVE_EXECINFO_H \*/|#define HAVE_EXECINFO_H 1|' \
      "$NDK/glog/glog-${GLOG_VERSION}/src/config.h" \
      "$NDK/glog/config.h"
    rm -f "$NDK/glog/glog-${GLOG_VERSION}/src/config.h.bak" "$NDK/glog/config.h.bak"
  fi
  python3 - <<'PY' "$NDK/glog"
import pathlib, sys
root = pathlib.Path(sys.argv[1])
tokens = {
    "ac_cv_have_unistd_h": "1",
    "ac_cv_have_stdint_h": "1",
    "ac_cv_have_systypes_h": "1",
    "ac_cv_have_inttypes_h": "1",
    "ac_cv_have_libgflags": "0",
    "ac_google_start_namespace": "namespace google {",
    "ac_cv_have_uint16_t": "1",
    "ac_cv_have_u_int16_t": "1",
    "ac_cv_have___uint16": "0",
    "ac_google_end_namespace": "}",
    "ac_cv_have___builtin_expect": "1",
    "ac_google_namespace": "google",
    "ac_cv___attribute___noinline": "__attribute__ ((noinline))",
    "ac_cv___attribute___noreturn": "__attribute__ ((noreturn))",
    "ac_cv___attribute___printf_4_5": "__attribute__((__format__ (__printf__, 4, 5)))",
}
for path in root.rglob("*.h.in"):
    text = path.read_text()
    for key, value in tokens.items():
        text = text.replace("@%s@" % key, value)
    out = path.parent / path.name[:-3]
    out.write_text(text)
exported = root / "exported" / "glog"
exported.mkdir(parents=True, exist_ok=True)
for name in ("stl_logging.h", "logging.h", "raw_logging.h", "vlog_is_on.h", "log_severity.h"):
    found = list(root.rglob(name))
    preferred = [p for p in found if "src/glog" in str(p).replace("\\", "/") and not str(p).endswith(".in")]
    if not preferred:
        preferred = [p for p in found if not str(p).endswith(".in")]
    if not preferred:
        raise SystemExit(f"missing glog header {name}")
    (exported / name).write_text(preferred[0].read_text())
print("glog exported ok")
PY
  rm -rf "$WORK/tmp-glog"
fi

# --- googletest ---
if [[ ! -f "$GTEST_DIR/CMakeLists.txt" ]]; then
  download \
    "https://github.com/google/googletest/archive/refs/tags/v${GTEST_VERSION}.tar.gz" \
    "$DOWNLOADS/googletest-${GTEST_VERSION}.tar.gz"
  rm -rf "$GTEST_DIR" "$WORK/tmp-gtest"
  mkdir -p "$WORK/tmp-gtest"
  tar -xzf "$DOWNLOADS/googletest-${GTEST_VERSION}.tar.gz" -C "$WORK/tmp-gtest"
  mv "$WORK/tmp-gtest/googletest-${GTEST_VERSION}" "$GTEST_DIR"
  rm -rf "$WORK/tmp-gtest"
fi

cat >"$WORK/native-deps.ready" <<EOF
boost=${BOOST_VERSION}
double-conversion=${DOUBLE_CONVERSION_VERSION}
fast_float=${FAST_FLOAT_VERSION}
fmt=${FMT_VERSION}
folly=${FOLLY_VERSION}
glog=${GLOG_VERSION}
gtest=${GTEST_VERSION}
prepared_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "native deps ready: $NDK"
echo "googletest ready: $GTEST_DIR"
