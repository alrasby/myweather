FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000 GEOCODER_DATA_DIR=/data
WORKDIR /app
LABEL org.opencontainers.image.title="MyWeather Global City Search"
COPY server.py ./server.py
EXPOSE 8000
CMD ["python","/app/server.py"]
