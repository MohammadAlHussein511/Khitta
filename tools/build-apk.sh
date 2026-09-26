#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Khitta — reproducible APK build WITHOUT Gradle.
#
#   aapt2 compile → aapt2 link (+assets, +R.java) → javac → d8 → zip
#   → zipalign → apksigner
#
# Peak RSS stays under ~400 MB, so it runs inside a 1 GiB container.
# Usage:  tools/build-apk.sh            (VERSION_NAME / VERSION_CODE overridable)
# ---------------------------------------------------------------------------
set -euo pipefail

# Every path is derived at runtime: the sandbox maps the workspace onto a private
# physical location, so no absolute workspace path may be hardcoded in here.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="$(dirname "$ROOT")"
TOOL="${TOOLCHAIN:-${ARENA_WORKSPACE:-$WS}/.cache/androidtool}"
[ -d "$TOOL/jdk" ] || TOOL="$WS/.cache/androidtool"
[ -d "$TOOL/jdk" ] || { echo "toolchain missing: run tools/bootstrap-toolchain.sh first" >&2; exit 1; }
JAVA_HOME="${JAVA_HOME:-$TOOL/jdk}"
SDK="${ANDROID_SDK:-$TOOL/sdk}"
BT="$SDK/build-tools/34.0.0"
ANDROID_JAR="$SDK/platforms/android-34/android.jar"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$BT:$PATH"

PKG="com.khitta.tasks"
APP="Khitta"
VERSION_NAME="${VERSION_NAME:-1.0.0}"
VERSION_CODE="${VERSION_CODE:-1}"
MIN_SDK=26
TARGET_SDK=34

BUILD="$ROOT/build"
OUT="$ROOT/release"
KS="$ROOT/tools/khitta.keystore"
KS_ALIAS="khitta"
KS_PASS="${KS_PASS:-khitta.local.only}"
APK="$OUT/$APP-$VERSION_NAME.apk"

for f in "$ANDROID_JAR" "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner"; do
  [ -e "$f" ] || { echo "missing toolchain component: $f" >&2; exit 1; }
done

rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/obj" "$BUILD/dex" "$OUT"
cd "$ROOT"

echo "▸ 1/7  aapt2 compile resources"
"$BT/aapt2" compile --dir "$ROOT/android/res" -o "$BUILD/res.zip"

echo "▸ 2/7  aapt2 link (manifest + assets + R.java)"
"$BT/aapt2" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  -A "$ROOT/android/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  --rename-manifest-package "$PKG" \
  "$BUILD/res.zip"

echo "▸ 3/7  javac (--release 8, android.jar classpath)"
find "$ROOT/android/src" "$BUILD/gen" -name '*.java' | sort > "$BUILD/sources.txt"
wc -l < "$BUILD/sources.txt" | xargs echo "      sources:"
if ! javac --release 8 -encoding UTF-8 -nowarn \
      -classpath "$ANDROID_JAR" -d "$BUILD/obj" \
      @"$BUILD/sources.txt" > "$BUILD/javac.log" 2>&1; then
  echo "--- javac failed ---"; cat "$BUILD/javac.log"; exit 1
fi
[ -s "$BUILD/javac.log" ] && { echo "      javac notes:"; sed 's/^/        /' "$BUILD/javac.log"; } || true

echo "▸ 4/7  d8 (dexing, min-api $MIN_SDK)"
find "$BUILD/obj" -name '*.class' | sort > "$BUILD/classes.txt"
wc -l < "$BUILD/classes.txt" | xargs echo "      classes:"
# shellcheck disable=SC2046
d8 --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" \
   --output "$BUILD/dex" $(cat "$BUILD/classes.txt")
[ -f "$BUILD/dex/classes.dex" ] || { echo "d8 produced no classes.dex" >&2; exit 1; }

echo "▸ 5/7  package"
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
( cd "$BUILD/dex" && zip -q "$BUILD/unsigned.apk" classes.dex )
zipalign -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "▸ 6/7  sign"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -v \
    -keystore "$KS" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Khitta Local, OU=Personal, O=Khitta, L=Local, S=Local, C=US" \
    > "$BUILD/keytool.log" 2>&1
  echo "      generated a local signing key: ${KS#$ROOT/}"
fi
apksigner sign \
  --ks "$KS" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$APK" "$BUILD/aligned.apk"

echo "▸ 7/7  verify"
apksigner verify --verbose --print-certs "$APK" | sed 's/^/      /'
echo
"$BT/aapt2" dump badging "$APK" \
  | grep -E "^(package|sdkVersion|targetSdkVersion|application-label|launchable-activity|uses-permission|locales|densities)" \
  | sed 's/^/      /'
echo
SIZE=$(stat -c%s "$APK")
echo "✔  ${APK#$ROOT/}   $(( SIZE / 1024 )) KiB   sha256=$(sha256sum "$APK" | cut -c1-16)…"
