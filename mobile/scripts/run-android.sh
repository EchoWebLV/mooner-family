#!/bin/sh
# Builds the release app (its JS is inside the APK, so no Metro server runs) and installs
# it on the phone plugged in over USB (adb devices). It signs with the debug keystore.
# The Android SDK and JDK 17 are Homebrew's on this Mac.
set -e
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
cd "$(dirname "$0")/.."
exec npx expo run:android --variant release --no-bundler "$@"
