# recode live browser server
# A real Playwright/Chromium session served over HTTP + WebSocket.
#
#   docker build -t recode-live-browser .
#   docker run -p 8787:8787 recode-live-browser
#
# Works as-is on Fly.io, Render, Railway, Koyeb, Cloud Run and any VPS.
FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy

ENV PYTHONUNBUFFERED=1 \
    PORT=8787 \
    LB_TRACE_DIR=/data/traces

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY live_browser.py .
COPY trace_view.py .

RUN mkdir -p /data/traces
VOLUME ["/data"]

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/health',timeout=4).status==200 else 1)"

CMD ["python3", "live_browser.py", "--host", "0.0.0.0", "--port", "8787"]
