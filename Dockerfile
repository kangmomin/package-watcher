# syntax=docker/dockerfile:1

# ---- build: 전체 의존성으로 web 과 server 를 빌드한다
FROM node:24-slim AS build
WORKDIR /app
# better-sqlite3 는 이 플랫폼의 prebuilt 바이너리가 없으면 소스에서 빌드한다. 빌드 도구는 이 stage 에만 둔다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# ---- prod-deps: server 의 운영 의존성만 설치한다 (@pw/shared 는 번들에 들어 있다)
FROM node:24-slim AS prod-deps
WORKDIR /app
# better-sqlite3 는 이 플랫폼의 prebuilt 바이너리가 없으면 소스에서 빌드한다. 빌드 도구는 이 stage 에만 둔다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w @pw/server

# ---- runtime
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/web/dist
WORKDIR /app
# npm 은 버전이 충돌하는 의존성을 workspace 안(server/node_modules)에 둔다.
# 그래서 루트 node_modules 만이 아니라 prod-deps 의 /app 전체를 가져온다.
COPY --from=prod-deps /app ./
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# named volume 은 첫 마운트 때 이 소유권을 이어받는다. root 가 아닌 사용자로 DB 를 쓴다.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server/dist/index.js"]
