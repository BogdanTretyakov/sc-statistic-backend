FROM node:22-alpine

WORKDIR /app

RUN touch docker-entrypoint.sh && chmod +x docker-entrypoint.sh
RUN corepack enable && corepack prepare yarn@1.22 --activate
RUN yarn config set cache-folder /mnt/yarn-cache

ENTRYPOINT ["/docker-entrypoint.sh"]