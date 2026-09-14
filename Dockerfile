FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=3000
ENV SCREEN_SHARE_DATA_FILE=/app/data/users.json

USER node
EXPOSE 3000
CMD ["node", "server.js"]
