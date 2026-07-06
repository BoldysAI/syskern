#!/bin/sh
# Fix ownership of bind-mounted volumes so the non-root `app` user can write.
#
# Coolify mounts host volumes (e.g. `/data/syskern/media`) root-owned; the mount
# shadows the container directory's permissions, so the non-root `app` user
# (UID 1000) can no longer write there — document uploads fail with
# "Échec de l'upload" and exports never persist. This runs as root at container
# start, chowns the writable paths to `app`, then drops privileges via gosu.
#
# Idempotent and harmless when a path is a plain container dir (not a volume).
set -e

for dir in "${DJANGO_MEDIA_ROOT:-/tmp/syskern_media}" /tmp/syskern_exports; do
    mkdir -p "$dir" 2>/dev/null || true
    chown -R app:app "$dir" 2>/dev/null || true
done

# Drop from root to the non-root runtime user for the actual process.
exec gosu app "$@"
