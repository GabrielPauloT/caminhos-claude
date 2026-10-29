#!/usr/bin/env bash
# Sobe um GNOME Shell sem tela e isolado (D-Bus, dconf e HOME próprios) com o unsafe_mode ligado,
# para o teste clicar de verdade com o ponteiro virtual do Clutter. Fica rodando em primeiro plano.
#   subir-shell.sh <dir curto em /tmp>
# Parar: kill $(cat <dir>/shell.pid)  -- só o gnome-shell.
set -euo pipefail
T=${1:?uso: subir-shell.sh <dir>}
[[ $T == /tmp/?* && $T != *..* ]] || { echo "use um diretório curto em /tmp (socket do Wayland)" >&2; exit 2; }

EXT="$T/home/.local/share/gnome-shell/extensions/test-control@local"
mkdir -p "$EXT" "$T"/{config,cache,state,run,fakebin,alvo}
chmod 700 "$T/run"
cat > "$EXT/metadata.json" <<'EOF'
{"uuid": "test-control@local", "name": "test control", "description": "liga unsafe_mode para Eval nos testes", "shell-version": ["48"]}
EOF
cat > "$EXT/extension.js" <<'EOF'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class TestControl extends Extension {
    enable() { global.context.unsafe_mode = true; }
    disable() {}
}
EOF

# xdg-open falso: só anota o caminho que o mod mandou abrir.
cat > "$T/fakebin/xdg-open" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$T/aberto.log"
EOF
chmod +x "$T/fakebin/xdg-open"
printf '# guia de teste\n' > "$T/alvo/guia.md"

export HOME="$T/home"
export XDG_CONFIG_HOME="$T/config" XDG_CACHE_HOME="$T/cache" XDG_STATE_HOME="$T/state"
export XDG_DATA_HOME="$T/home/.local/share" XDG_RUNTIME_DIR="$T/run"
unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS

exec dbus-run-session -- bash -c '
  echo "$DBUS_SESSION_BUS_ADDRESS" > "'"$T"'/bus"
  echo $$ > "'"$T"'/shell.pid"
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"test-control@local\"]"
  gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"
  gsettings set org.gnome.desktop.interface enable-animations false
  exec gnome-shell --headless --virtual-monitor 1600x1000 --wayland --no-x11
' > "$T/shell.log" 2>&1
