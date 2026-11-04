# Build web (Vite) rồi phục vụ bằng nginx. Image không chứa cấu hình Firebase:
# container sinh /env-config.js từ .env mỗi lần khởi động.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund -w apps/web -w packages/engine --include-workspace-root=false
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN cd apps/web && npx vite build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/web/40-xq-runtime-env.sh /docker-entrypoint.d/40-xq-runtime-env.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-xq-runtime-env.sh && chmod +x /docker-entrypoint.d/40-xq-runtime-env.sh
EXPOSE 80
