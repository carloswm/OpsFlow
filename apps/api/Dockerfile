FROM node:22-bookworm-slim AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS build
COPY apps/api apps/api
RUN npm run build --workspace @opsflow/api
COPY apps/api/src/db/migrations apps/api/dist/db/migrations

FROM build AS test
COPY apps/web apps/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace @opsflow/api
COPY --from=build --chown=node:node /workspace/apps/api/dist apps/api/dist
COPY apps/api/certs/rds-us-east-1-bundle.pem /opt/opsflow/certs/rds-us-east-1-bundle.pem
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@opsflow/api"]
