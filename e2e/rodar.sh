#!/usr/bin/env bash
# Teste de ponta a ponta com clique de verdade (ver teste.py): sobe o GNOME sem tela, roda o teste e
# desmonta tudo. Gasta um turno do Haiku na conta ativa do cswap. Nada aparece na tela.
#   e2e/rodar.sh [pasta de saída]
set -euo pipefail
AQUI=$(cd "$(dirname "$0")" && pwd)
MOD=$(dirname "$AQUI")
SAIDA=${1:-$(mktemp -d)}
T=$(mktemp -d /tmp/cam.XXXXXX)  # caminho curto: o socket do Wayland aceita no máximo 107 caracteres
SESSAO=$(cat /proc/sys/kernel/random/uuid)

parar() {
  kill "$(cat "$T/shell.pid" 2>/dev/null)" 2>/dev/null || true
  for _ in $(seq 1 40); do grep -lqzF "$T/" /proc/[0-9]*/environ 2>/dev/null || break; sleep 0.25; done
  rm -rf "$T"
  # A sessão de teste fica gravada como qualquer outra (o teste roda em ~/projetos): vai para a lixeira.
  for f in "$HOME/.claude/projects/-home-gabriel-projetos/$SESSAO.jsonl" "$HOME/.claude/session-env/$SESSAO"; do
    if [ -e "$f" ]; then gio trash "$f"; fi
  done
  echo "saída em $SAIDA"
}
trap parar EXIT

setsid "$AQUI/subir-shell.sh" "$T" >/dev/null 2>&1 < /dev/null &
for _ in $(seq 1 100); do [ -S "$T/run/wayland-0" ] && [ -s "$T/bus" ] && break; sleep 0.1; done
[ -S "$T/run/wayland-0" ] || { echo "o GNOME sem tela não subiu" >&2; exit 1; }
sleep 2
python3 -I "$AQUI/teste.py" "$T" "$MOD" "$SAIDA" "$SESSAO"
