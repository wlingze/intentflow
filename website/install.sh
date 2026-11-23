#!/bin/sh
# Install the latest official Linux/macOS release. Only the final copy may need sudo.
set -eu

fail() { printf 'intentflow: %s\n' "$*" >&2; exit 1; }
fetch() { curl -fsSL --proto '=https' --proto-redir '=https' --retry 2 -o "$2" "$1"; }

main() {
    case $(uname -s) in
        Darwin) os=darwin ;;
        Linux) os=linux ;;
        *) fail 'Unsupported OS (expected Linux or macOS)' ;;
    esac
    case $(uname -m) in
        x86_64|amd64) arch=amd64 ;;
        arm64|aarch64) arch=arm64 ;;
        *) fail 'Unsupported architecture (expected amd64 or arm64)' ;;
    esac
    # A shell running under Rosetta reports x86_64 on Apple Silicon.
    if [ "$os" = darwin ] && [ "$(sysctl -in sysctl.proc_translated)" = 1 ]; then arch=arm64; fi

    bin=${INTENTFLOW_INSTALL_DIR:-/usr/local/bin}
    case $bin in /*) ;; *) fail 'INTENTFLOW_INSTALL_DIR must be an absolute directory' ;; esac
    dest=$bin/intentflow
    [ ! -d "$dest" ] || fail "Destination is a directory: $dest"
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/intentflow.XXXXXXXX")
    trap 'for f in checksums.txt archive intentflow; do [ ! -f "$tmp/$f" ] || unlink "$tmp/$f"; done; rmdir "$tmp"' 0
    trap 'exit 1' HUP INT TERM

    # Resolve latest once: the manifest names the version as well as the hash.
    releases=https://github.com/wlingze/intentflow/releases
    fetch "$releases/latest/download/checksums.txt" "$tmp/checksums.txt"
    record=$(awk -v target="${os}_${arch}" '
        { sub(/\r$/, "") }
        NF == 2 && $2 ~ ("^intentflow_[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.+-]+)?_" target "\\.tar\\.gz$") {
            if (length($1) != 64 || $1 ~ /[^0-9a-fA-F]/) exit 1
            print tolower($1), $2; count++
        }
        END { if (count != 1) exit 1 }
    ' "$tmp/checksums.txt") || fail "Expected one SHA-256 entry for $os/$arch"
    expected=${record%% *}; asset=${record#* }
    version=${asset#intentflow_}; version=${version%%_*}
    printf 'Latest: v%s\nDownloading: %s\n' "$version" "$asset"
    fetch "$releases/download/v$version/$asset" "$tmp/archive"
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum < "$tmp/archive")
    else
        actual=$(shasum -a 256 < "$tmp/archive")
    fi
    [ "${actual%% *}" = "$expected" ] || fail "SHA-256 mismatch: $asset"
    printf 'SHA-256 OK: %s\n' "$expected"

    # Extract only a single root executable, never other paths from the archive.
    member=$(tar -tzf "$tmp/archive" | awk '$0 == "intentflow" || $0 == "./intentflow"')
    case $member in intentflow|./intentflow) ;; *) fail "Expected one intentflow in $asset" ;; esac
    tar -xzOf "$tmp/archive" "$member" > "$tmp/intentflow"
    [ -s "$tmp/intentflow" ] || fail 'Empty executable in release archive'
    if [ "$bin" = /usr/local/bin ] && [ ! -w "$bin" ]; then
        [ -d "$bin" ] || sudo mkdir -p "$bin"
        sudo install -m 755 "$tmp/intentflow" "$dest"
    else
        mkdir -p "$bin"
        install -m 755 "$tmp/intentflow" "$dest"
    fi
    info=$("$dest" --version) || fail "$dest --version failed"
    case $info in "$version "*) ;; *) fail "Expected $version; got: $info" ;; esac
    printf 'Installed: %s\n%s\n' "$dest" "$info"
    if [ "$(command -v intentflow || :)" != "$dest" ]; then
        printf 'To use this copy, put %s first on PATH.\n' "$bin"
    fi
}

main
