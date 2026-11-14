# Build context is the repository root; this image contains NO ocean grids.
# Physical atlas is downloaded only from pinned, checksummed EOT20 release
# into a persistent volume on first operator-enabled start.
FROM python:3.12.9-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/opt/myweather/project

WORKDIR /opt/myweather/project
COPY project/tide_service/requirements-tide.txt /tmp/requirements-tide.txt
RUN python -m pip install --only-binary=:all: -r /tmp/requirements-tide.txt && \
    python -c "import pyfes, netCDF4, yaml; assert hasattr(pyfes, 'evaluate_tide')" && \
    rm /tmp/requirements-tide.txt

COPY project/tide_service /opt/myweather/project/tide_service
RUN groupadd --system --gid 10001 tides && \
    useradd --system --uid 10001 --gid 10001 tides && \
    mkdir -p /data/eot20 && chown -R tides:tides /data /opt/myweather

USER 10001:10001
EXPOSE 8080
CMD ["python", "-m", "tide_service.railway_entry"]
