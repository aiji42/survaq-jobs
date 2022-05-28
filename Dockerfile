ARG NODE_VERSION=16.15

FROM node:$NODE_VERISON-bullseye-slim as base

FROM base as builder
ARG BUILD_CONTEXT

WORKDIR /app

COPY package.json .
COPY yarn.lock .
COPY ./packages/$BUILD_CONTEXT/package.json $BUILD_CONTEXT/
RUN yarn install --production --frozen-lockfile

COPY ./packages/$BUILD_CONTEXT $BUILD_CONTEXT
RUN yarn build:$BUILD_CONTEXT

#job
FROM base
ARG BUILD_CONTEXT

RUN adduser -D worker

COPY --from=builder /app/$BUILD_CONTEXT/build build

USER worker

CMD ["node", "build/index.js"]