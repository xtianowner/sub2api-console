# 零原生依赖(node:sqlite 内置)：构建快。npm install(非 ci)：跨平台生成的 lock 缺 musl 可选依赖(rollup/@emnapi)，install 按本平台解析。
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build && npm run server:build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssh-client
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
EXPOSE 21013
CMD ["npm", "start"]
