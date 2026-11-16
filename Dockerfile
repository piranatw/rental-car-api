FROM node:24-alpine

WORKDIR /app

# Install production dependencies first so this layer is cached until package files change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy only what the server needs at runtime, not the whole build context.
COPY server.js openapi.yaml ./
COPY config ./config
COPY controllers ./controllers
COPY middleware ./middleware
COPY models ./models
COPY routes ./routes
COPY utils ./utils

ENV NODE_ENV=production
ENV PORT=5050
EXPOSE 5050

USER node
CMD ["node", "server.js"]
