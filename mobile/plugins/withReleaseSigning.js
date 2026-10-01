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
// With the flag and no MOONER_UPLOAD_* properties Gradle stops: it never falls back to the
// debug key quietly.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// mooner: release signing";
const SIGN = "project.findProperty('MOONER_RELEASE_SIGN') == '1'";

const RELEASE_CONFIG = `        release {
            ${MARK}
            if (${SIGN}) {
                storeFile file(MOONER_UPLOAD_STORE_FILE)
                storePassword MOONER_UPLOAD_STORE_PASSWORD
                keyAlias MOONER_UPLOAD_KEY_ALIAS
                keyPassword MOONER_UPLOAD_KEY_PASSWORD
            }
        }
`;

const SIGNING_CONFIGS = /\n[ \t]*signingConfigs \{\n/;
// the release build type's signingConfig line, after the template's comments
const RELEASE_LINE = /(release \{\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*)signingConfig signingConfigs\.debug/;

/** app/build.gradle's text with the release signing above. Running it twice changes nothing;
 *  a file that isn't Expo's template throws, rather than build with the wrong key. */
function addReleaseSigning(src) {
  if (src.includes(MARK)) return src;
  if (!SIGNING_CONFIGS.test(src) || !RELEASE_LINE.test(src)) {
    throw new Error("withReleaseSigning: android/app/build.gradle isn't the template it knows; sign release builds by hand");
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
