// The config plugin that signs release builds with Mooner's upload key only when the Gradle
// property MOONER_RELEASE_SIGN is 1: what it does to the template's app/build.gradle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const withReleaseSigning = require("../plugins/withReleaseSigning.js");
const { addReleaseSigning } = withReleaseSigning;

// android/app/build.gradle as `expo prebuild` writes it (Expo SDK 55 template), the part
// the plugin changes
const TEMPLATE = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
        }
    }
`;

test("release builds use the upload key only with MOONER_RELEASE_SIGN=1, else the debug key; debug builds don't change", () => {
  const out = addReleaseSigning(`android {\n${TEMPLATE}}\n`);
  assert.match(out, /signingConfigs \{\n {8}release \{\n {12}\/\/ mooner: release signing\n {12}if \(project\.findProperty\('MOONER_RELEASE_SIGN'\) == '1'\) \{\n {16}storeFile file\(MOONER_UPLOAD_STORE_FILE\)\n {16}storePassword MOONER_UPLOAD_STORE_PASSWORD\n {16}keyAlias MOONER_UPLOAD_KEY_ALIAS\n {16}keyPassword MOONER_UPLOAD_KEY_PASSWORD\n {12}\}\n {8}\}\n {8}debug \{/);
  assert.match(out, /\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n {12}signingConfig\(project\.findProperty\('MOONER_RELEASE_SIGN'\) == '1' \? signingConfigs\.release : signingConfigs\.debug\)\n/);
  assert.match(out, /debug \{\n {12}signingConfig signingConfigs\.debug\n {8}\}/, "the debug build type keeps the debug key");
  assert.equal(out.match(/signingConfigs\.release/g).length, 1);
  assert.doesNotMatch(out, /hasProperty\('MOONER_UPLOAD/, "having the key isn't enough: only the flag switches");
});

test("twice changes nothing; a file it doesn't know stops the build", () => {
  const once = addReleaseSigning(`android {\n${TEMPLATE}}\n`);
  assert.equal(addReleaseSigning(once), once);
  assert.throws(() => addReleaseSigning("android {\n}\n"), /isn't the template/);
});

test("it's a config plugin: a function Expo can load", () => {
  assert.equal(typeof withReleaseSigning, "function");
});
