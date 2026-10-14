# syntax=docker/dockerfile:1
FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod ./
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /p5converter .

# Ubuntu 24.04 ships ffmpeg 6.1 with x264/x265/SVT-AV1, VAAPI, QSV (libvpl) and NVENC (dynamic).
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates pciutils util-linux \
      intel-media-va-driver-non-free libvpl2 libmfx-gen1.2 mesa-va-drivers vainfo \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /p5converter /usr/local/bin/p5converter
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV P5_LISTEN=0.0.0.0:8484 \
    P5_ROOTS=/media,/output \
    P5_NO_BROWSER=1 \
    PUID=99 PGID=100 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
EXPOSE 8484
VOLUME ["/media", "/output"]
ENTRYPOINT ["/entrypoint.sh"]
CMD ["p5converter"]
