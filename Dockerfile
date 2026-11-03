# hi
# GridNova: the website and the FastAPI backend in one container.
# Railway (or any Docker host) builds this file and runs it on $PORT.

# 1) Build the website, pointed at the backend on the same site.
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_URL=/
RUN npm run build

# 2) Run the backend, which also serves the built website.
FROM python:3.12-slim
WORKDIR /app/backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 GRIDNOVA_DIST=/app/dist
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /app/dist /app/dist
EXPOSE 8080
CMD ["sh", "-c", "uvicorn gridnova.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
