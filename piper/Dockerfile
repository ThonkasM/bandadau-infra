# Servidor de voz local (Piper TTS) para los reportes de insights-service: POST / {text, voice} -> audio/wav.
# Sin servicios públicos: las voces se descargan UNA vez al construir la imagen (Hugging Face) y luego corre offline.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN pip install "piper-tts[http]==1.8.0" \
 && python -m piper.download_voices --download-dir /voices es_MX-claude-high en_US-lessac-medium
EXPOSE 5002
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:5002/info', timeout=4)"
CMD ["python", "-m", "piper.http_server", "-m", "es_MX-claude-high", "--data-dir", "/voices", "--host", "0.0.0.0", "--port", "5002"]
