FROM node:22-alpine AS builder
WORKDIR /app

# Vite inlines VITE_* env vars at build time, not runtime — the built JS
# bundle has no way to read a container env var later, so this has to be a
# build arg, and the frontend image must be rebuilt whenever the backend's
# public URL changes.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
