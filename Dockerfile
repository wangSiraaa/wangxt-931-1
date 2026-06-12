FROM node:18-alpine

WORKDIR /app

ENV DOCKER_ENV=true

COPY backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY backend/ ./
COPY frontend/ ../frontend

RUN mkdir -p /app/data /app/uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000

CMD ["node", "server.js"]
