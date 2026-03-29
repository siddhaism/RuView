#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-ruvnet/wifi-densepose:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-ruview-pi}"
HTTP_PORT="${HTTP_PORT:-3000}"
WS_PORT="${WS_PORT:-3001}"
UDP_PORT="${UDP_PORT:-5005}"
CSI_SOURCE="${CSI_SOURCE:-esp32}"
RESTART_POLICY="${RESTART_POLICY:-unless-stopped}"
SENSING_BIND_ADDR="${SENSING_BIND_ADDR:-0.0.0.0}"

usage() {
  cat <<EOF
Run RuView on a Raspberry Pi for two already-flashed ESP32 boards.

Usage:
  $(basename "$0") [start|stop|restart|logs|status]

Environment overrides:
  IMAGE=ruvnet/wifi-densepose:latest
  CONTAINER_NAME=ruview-pi
  HTTP_PORT=3000
  WS_PORT=3001
  UDP_PORT=5005
  CSI_SOURCE=esp32
  RESTART_POLICY=unless-stopped
  SENSING_BIND_ADDR=0.0.0.0

Examples:
  $(basename "$0") start
  HTTP_PORT=8080 $(basename "$0") start
  $(basename "$0") logs
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

detect_ip() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"
}

container_running() {
  docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"
}

start_container() {
  require_cmd docker

  if container_exists; then
    echo "Removing existing container '$CONTAINER_NAME' so ports and env stay in sync..."
    if container_running; then
      docker stop "$CONTAINER_NAME" >/dev/null
    fi
    docker rm "$CONTAINER_NAME" >/dev/null
  fi

  echo "Pulling image: $IMAGE"
  docker pull "$IMAGE"

  echo "Starting container '$CONTAINER_NAME'..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    --restart "$RESTART_POLICY" \
    -p "${HTTP_PORT}:3000" \
    -p "${WS_PORT}:3001" \
    -p "${UDP_PORT}:5005/udp" \
    -e "CSI_SOURCE=${CSI_SOURCE}" \
    -e "SENSING_BIND_ADDR=${SENSING_BIND_ADDR}" \
    -e "RUST_LOG=info" \
    "$IMAGE" >/dev/null

  print_status
}

stop_container() {
  require_cmd docker

  if container_running; then
    docker stop "$CONTAINER_NAME"
  else
    echo "Container '$CONTAINER_NAME' is not running."
  fi
}

show_logs() {
  require_cmd docker
  docker logs -f "$CONTAINER_NAME"
}

print_status() {
  require_cmd docker

  local pi_ip
  pi_ip="$(detect_ip || true)"

  echo
  echo "Container: $CONTAINER_NAME"
  docker ps --filter "name=^${CONTAINER_NAME}$"
  echo
  echo "Expected ESP32 setup:"
  echo "  Node 1 -> Pi UDP ${UDP_PORT}"
  echo "  Node 2 -> Pi UDP ${UDP_PORT}"
  echo
  echo "Endpoints:"
  if [[ -n "${pi_ip:-}" ]]; then
    echo "  UI:         http://${pi_ip}:${HTTP_PORT}"
    echo "  Health:     http://${pi_ip}:${HTTP_PORT}/health"
    echo "  WebSocket:  ws://${pi_ip}:${HTTP_PORT}/ws/sensing"
    echo "  Alt WS:     ws://${pi_ip}:${WS_PORT}/ws/sensing"
  else
    echo "  UI:         http://<pi-ip>:${HTTP_PORT}"
    echo "  Health:     http://<pi-ip>:${HTTP_PORT}/health"
    echo "  WebSocket:  ws://<pi-ip>:${HTTP_PORT}/ws/sensing"
    echo "  Alt WS:     ws://<pi-ip>:${WS_PORT}/ws/sensing"
  fi
  echo
  echo "Useful commands:"
  echo "  $(basename "$0") logs"
  echo "  curl http://localhost:${HTTP_PORT}/health"
}

ACTION="${1:-start}"

case "$ACTION" in
  start)
    start_container
    ;;
  stop)
    stop_container
    ;;
  restart)
    stop_container || true
    start_container
    ;;
  logs)
    show_logs
    ;;
  status)
    print_status
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage
    exit 1
    ;;
esac
