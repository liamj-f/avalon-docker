FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# A template, not a static file: the base image's own entrypoint
# (/docker-entrypoint.d/20-envsubst-on-templates.sh) runs envsubst over
# every /etc/nginx/templates/*.template into /etc/nginx/conf.d/ before
# nginx starts, substituting ${BACKEND_HOST}/${BACKEND_PORT} below. This
# decouples the backend's actual Compose service/container name from what
# this image proxies to -- override them in docker-compose.yml if you
# rename the backend service/container away from the defaults here.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV BACKEND_HOST=backend
ENV BACKEND_PORT=4000
# Restricts envsubst to variables we actually intend to substitute, so it
# can never touch nginx's own $host/$remote_addr/$http_upgrade/etc. even if
# an unrelated env var happened to share a name with one of them.
ENV NGINX_ENVSUBST_FILTER=^BACKEND_
EXPOSE 80
