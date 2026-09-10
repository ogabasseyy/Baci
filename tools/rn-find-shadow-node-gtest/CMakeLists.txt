# Host CMake: compile + run real patched FindShadowNodeByTagTest.cpp from node_modules.
cmake_minimum_required(VERSION 3.22)
project(rn_find_shadow_node_gtest LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT REACT_NATIVE_DIR)
  message(FATAL_ERROR "REACT_NATIVE_DIR must point at node_modules/react-native")
endif()
if(NOT BACI_RN_GTEST_WORK)
  message(FATAL_ERROR "BACI_RN_GTEST_WORK must point at the bootstrap work directory")
endif()

file(TO_CMAKE_PATH "${REACT_NATIVE_DIR}" REACT_NATIVE_DIR)
file(TO_CMAKE_PATH "${BACI_RN_GTEST_WORK}" BACI_RN_GTEST_WORK)
set(REACT_COMMON_DIR "${REACT_NATIVE_DIR}/ReactCommon")
set(REACT_ANDROID_DIR "${REACT_NATIVE_DIR}/ReactAndroid")
set(REACT_BUILD_DIR "${BACI_RN_GTEST_WORK}")
set(THIRD_PARTY_NDK_DIR "${BACI_RN_GTEST_WORK}/third-party-ndk")
set(GTEST_SOURCE_DIR "${BACI_RN_GTEST_WORK}/googletest")
set(HOST_OVERRIDES_DIR "${CMAKE_CURRENT_SOURCE_DIR}/host_overrides")

foreach(required_path
    "${REACT_COMMON_DIR}"
    "${THIRD_PARTY_NDK_DIR}/folly/CMakeLists.txt"
    "${GTEST_SOURCE_DIR}/CMakeLists.txt"
    "${HOST_OVERRIDES_DIR}/react/renderer/element/testUtils.h")
  if(NOT EXISTS "${required_path}")
    message(FATAL_ERROR "Missing ${required_path}; run bootstrap-native-deps.sh first")
  endif()
endforeach()

set(BACI_RN_GTEST_SANITIZER "" CACHE STRING "Optional sanitizer: address")
if(BACI_RN_GTEST_SANITIZER STREQUAL "address" OR BACI_RN_GTEST_SANITIZER STREQUAL "asan")
  add_compile_options(-fsanitize=address -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address)
elseif(BACI_RN_GTEST_SANITIZER STREQUAL "thread" OR BACI_RN_GTEST_SANITIZER STREQUAL "tsan")
  message(FATAL_ERROR "TSAN is intentionally unsupported for this gate")
elseif(NOT BACI_RN_GTEST_SANITIZER STREQUAL "")
  message(FATAL_ERROR "Unsupported BACI_RN_GTEST_SANITIZER=${BACI_RN_GTEST_SANITIZER}")
endif()

# Host GCC (Ubuntu CI) differs from Android NDK include/Werror defaults.
if(NOT APPLE)
  add_compile_options(
    -Wno-error=class-memaccess
    -Wno-class-memaccess
    -Wno-error=maybe-uninitialized
    -Wno-maybe-uninitialized
  )
  # AnsiParser.h uses uint8_t without <cstdint>; NDK headers pull it transitively.
  add_compile_options(
    "$<$<COMPILE_LANGUAGE:CXX>:-include>"
    "$<$<COMPILE_LANGUAGE:CXX>:cstdint>"
  )
endif()

include(${REACT_COMMON_DIR}/cmake-utils/react-native-flags.cmake)
include(${REACT_COMMON_DIR}/cmake-utils/internal/react-native-platform-selector.cmake)

add_library(log INTERFACE)

function(add_react_third_party_ndk_subdir relative_path)
  add_subdirectory(${THIRD_PARTY_NDK_DIR}/${relative_path} third-party-ndk/${relative_path})
endfunction()

function(add_react_common_subdir relative_path)
  add_subdirectory(${REACT_COMMON_DIR}/${relative_path} ReactCommon/${relative_path})
endfunction()

add_react_third_party_ndk_subdir(glog)
# Host GCC treats ignored write() as -Werror; Android NDK builds do not.
target_compile_options(glog PRIVATE -Wno-error=unused-result)
add_react_third_party_ndk_subdir(boost)
add_react_third_party_ndk_subdir(double-conversion)
add_react_third_party_ndk_subdir(fast_float)
add_react_third_party_ndk_subdir(fmt)
add_react_third_party_ndk_subdir(folly)
# Ubuntu GCC 13+: Folly F14MapFallback memcpy must not fail consumers (jsi, etc.).
target_compile_options(folly_runtime PUBLIC
  -Wno-error=class-memaccess
  -Wno-class-memaccess)

add_library(glog_init OBJECT
  ${REACT_ANDROID_DIR}/src/main/jni/first-party/fbgloginit/glog_init.cpp)
target_include_directories(glog_init PUBLIC
  ${REACT_ANDROID_DIR}/src/main/jni/first-party/fbgloginit)
target_link_libraries(glog_init PUBLIC glog)
target_compile_reactnative_options(glog_init PRIVATE)

set(BUILD_GMOCK OFF CACHE BOOL "" FORCE)
set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
add_subdirectory(${GTEST_SOURCE_DIR} googletest-build EXCLUDE_FROM_ALL)

add_subdirectory(${REACT_COMMON_DIR}/yoga yoga_build)
target_include_directories(yogacore PUBLIC ${REACT_COMMON_DIR}/yoga)
add_library(yoga INTERFACE)
target_link_libraries(yoga INTERFACE yogacore)
target_include_directories(yoga INTERFACE ${REACT_COMMON_DIR}/yoga)

add_react_common_subdir(jsi)
add_react_common_subdir(oscompat)
add_react_common_subdir(callinvoker)
add_react_common_subdir(runtimeexecutor)
add_react_common_subdir(react/debug)
add_react_common_subdir(react/timing)
add_react_common_subdir(reactperflogger)
add_react_common_subdir(logger)
add_react_common_subdir(react/featureflags)
add_react_common_subdir(react/utils)
add_react_common_subdir(jsinspector-modern/cdp)
add_react_common_subdir(jsinspector-modern/network)
add_react_common_subdir(jsinspector-modern/tracing)
add_react_common_subdir(jsinspector-modern)
add_react_common_subdir(cxxreact)
add_react_common_subdir(react/bridging)
add_react_common_subdir(react/performance/timeline)
add_react_common_subdir(react/performance/cdpmetrics)
add_react_common_subdir(react/renderer/runtimescheduler)
add_react_common_subdir(react/renderer/debug)
add_react_common_subdir(react/renderer/mapbuffer)
add_react_common_subdir(react/renderer/graphics)
add_react_common_subdir(react/renderer/css)
add_react_common_subdir(react/renderer/core)
add_react_common_subdir(react/renderer/consistency)
# Platform cxx headers must be visible to any TU that includes ViewProps.h etc.
include_directories(
  ${REACT_COMMON_DIR}/react/renderer/components/view/platform/cxx
  ${REACT_COMMON_DIR}/react/renderer/graphics/platform/cxx
  ${REACT_COMMON_DIR}/react/utils/platform/cxx
)
add_react_common_subdir(react/renderer/components/view)
add_react_common_subdir(react/renderer/components/legacyviewmanagerinterop)
add_react_common_subdir(react/renderer/componentregistry)
add_react_common_subdir(react/renderer/element)
add_react_common_subdir(react/renderer/bridging)
add_react_common_subdir(react/renderer/telemetry)
add_react_common_subdir(react/renderer/leakchecker)
add_react_common_subdir(react/renderer/components/root)
add_react_common_subdir(react/renderer/components/scrollview)
add_react_common_subdir(react/renderer/mounting)
add_react_common_subdir(react/renderer/attributedstring)
include_directories(
  ${REACT_COMMON_DIR}/react/renderer/textlayoutmanager/platform/cxx
)
add_react_common_subdir(react/renderer/textlayoutmanager)
add_react_common_subdir(react/renderer/components/text)
add_react_common_subdir(react/renderer/uimanager/consistency)
add_react_common_subdir(react/renderer/dom)
add_react_common_subdir(react/renderer/uimanager)

set(FIND_SHADOW_TEST_SRC
  "${REACT_COMMON_DIR}/react/renderer/uimanager/tests/FindShadowNodeByTagTest.cpp")
if(NOT EXISTS "${FIND_SHADOW_TEST_SRC}")
  message(FATAL_ERROR "Missing real suite file: ${FIND_SHADOW_TEST_SRC}")
endif()

add_executable(find_shadow_node_by_tag_test ${FIND_SHADOW_TEST_SRC})
target_include_directories(find_shadow_node_by_tag_test PRIVATE
  ${HOST_OVERRIDES_DIR}
  ${REACT_COMMON_DIR}
  ${REACT_COMMON_DIR}/jsi
)

target_link_libraries(find_shadow_node_by_tag_test PRIVATE
  GTest::gtest
  GTest::gtest_main
  react_renderer_uimanager
  react_renderer_uimanager_consistency
  react_renderer_mounting
  react_renderer_element
  react_renderer_componentregistry
  react_renderer_core
  react_renderer_consistency
  react_renderer_bridging
  react_renderer_dom
  react_renderer_debug
  react_renderer_graphics
  react_renderer_css
  react_renderer_mapbuffer
  react_renderer_telemetry
  react_renderer_leakchecker
  react_renderer_runtimescheduler
  rrc_root
  rrc_view
  rrc_scrollview
  rrc_legacyviewmanagerinterop
  rrc_text
  react_renderer_textlayoutmanager
  react_renderer_attributedstring
  react_featureflags
  react_debug
  react_utils
  react_cxxreact
  react_bridging
  react_performance_timeline
  react_performance_cdpmetrics
  reactperflogger
  logger
  jsinspector
  jsinspector_tracing
  jsinspector_network
  jsinspector_cdp
  runtimeexecutor
  callinvoker
  oscompat
  glog_init
  jsi
  yoga
  folly_runtime
  glog
  fmt
  double-conversion
  boost
  fast_float
)

if(APPLE)
  target_link_libraries(find_shadow_node_by_tag_test PRIVATE "-framework Foundation")
else()
  find_package(Threads REQUIRED)
  target_link_libraries(find_shadow_node_by_tag_test PRIVATE Threads::Threads dl)
endif()

target_compile_reactnative_options(find_shadow_node_by_tag_test PRIVATE)
