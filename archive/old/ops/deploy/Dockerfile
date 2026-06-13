# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/ops/server/proxy-server.mjs ./ops/server/proxy-server.mjs
EXPOSE 3000
CMD ["node", "ops/server/proxy-server.mjs"]
