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
  // a flag that isn't 1 or 0 stops the build; with the flag, all four key properties are read
  // first and a missing one stops it before any is set (a SigningConfig in Gradle's error text
  // prints its passwords)
  assert.match(out, /signingConfigs \{\n {8}release \{\n {12}\/\/ mooner: release signing\n {12}def flag = project\.findProperty\('MOONER_RELEASE_SIGN'\)\n {12}if \(flag != null && !\(flag in \['1', '0'\]\)\) throw new GradleException\("MOONER_RELEASE_SIGN must be 1 or 0, and it is set to something else \(a space after the 1 counts\)"\)\n {12}if \(project\.findProperty\('MOONER_RELEASE_SIGN'\) == '1'\) \{\n {16}def key = \['MOONER_UPLOAD_STORE_FILE', 'MOONER_UPLOAD_STORE_PASSWORD', 'MOONER_UPLOAD_KEY_ALIAS', 'MOONER_UPLOAD_KEY_PASSWORD'\]\.collectEntries \{ \[it, project\.findProperty\(it\)\] \}\n {16}def missing = key\.findAll \{ !it\.value \}\.keySet\(\)\n {16}if \(missing\) throw new GradleException\("MOONER_RELEASE_SIGN is 1 but these Gradle properties aren't set: \$\{missing\.join\(', '\)\}"\)\n {16}storeFile file\(key\.MOONER_UPLOAD_STORE_FILE\)\n {16}storePassword key\.MOONER_UPLOAD_STORE_PASSWORD\n {16}keyAlias key\.MOONER_UPLOAD_KEY_ALIAS\n {16}keyPassword key\.MOONER_UPLOAD_KEY_PASSWORD\n {12}\}\n {8}\}\n {8}debug \{/);
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

test("its errors name properties, never a value", () => {
  const out = addReleaseSigning(`android {\n${TEMPLATE}}\n`);
  const errors = out.split("\n").filter((l) => l.includes("GradleException"));
  assert.equal(errors.length, 2);
  // the one thing put into an error's text is the missing properties' names
  assert.deepEqual(errors.flatMap((l) => l.match(/\$\{[^}]*\}/g) ?? []), ["${missing.join(', ')}"]);
  assert.match(out, /def missing = key\.findAll \{ !it\.value \}\.keySet\(\)/);
  assert.doesNotMatch(errors.join("\n"), /"\s*\+|\+\s*"/, "no value joined on with +");
});

test("a signingConfigs that already has a release block stops the build, unless it's this plugin's own", () => {
  const theirs = "        release {\n            storeFile file('their.keystore')\n        }\n";
  const before = TEMPLATE.replace("    signingConfigs {\n", `    signingConfigs {\n${theirs}`);
  const after = TEMPLATE.replace("            keyPassword 'android'\n        }\n", `            keyPassword 'android'\n        }\n${theirs}`);
  for (const t of [before, after]) {
    assert.notEqual(t, TEMPLATE);
    assert.throws(() => addReleaseSigning(`android {\n${t}}\n`), /isn't the template it knows \(signingConfigs already has a release block\)/);
  }
  const once = addReleaseSigning(`android {\n${TEMPLATE}}\n`);
  assert.equal(addReleaseSigning(once), once, "its own marked block is left as it is");
});

test("it's a config plugin: a function Expo can load", () => {
  assert.equal(typeof withReleaseSigning, "function");
});

// The plugin as Expo runs it: the appBuildGradle mod withAppBuildGradle registers. The mod
// reads no modRequest field (@expo/config-plugins build/plugins/withMod.js adds nextMod
// itself), so an empty one is enough.
const runMod = (language, contents) =>
  withReleaseSigning({ name: "x", slug: "x" }).mods.android.appBuildGradle({ modResults: { language, contents }, modRequest: {} });

test("as a config plugin it changes a Groovy app/build.gradle", async () => {
  const src = `android {\n${TEMPLATE}}\n`;
  const res = await runMod("groovy", src);
  assert.notEqual(res.modResults.contents, src);
  assert.equal(res.modResults.contents, addReleaseSigning(src));
});

test("as a config plugin it stops on a Kotlin app/build.gradle.kts", async () => {
  // Expo's getLanguage gives "kt" for .gradle.kts; "kts" stands for anything else not Groovy
  for (const language of ["kt", "kts"]) {
    await assert.rejects(runMod(language, `android {\n${TEMPLATE}}\n`), /must be Groovy/);
  }
});
