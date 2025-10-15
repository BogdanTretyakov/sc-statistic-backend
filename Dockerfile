# Stage: builder
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22 --activate

COPY . ./

RUN yarn install --frozen-lockfile
RUN yarn prisma generate
RUN yarn build

# Stage: runtime
FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare yarn@1.22 --activate

ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock

COPY views ./views
COPY prisma ./prisma
COPY start.sh ./start.sh

RUN chmod +x start.sh

EXPOSE 4000

# Стартуем с миграциями
CMD ["./start.sh"]
