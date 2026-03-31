FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma/
RUN pnpm exec prisma generate

COPY tsconfig.json ./
COPY src ./src/
RUN pnpm run build

EXPOSE 3000
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]
