#!/bin/sh
# Railway persistent volumes mount root:root even when Docker image uses
# non-root UID. Initialize only the mount directory as root, then drop
# privileges permanently before starting Python / PyFES.
set -eu
umask 027
mkdir -p /data/eot20
chown tides:tides /data/eot20
chmod 0750 /data/eot20
exec gosu tides python -m tide_service.railway_entry
