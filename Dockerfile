# syntax=docker/dockerfile:1

# --- Build stage: compile the single-page bundle with Vite ---
FROM node:24-alpine AS build
WORKDIR /app
# .git is excluded from the build context (.dockerignore), so the on-screen build
# stamp can't be derived from git here. Pass these from the host so the deployed
# build shows the real version/commit. Build with, e.g.:
#   docker build \
#     --build-arg BUILD_TAG="$(git describe --tags --always)" \
#     --build-arg BUILD_SHA="$(git rev-parse --short HEAD)" .
ARG BUILD_TAG=""
ARG BUILD_SHA=""
ENV BUILD_TAG=$BUILD_TAG
ENV BUILD_SHA=$BUILD_SHA
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
