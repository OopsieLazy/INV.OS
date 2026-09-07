# Multi-stage: compile the Go binary, then a tiny runtime image.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -o /invos-server main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /invos-server /app/invos-server
# deploy/ is mounted at runtime (see compose) or COPY it here for a self-contained image
EXPOSE 8137
ENV INVOS_DB=/data/invos.db INVOS_STATIC=/app/deploy
ENTRYPOINT ["/app/invos-server"]
