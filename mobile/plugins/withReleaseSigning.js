// Expo config plugin: release builds signed with Mooner's own upload key, only when the
// Gradle property MOONER_RELEASE_SIGN is 1; otherwise with the debug key as before.
// android/ is generated (expo prebuild --clean deletes it), so the key and its passwords live
// outside the repo, in Gradle properties, usually ~/.gradle/gradle.properties
// (reactnative.dev/docs/signed-apk-android):
//   MOONER_UPLOAD_STORE_FILE=/absolute/path/to/mooner-upload.keystore
//   MOONER_UPLOAD_STORE_PASSWORD=...
//   MOONER_UPLOAD_KEY_ALIAS=mooner-upload
//   MOONER_UPLOAD_KEY_PASSWORD=...
// Where the flag is set is the user's choice (the share-links plan, USER STEP B):
// MOONER_RELEASE_SIGN=1 in that file signs every release build on the machine; passed for one
// build (`./gradlew … -PMOONER_RELEASE_SIGN=1`, or
// `ORG_GRADLE_PROJECT_MOONER_RELEASE_SIGN=1 sh scripts/run-android.sh`), only that build.
// Gradle stops, and never falls back to the debug key quietly, when:
// - the flag is set to anything but 1 or 0 (a space after the 1, `true`). Checked outside the
//   flag's `if`, so it doesn't wait for a release build; an absent flag passes;
// - the flag is 1 and any MOONER_UPLOAD_* property is missing. All four are read before any is
//   set, and the error names only the missing ones: Gradle's error for an unknown property
//   prints the whole SigningConfig, passwords included.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// mooner: release signing";
const SIGN = "project.findProperty('MOONER_RELEASE_SIGN') == '1'";
const KEY = ["MOONER_UPLOAD_STORE_FILE", "MOONER_UPLOAD_STORE_PASSWORD", "MOONER_UPLOAD_KEY_ALIAS", "MOONER_UPLOAD_KEY_PASSWORD"];

// An error's text never holds a value, only property names.
const RELEASE_CONFIG = `        release {
            ${MARK}
            def flag = project.findProperty('MOONER_RELEASE_SIGN')
            if (flag != null && !(flag in ['1', '0'])) throw new GradleException("MOONER_RELEASE_SIGN must be 1 or 0, and it is set to something else (a space after the 1 counts)")
            if (${SIGN}) {
                def key = [${KEY.map((k) => `'${k}'`).join(", ")}].collectEntries { [it, project.findProperty(it)] }
                def missing = key.findAll { !it.value }.keySet()
                if (missing) throw new GradleException("MOONER_RELEASE_SIGN is 1 but these Gradle properties aren't set: \${missing.join(', ')}")
                storeFile file(key.MOONER_UPLOAD_STORE_FILE)
                storePassword key.MOONER_UPLOAD_STORE_PASSWORD
                keyAlias key.MOONER_UPLOAD_KEY_ALIAS
                keyPassword key.MOONER_UPLOAD_KEY_PASSWORD
            }
        }
`;

const SIGNING_CONFIGS = /\n[ \t]*signingConfigs \{\n/;
// the release build type's signingConfig line, after the template's comments
const RELEASE_LINE = /(release \{\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*)signingConfig signingConfigs\.debug/;

/** The text inside signingConfigs { … }, or null when there is none or its braces don't close. */
function signingConfigsBody(src) {
  const m = SIGNING_CONFIGS.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i);
  }
  return null;
}

/** app/build.gradle's text with the release signing above. Running it twice changes nothing;
 *  a file that isn't Expo's template throws, rather than build with the wrong key. */
function addReleaseSigning(src) {
  if (src.includes(MARK)) return src;
  const body = signingConfigsBody(src);
  if (body === null || !RELEASE_LINE.test(src)) {
    throw new Error("withReleaseSigning: android/app/build.gradle isn't the template it knows; sign release builds by hand");
  }
  // a release block there already would be merged with this one by Gradle
  if (/^[ \t]*release[ \t]*\{/m.test(body)) {
    throw new Error("withReleaseSigning: android/app/build.gradle isn't the template it knows (signingConfigs already has a release block); sign release builds by hand");
  }
  return src
    .replace(SIGNING_CONFIGS, (m) => m + RELEASE_CONFIG)
    .replace(RELEASE_LINE, `$1signingConfig(${SIGN} ? signingConfigs.release : signingConfigs.debug)`);
}

const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") throw new Error("withReleaseSigning: app/build.gradle must be Groovy");
    c.modResults.contents = addReleaseSigning(c.modResults.contents);
    return c;
  });

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
