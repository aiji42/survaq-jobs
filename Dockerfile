FROM node:18.2-bullseye-slim as base

ENV TZ=Asia/Tokyo

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

COPY --from=builder /app/packages/$BUILD_CONTEXT/build build

USER node

ENV NODE_ENV=production

CMD ["node", "build/index.js"]