# syntax=docker/dockerfile:1
#
# Build context is the repository root: the Expo client imports the shared
# domain, routing, and scoring code from ../../src, and Metro resolves hoisted
# packages from the workspace root's node_modules as well as its own.

FROM node:22.12.0-bookworm-slim AS build
ENV CI=1
# The Expo dependency tree is large enough that a single dropped connection
# fails the whole build; npm gives up after two retries by default.
ENV npm_config_fetch_retries=6 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=600000
WORKDIR /repo

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY apps/openlooper-native/package.json apps/openlooper-native/package-lock.json ./apps/openlooper-native/
RUN npm --prefix apps/openlooper-native ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY apps/openlooper-native ./apps/openlooper-native

# No EXPO_PUBLIC_VALHALLA_URL or EXPO_PUBLIC_EVIDENCE_URL: leaving them unset is
# what makes the web build call the same-origin /api/valhalla and /api/evidence
# paths this image's nginx serves. Setting them would bake an absolute
# cross-origin URL into the bundle, which the services cannot answer.
RUN npm --prefix apps/openlooper-native run export:web

FROM nginx:1.27.3-alpine
# Non-privileged port so the container needs no added capabilities.
ENV VALHALLA_UPSTREAM=openlooper-valhalla:8002 \
    EVIDENCE_UPSTREAM=openlooper-evidence:8003 \
    DNS_RESOLVER=10.43.0.10
COPY docker/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/web/proxy.conf /etc/nginx/openlooper-proxy.conf
COPY --from=build /repo/apps/openlooper-native/dist /usr/share/nginx/html
EXPOSE 8080
