#!/bin/sh
set -e

# The files this sorts belong to a user on the host, and a container writing as
# root would leave a library the user cannot manage. PUID and PGID let the
# runtime user match theirs, which is the convention self-hosted images use.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  groupmod -o -g "$PGID" node 2>/dev/null || true
  usermod -o -u "$PUID" node 2>/dev/null || true

  # Only the config directory. The mounted collections are deliberately left
  # alone: recursively changing ownership of a large library would take hours
  # and is not this program's business.
  mkdir -p "${STL_CONFIG_DIR:-/config}"
  chown "$PUID:$PGID" "${STL_CONFIG_DIR:-/config}"

  exec gosu "$PUID:$PGID" "$@"
fi

exec "$@"
