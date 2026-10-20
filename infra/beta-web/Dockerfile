FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY server.js login.js ./
COPY game/ ./game/
EXPOSE 8080
USER node
CMD ["node", "server.js"]
