#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Re-creates the build toolchain (JDK 17 + Android build-tools 34 + platform 34)
# in <workspace>/.cache/androidtool — a directory excluded from workspace
# snapshots, so this script is the reproducible way to restore it.
#
# Everything is user-space: no root, no package manager, no Gradle.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="$(dirname "$(dirname "$HERE")")"          # the workspace root
TOOL="${TOOLCHAIN:-$WS/.cache/androidtool}"
JDK_URL="${JDK_URL:-https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_linux_hotspot_17.0.13_11.tar.gz}"
CMDLINE_URL="${CMDLINE_URL:-https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip}"

mkdir -p "$TOOL/dl" "$TOOL/jdk" "$TOOL/sdk"
echo "toolchain root: $TOOL"

fetch() {  # fetch <url> <dest>
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then echo "  cached $(basename "$dest")"; return 0; fi
  echo "  downloading $(basename "$dest") …"
  python3 - "$url" "$dest" <<'PY'
import sys, urllib.request, socket
socket.setdefaulttimeout(120)
url, dest = sys.argv[1], sys.argv[2]
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req) as r, open(dest + ".part", "wb") as f:
    while True:
        b = r.read(1 << 20)
        if not b:
            break
        f.write(b)
import os
os.replace(dest + ".part", dest)
print("    %.1f MB" % (os.path.getsize(dest) / 1e6))
PY
}

if [ ! -x "$TOOL/jdk/bin/javac" ]; then
  fetch "$JDK_URL" "$TOOL/dl/jdk17.tar.gz"
  tar -xzf "$TOOL/dl/jdk17.tar.gz" -C "$TOOL/jdk" --strip-components=1
fi
echo "  jdk: $("$TOOL/jdk/bin/javac" -version 2>&1)"

if [ ! -x "$TOOL/sdk/cmdline-tools/bin/sdkmanager" ]; then
  fetch "$CMDLINE_URL" "$TOOL/dl/cmdline-tools.zip"
  rm -rf "$TOOL/sdk/_tmp"
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
      "$TOOL/dl/cmdline-tools.zip" "$TOOL/sdk/_tmp"
  mv "$TOOL/sdk/_tmp/cmdline-tools" "$TOOL/sdk/cmdline-tools"
  rm -rf "$TOOL/sdk/_tmp"
  chmod -R +x "$TOOL/sdk/cmdline-tools/bin"
fi

export JAVA_HOME="$TOOL/jdk"
export PATH="$JAVA_HOME/bin:$PATH"
export _JAVA_OPTIONS="-Xmx600m"          # keep sdkmanager inside a 1 GiB container

if [ ! -d "$TOOL/sdk/build-tools/34.0.0" ] || [ ! -f "$TOOL/sdk/platforms/android-34/android.jar" ]; then
  yes | "$TOOL/sdk/cmdline-tools/bin/sdkmanager" --sdk_root="$TOOL/sdk" --licenses > /dev/null 2>&1 || true
  "$TOOL/sdk/cmdline-tools/bin/sdkmanager" --sdk_root="$TOOL/sdk" \
      "platform-tools" "platforms;android-34" "build-tools;34.0.0" 2>&1 | tail -2
fi

echo "  aapt2:    $("$TOOL/sdk/build-tools/34.0.0/aapt2" version 2>&1 | head -1)"
echo "  platform: $(ls "$TOOL/sdk/platforms")"
echo "✔ toolchain ready — now run tools/build-apk.sh"
