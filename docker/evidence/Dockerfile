FROM python:3.12.8-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY prepare_evidence.py prefilter_gps.py partition_gps.py merge_evidence.py evidence_service.py /app/
COPY build_tiles.sh /app/
CMD ["python", "/app/evidence_service.py"]
