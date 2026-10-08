FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/var/lib/ai402/uploads

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate \
    && mkdir -p /var/lib/ai402/uploads && chown -R node:node /var/lib/ai402

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node . .

USER node
RUN pnpm install --frozen-lockfile && pnpm build

EXPOSE 3000
CMD ["pnpm", "start"]
