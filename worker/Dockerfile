# Built from the repository root so it can reuse the api's Prisma schema
# instead of keeping a second copy:
#   docker build -f worker/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY worker/package*.json ./
RUN npm ci
COPY api/prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate
COPY worker/tsconfig.json ./
COPY worker/src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY worker/package*.json ./
RUN npm ci --omit=dev
COPY api/prisma/schema.prisma ./prisma/schema.prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
