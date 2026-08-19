# Build everything the server needs, then carry only the result forward.
FROM node:22-slim AS build
WORKDIR /app

# Manifests first, so a change to source does not reinstall dependencies.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace @stl-manager/server --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/server/ apps/server/

RUN npm run build --workspace @stl-manager/contracts \
 && npm run build --workspace @stl-manager/core \
 && npm run build --workspace @stl-manager/server

# Drop everything that was only needed to build.
RUN npm prune --omit=dev --workspace @stl-manager/server --include-workspace-root

FROM node:22-slim AS runtime
WORKDIR /app

# gosu drops privileges cleanly once the entrypoint has fixed ownership.
# The base image already provides a "node" user at uid 1000, which the
# entrypoint renumbers to match the host user.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    STL_CONFIG_DIR=/config \
    # A container that answered only its own loopback would be unreachable
    # from the host, so the image asks for the network by default. Going
    # further, to remote, is still a deliberate choice in compose.
    STL_ACCESS=lan

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/dist-web ./apps/server/dist-web
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY apps/server/docker-entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/config"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "apps/server/dist/main.js"]
