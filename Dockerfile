FROM node:24-alpine

WORKDIR /app

# Install production dependencies first so this layer is cached until package files change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=5050
EXPOSE 5050

USER node
CMD ["node", "server.js"]
