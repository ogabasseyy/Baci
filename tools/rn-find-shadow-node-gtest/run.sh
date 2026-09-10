#!/usr/bin/env bash
# Fail-closed gate: verify ownership patch, then compile + run the real
# node_modules FindShadowNodeByTagTest.cpp via a hermetic ReactCommon host graph.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOL_DIR="$(cd "$(dirname "$0")" && pwd)"
RN_DIR="${REACT_NATIVE_DIR:-$ROOT/node_modules/react-native}"
TEST_SRC="$RN_DIR/ReactCommon/react/renderer/uimanager/tests/FindShadowNodeByTagTest.cpp"
UIMANAGER_SRC="$RN_DIR/ReactCommon/react/renderer/uimanager/UIManager.cpp"
WORK="${BACI_RN_GTEST_WORK:-$TOOL_DIR/.work}"
BUILD_DIR="$WORK/build"

echo "== patch contract =="
if [[ ! -f "$TEST_SRC" ]]; then
  echo "error: missing $TEST_SRC (run pnpm install so patches/react-native@*.patch applies)" >&2
  exit 1
fi
if [[ ! -f "$UIMANAGER_SRC" ]]; then
  echo "error: missing $UIMANAGER_SRC" >&2
  exit 1
fi
if ! grep -q 'shadowTree.getCurrentRevision().rootShadowNode' "$UIMANAGER_SRC"; then
  echo "error: UIManager.cpp is missing the shared-ownership findShadowNodeByTag fix" >&2
  exit 1
fi
if grep -q 'fixFindShadowNodeByTagRaceCondition()' "$UIMANAGER_SRC"; then
  echo "error: UIManager.cpp still gates ownership on the feature flag" >&2
  exit 1
fi
# Suite flag-off stays out of the package patch (300-line cap); apply here.
python3 "$TOOL_DIR/apply-suite-flag-off.py" "$TEST_SRC"
if ! grep -q 'Exercise the production default' "$TEST_SRC"; then
  echo "error: FindShadowNodeByTagTest.cpp is not the flag-disabled suite" >&2
  exit 1
fi
if ! grep -q 'return false;' "$TEST_SRC"; then
  echo "error: FindShadowNodeByTagTest.cpp must force fixFindShadowNodeByTagRaceCondition() off" >&2
  exit 1
fi
if ! grep -q 'ConcurrentFindAndCommitStress' "$TEST_SRC"; then
  echo "error: FindShadowNodeByTagTest.cpp is missing ConcurrentFindAndCommitStress" >&2
  exit 1
fi
echo "ok: UIManager ownership fix + flag-off suite present"

SANITIZER_CMAKE_ARG=()
if [[ -n "${BACI_RN_GTEST_SANITIZER:-}" ]]; then
  case "${BACI_RN_GTEST_SANITIZER}" in
    thread|tsan)
      echo "error: TSAN is intentionally unsupported for this gate" >&2
      exit 1
      ;;
    address|asan)
      SANITIZER_CMAKE_ARG+=(-DBACI_RN_GTEST_SANITIZER=address)
      ;;
    *)
      echo "error: unsupported BACI_RN_GTEST_SANITIZER=${BACI_RN_GTEST_SANITIZER}" >&2
      exit 1
      ;;
  esac
fi

echo "== bootstrap native deps =="
mkdir -p "$WORK"
export REACT_NATIVE_DIR="$RN_DIR"
export BACI_RN_GTEST_WORK="$WORK"
"$TOOL_DIR/bootstrap-native-deps.sh"
if [[ ! -f "$WORK/native-deps.ready" ]]; then
  echo "error: bootstrap did not produce $WORK/native-deps.ready" >&2
  exit 1
fi

echo "== cmake configure =="
CMAKE_CONFIG=(
  -S "$TOOL_DIR"
  -B "$BUILD_DIR"
  -G Ninja
  -DCMAKE_BUILD_TYPE="${CMAKE_BUILD_TYPE:-RelWithDebInfo}"
  -DREACT_NATIVE_DIR="$RN_DIR"
  -DBACI_RN_GTEST_WORK="$WORK"
)
# Prefer Clang on Linux: closer to NDK and avoids host-GCC -Wchanges-meaning on RN headers.
if [[ "$(uname -s)" == "Linux" ]] && command -v clang++ >/dev/null 2>&1; then
  CMAKE_CONFIG+=(-DCMAKE_C_COMPILER="${CC:-clang}" -DCMAKE_CXX_COMPILER="${CXX:-clang++}")
fi
if [[ ${#SANITIZER_CMAKE_ARG[@]} -gt 0 ]]; then
  CMAKE_CONFIG+=("${SANITIZER_CMAKE_ARG[@]}")
fi
cmake "${CMAKE_CONFIG[@]}"

echo "== cmake build =="
JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
cmake --build "$BUILD_DIR" --target find_shadow_node_by_tag_test -j"$JOBS"

BIN="$BUILD_DIR/find_shadow_node_by_tag_test"
if [[ ! -x "$BIN" ]]; then
  echo "error: missing executable $BIN" >&2
  exit 1
fi

# Prove we linked the real node_modules suite object, not a mirror.
if ! nm -C "$BIN" 2>/dev/null | grep -q 'FindShadowNodeByTagTest_ConcurrentFindAndCommitStress'; then
  if ! "$BIN" --gtest_list_tests 2>/dev/null | grep -q 'ConcurrentFindAndCommitStress'; then
    echo "error: binary does not expose FindShadowNodeByTagTest.ConcurrentFindAndCommitStress" >&2
    exit 1
  fi
fi

echo "== gtest FindShadowNodeByTagTest.* =="
set +e
"$BIN" --gtest_filter='FindShadowNodeByTagTest.*'
STATUS=$?
set -e
if [[ "$STATUS" -ne 0 ]]; then
  echo "error: FindShadowNodeByTagTest suite failed (exit $STATUS)" >&2
  exit "$STATUS"
fi

echo "ok: FindShadowNodeByTagTest.* passed"
