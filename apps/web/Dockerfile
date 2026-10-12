# Se construye desde la RAÍZ del repo (usa el package-lock.json del monorepo):
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.tu-dominio.com .
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/web
COPY apps/web apps/web
RUN npm run build -w apps/web

FROM nginx:1.28-alpine
ARG VITE_API_URL=http://localhost:3000
# La CSP (nginx.conf.template) solo deja que la web hable con este origen.
ENV API_ORIGIN=$VITE_API_URL
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
