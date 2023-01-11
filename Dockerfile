FROM node:18.13-bullseye-slim as base

ENV TZ=Asia/Tokyo

FROM base as app
ARG BUILD_CONTEXT

WORKDIR /app

COPY package.json .
COPY yarn.lock .
COPY ./packages/$BUILD_CONTEXT/ packages/$BUILD_CONTEXT/

RUN yarn install --frozen-lockfile

ENV NODE_ENV=production
ENV BUILD_CONTEXT $BUILD_CONTEXT

CMD ["sh", "-c", "yarn workspace $BUILD_CONTEXT run start"]