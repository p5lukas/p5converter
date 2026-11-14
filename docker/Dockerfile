# syntax=docker/dockerfile:1
# Gebaut wird immer auf dem Rechner des Bauenden (schnell), für die Zielarchitektur per Cross-Kompilierung
FROM --platform=$BUILDPLATFORM golang:1.24 AS build
ARG TARGETOS=linux
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
COPY . .
ARG P5_TAG=
ARG P5_BRANCH=
ARG P5_COMMIT=
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w \
  -X github.com/p5lukas/p5converter/internal/version.Tag=${P5_TAG} \
  -X github.com/p5lukas/p5converter/internal/version.Branch=${P5_BRANCH} \
  -X github.com/p5lukas/p5converter/internal/version.Commit=${P5_COMMIT}" -o /p5converter .

# Ubuntu 24.04 ships ffmpeg 6.1 with x264/x265/SVT-AV1, VAAPI, QSV (libvpl) and NVENC (dynamic).
# Quick Sync needs a runtime that matches the GPU: libmfx1 = Intel Media SDK (Gen 8-11, e.g. Coffee Lake i9-9900),
# libmfx-gen1.2 = oneVPL (Gen 12+). Both are installed; the hardware detection tries several start variants.
FROM ubuntu:24.04
LABEL org.opencontainers.image.source="https://github.com/p5lukas/p5converter" \
      org.opencontainers.image.description="Audio- und Video-Konverter mit Web-Oberfläche (ffmpeg, Intel QSV, NVIDIA NVENC, VAAPI)" \
      org.opencontainers.image.licenses="MIT"
ENV DEBIAN_FRONTEND=noninteractive
ARG TARGETARCH
# Die Intel-Treiber (Quick Sync) gibt es nur für amd64; auf arm64 bleiben CPU und VAAPI (Mesa).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates pciutils util-linux mesa-va-drivers vainfo \
    && if [ "$TARGETARCH" = "amd64" ]; then \
         apt-get install -y --no-install-recommends intel-media-va-driver-non-free libvpl2 libmfx-gen1.2 libmfx1; \
       fi \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /p5converter /usr/local/bin/p5converter
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV P5_LISTEN=0.0.0.0:8787 \
    P5_ROOTS=/media,/audio1,/audio2,/video1,/video2,/video3,/video4,/output \
    P5_CONFIG=/config \
    P5_NO_BROWSER=1 \
    PUID=99 PGID=100 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["p5converter", "-healthcheck"]
VOLUME ["/output", "/config"]
ENTRYPOINT ["/entrypoint.sh"]
CMD ["p5converter"]
