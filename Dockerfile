FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries; skipping install scripts keeps npm from
# recompiling it, which would need Python and a C++ toolchain in this image.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Owned by the runtime user, so the app can read them whatever permissions the host checkout has.
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node server ./server
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
VOLUME /app/data
CMD ["node_modules/.bin/tsx", "server/index.ts"]
