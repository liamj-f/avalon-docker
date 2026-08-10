FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY migrations ./migrations

ENV PYTHONUNBUFFERED=1
ENV PORT=4000
EXPOSE 4000

WORKDIR /app/src
CMD ["python", "main.py"]
