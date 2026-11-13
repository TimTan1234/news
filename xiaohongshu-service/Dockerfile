# xiaohongshu-mcp with two changes it has not released: signing in from outside mainland China
# (its pull request #906) and a choice of site, so that RedNote accounts work. Only the service
# binary differs from the published image.
FROM golang:1.27.3 AS build
ARG VERSION=v2.7.4
RUN git clone --depth 1 --branch ${VERSION} https://github.com/xpzouying/xiaohongshu-mcp.git /src
WORKDIR /src
COPY *.patch /patches/
RUN git apply /patches/sign-in-outside-mainland.patch && git apply /patches/site-host.patch
RUN CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=${VERSION}-pulse" -o /out/app .

FROM xpzouying/xiaohongshu-mcp:v2.7.4
COPY --from=build /out/app /app/app
