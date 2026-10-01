#!/bin/sh
# Builds the release app (its JS is inside the APK, so no Metro server runs) and installs
# it on the phone plugged in over USB (adb devices). It signs with the debug keystore unless
# the Gradle property MOONER_RELEASE_SIGN is 1 (plugins/withReleaseSigning.js); then with
# Mooner's upload key, named by MOONER_UPLOAD_* in ~/.gradle/gradle.properties. Whether this
# script's builds get the flag is the user's choice. `expo run:android` adds only its own
# -P flags to Gradle and has no option to pass yours, so for one build the flag goes in the
# environment (how the flag reaches Gradle):
#   ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh
# A build signed with another key than the installed app's won't install over it. That
# needs `adb uninstall family.mooner.app` first, which deletes the app's data (sign-in,
# session keys), and is the user's to run.
# The Android SDK and JDK 17 are Homebrew's on this Mac.
set -e
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
cd "$(dirname "$0")/.."
exec npx expo run:android --variant release --no-bundler "$@"
