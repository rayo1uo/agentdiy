#!/bin/sh
set -eu

if [ "${STORAGE_BACKEND:-memory}" = "mysql" ]; then
  retries="${MIGRATE_MAX_RETRIES:-30}"
  interval="${MIGRATE_RETRY_INTERVAL_SECONDS:-2}"
  attempt=1

  echo "storage backend: mysql, running migrations before api startup"
  while true; do
    if /app/migrate; then
      echo "migration finished"
      break
    fi

    if [ "$attempt" -ge "$retries" ]; then
      echo "migration failed after ${attempt} attempts"
      exit 1
    fi

    echo "migration attempt ${attempt} failed, retrying in ${interval}s..."
    attempt=$((attempt + 1))
    sleep "$interval"
  done
fi

exec /app/api
