FROM node:lts-alpine
WORKDIR /app
COPY src/ /app/src/
COPY package.json entrypoint.sh /app/
ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80
CMD ["sh", "/app/entrypoint.sh"]