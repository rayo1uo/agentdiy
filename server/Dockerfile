FROM golang:1.23-alpine AS builder

ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}

WORKDIR /src

COPY go.mod go.sum ./
RUN set -eux; \
  n=0; \
  until [ "$n" -ge 5 ]; do \
    go mod download && break; \
    n=$((n + 1)); \
    echo "go mod download failed, retry ${n}/5 in 3s..."; \
    sleep 3; \
  done; \
  [ "$n" -lt 5 ]

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/api ./cmd/api \
  && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/migrate ./cmd/migrate

FROM alpine:3.20

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /out/api /app/api
COPY --from=builder /out/migrate /app/migrate
COPY migrations /app/migrations
COPY docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/api /app/migrate /app/entrypoint.sh

USER app

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
