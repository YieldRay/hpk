FROM node:lts-alpine
WORKDIR /app
COPY src/ /app/src/
COPY package.json entrypoint.sh /app/
ENV NODE_ENV=production
EXPOSE 8090
CMD ["sh", "/app/entrypoint.sh"]