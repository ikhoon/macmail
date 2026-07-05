#!/usr/bin/env bash
# make-signing-cert.sh — create a STABLE self-signed code-signing certificate
# once, so macmail's Full Disk Access grant survives every rebuild.
#
# Why: ad-hoc signing (`codesign --sign -`) stamps a fresh cdhash on every build,
# and TCC pins the grant to that cdhash — so each rebuild/reinstall drops the FDA
# grant and you re-toggle it. Signing with a stable cert instead makes the code
# signature's Designated Requirement identifier + certificate based (not cdhash),
# so the grant persists across rebuilds. install.sh uses this identity when
# present and falls back to ad-hoc when it isn't (e.g. CI).
#
# Security: the private key lives ONLY in the login keychain — deliberately no
# file backup. (An on-disk .p12 with a known password would let any user-level
# process copy the key, sign itself as macmail, and inherit the FDA grant.) The
# key's ACL is scoped to /usr/bin/codesign rather than all applications, so any
# other process touching it triggers a keychain prompt. If the key is ever lost
# (keychain reset, new machine), just re-run this script and re-grant FDA once.
#
# Idempotent: if the identity already exists it does nothing (regenerating would
# change the DR and break the grant).
set -e

CERT_NAME="MacmailSign"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
# Throwaway transport password for the in-memory→keychain import only; the .p12
# it protects lives in a mktemp dir deleted on exit and is never kept.
P12_PASS="$(head -c16 /dev/urandom | xxd -p)"

# Idempotency check: a self-signed cert has no trust settings, so it won't show
# under `-v` (valid) — check without -v.
if security find-identity -p codesigning 2>/dev/null | grep -q "$CERT_NAME"; then
  echo "macmail: signing identity '$CERT_NAME' already exists (keeping it — DR stability)"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/ext.cnf" <<'EOF'
[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=MacmailSign
O=macmail (local self-signed)
[v3]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
subjectKeyIdentifier=hash
EOF

echo "macmail: generating a self-signed code-signing certificate (valid 10 years)…"
openssl req -new -x509 -days 3650 -nodes \
  -newkey rsa:2048 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -config "$TMP/ext.cnf" -extensions v3 2>/dev/null

# -legacy for the RC2 PKCS#12 that `security import` expects; fall back if the
# OpenSSL build lacks it.
openssl pkcs12 -export -legacy -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/cert.p12" -passout pass:"$P12_PASS" -name "$CERT_NAME" 2>/dev/null \
  || openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
       -out "$TMP/cert.p12" -passout pass:"$P12_PASS" -name "$CERT_NAME" 2>/dev/null

echo "macmail: importing into the login keychain (key usable by codesign only)…"
security import "$TMP/cert.p12" -k "$KEYCHAIN" -P "$P12_PASS" -T /usr/bin/codesign

echo "macmail: done — the key exists only in your keychain (no file backup)."
security find-identity -p codesigning | grep "$CERT_NAME" || true
