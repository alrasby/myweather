# Source-only image: NO model grids and NO client tokens.
# The pinned, SHA-256-verified modified EOT20 atlas is downloaded to a
# Railway volume only when the operator explicitly enables the service.
FROM python:3.12.9-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/opt/myweather/project

RUN apt-get update && apt-get install -y --no-install-recommends gosu ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 10001 tides && \
    useradd --system --uid 10001 --gid 10001 tides

WORKDIR /opt/myweather/project
COPY project/tide_service/requirements-tide.txt /tmp/requirements-tide.txt
RUN python -m pip install --only-binary=:all: -r /tmp/requirements-tide.txt && \
    python -c "import pyfes, netCDF4, yaml; assert hasattr(pyfes, 'evaluate_tide')" && \
    rm /tmp/requirements-tide.txt

COPY project/tide_service /opt/myweather/project/tide_service
RUN mkdir -p /data/eot20 && \
    chown -R tides:tides /data /opt/myweather && \
    chmod 0750 /data/eot20 && \
    chmod +x /opt/myweather/project/tide_service/entrypoint.sh

# Railway mounts persistent volumes as root. The entrypoint briefly owns
# only the data mount directory, then immediately drops to UID 10001 via gosu
# before Python starts. No root app process or recursive file chmod.
USER root
EXPOSE 8080
ENTRYPOINT ["/opt/myweather/project/tide_service/entrypoint.sh"]
