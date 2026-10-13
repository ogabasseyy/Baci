#!/usr/bin/env bash
# Shared download + digest helpers for FindShadowNode host bootstrap.
# shellcheck shell=bash

BOOST_VERSION="1_83_0"
DOUBLE_CONVERSION_VERSION="1.1.6"
FAST_FLOAT_VERSION="8.0.0"
FMT_VERSION="12.1.0"
FOLLY_VERSION="2024.11.18.00"
GLOG_VERSION="0.3.5"
GTEST_VERSION="1.15.2"

# SHA-256 digests for the pinned archive versions above (fail closed on mismatch).
BOOST_SHA256="85acabcc5a86ef2f32f4a67242aa6f4bccab63d85fe6a077e9010aabb3900850"
DOUBLE_CONVERSION_SHA256="6b850acd8e88515764472c52973277744a945f9a769a93968efc42efef64d67a"
FAST_FLOAT_SHA256="f312f2dc34c61e665f4b132c0307d6f70ad9420185fa831911bc24408acf625d"
FMT_SHA256="ea7de4299689e12b6dddd392f9896f08fb0777ac7168897a244a6d6085043fea"
FOLLY_SHA256="b2c6879ba8ba625218d1ab9eefcc1611a9003d05bc2cb1a38f3bae21892e5167"
GLOG_SHA256="7580e408a2c0b5a89ca214739978ce6ff480b5e7d8d7698a2aa92fadc484d1e0"
GTEST_SHA256="7b42b4d6ed48810c5362c265a17faebe90dc2373c885e5216439d37927f02926"

mkdir -p "$DOWNLOADS" "$NDK"

sha256_of() {
  openssl dgst -sha256 "$1" | awk '{print $NF}'
}

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(sha256_of "$file")"
  if [[ "$actual" != "$expected" ]]; then
    echo "error: sha256 mismatch for $(basename "$file")" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    return 1
  fi
}

download() {
  local url="$1"
  local dest="$2"
  local sha256="${3:-}"
  if [[ -z "$sha256" ]]; then
    echo "error: download requires a non-optional sha256 digest" >&2
    exit 1
  fi
  if [[ -f "$dest" ]]; then
    if verify_sha256 "$dest" "$sha256"; then
      echo "cached: $(basename "$dest")"
      return 0
    fi
    echo "cached archive failed digest check; re-downloading $(basename "$dest")"
    rm -f "$dest"
  fi
  echo "download: $url"
  curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 30 -o "$dest.partial" "$url"
  if ! verify_sha256 "$dest.partial" "$sha256"; then
    rm -f "$dest.partial"
    exit 1
  fi
  mv "$dest.partial" "$dest"
}

