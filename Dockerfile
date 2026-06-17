# syntax=docker/dockerfile:1

# --- Build stage: compile the single-page bundle with Vite ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime stage: Node server (static SPA + realtime WebSocket rooms) ---
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src/sim ./src/sim
COPY src/config ./src/config
COPY --from=build /app/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q -O /dev/null http://localhost:3000/ || exit 1
CMD ["node", "server/index.js"]
