FROM node:16.15-bullseye-slim as base

FROM base as builder
ARG BUILD_CONTEXT

WORKDIR /app

COPY package.json .
COPY yarn.lock .
COPY ./packages/$BUILD_CONTEXT/package.json packages/$BUILD_CONTEXT/
RUN yarn install --frozen-lockfile

COPY ./packages/$BUILD_CONTEXT packages/$BUILD_CONTEXT
RUN yarn build:$BUILD_CONTEXT

#job
FROM base
ARG BUILD_CONTEXT

RUN adduser worker

COPY --from=builder /app/packages/$BUILD_CONTEXT/build build

USER worker

CMD ["node", "build/index.js"]