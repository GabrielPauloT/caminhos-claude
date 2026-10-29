#!/usr/bin/env python3
"""Teste de ponta a ponta do mod caminhos, com clique de verdade.

Um Claude Code (haiku) num kitty, dentro do GNOME sem tela de subir-shell.sh, carrega o mod por
--plugin-dir e responde com um arquivo e uma pasta. O ponteiro virtual do Clutter clica em cada
caminho; o xdg-open falso anota o que o mod mandou abrir.

  python3 -I teste.py <dir do shell> <pasta do mod> <pasta de saída> <id da sessão>
"""
import json
import os
import re
import subprocess
import sys
import time
import unicodedata

import gi

gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib  # noqa: E402

T, MOD, SAIDA, SESSAO = sys.argv[1:5]
SOCK = f'unix:{T}/kitty.sock'
BUS = open(f'{T}/bus').read().strip()
ARQUIVO = f'{T}/alvo/guia.md'
PASTA = f'{T}/alvo'
OSC8 = re.compile(r'\x1b\]8;[^;\x1b\x07]*;([^\x1b\x07]*)(?:\x1b\\|\x07)')
CSI = re.compile(r'\x1b\[[0-9;:?<=>]*[ -/]*[@-~]')
# Os outros mods ficam desligados na sessão de teste, e a cópia instalada deste também: vale a da pasta.
OUTROS_PLUGINS = ['painel@painel-claude', 'miniaturas@miniaturas-claude', 'filetree@claude-code-filetree',
                  'cc-plugin-you-should-know@builtin', 'caminhos@caminhos-claude']

conexao = Gio.DBusConnection.new_for_address_sync(
    BUS, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)


def avaliar(js):
    ok, saida = conexao.call_sync('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
                                  GLib.Variant('(s)', (js,)), GLib.VariantType('(bs)'),
                                  Gio.DBusCallFlags.NONE, 10_000, None).unpack()
    if not ok:
        raise RuntimeError(f'Eval falhou: {saida}')
    return json.loads(saida) if saida else None


def kitten(*args):
    return subprocess.run(['kitten', '@', '--to', SOCK, *args], capture_output=True, text=True, check=True).stdout


def tela(ansi=True):
    return kitten('get-text', '--extent', 'screen', *(['--ansi'] if ansi else []))


def celulas(texto_ansi):
    """Cada linha da tela como lista de (coluna, caractere, link OSC 8 em vigor)."""
    linhas = []
    for linha in texto_ansi.split('\n'):
        col, href, i, cel = 0, '', 0, []
        while i < len(linha):
            if linha[i] == '\x1b':
                m = OSC8.match(linha, i) or CSI.match(linha, i)
                if m is None:
                    i += 2
                    continue
                if m.re is OSC8:
                    href = m.group(1)
                i = m.end()
                continue
            ch = linha[i]
            cel.append((col, ch, href))
            col += 0 if unicodedata.combining(ch) else 2 if unicodedata.east_asian_width(ch) in 'WF' else 1
            i += 1
        linhas.append(cel)
    return linhas


def trechos(texto_ansi):
    """Cada corrida de células com o mesmo link: (linha, coluna inicial, coluna final, href, texto)."""
    lista = []
    for linha, cel in enumerate(celulas(texto_ansi)):
        atual = None
        for col, ch, h in cel + [(None, '', '')]:
            if atual is not None and h == atual[3] and col is not None:
                atual[2], atual[4] = col, atual[4] + ch
                continue
            if atual is not None:
                lista.append(tuple(atual))
            atual = [linha, col, col, h, ch] if h else None
    return lista


def da_resposta(texto_ansi):
    """Os trechos com link abaixo do pedido (a resposta do Claude), sem os do próprio pedido."""
    linhas = texto_ansi.split('\n')
    base = max((i for i, l in enumerate(linhas) if 'Sem usar ferramentas' in l), default=-1)
    return [t for t in trechos(texto_ansi) if t[0] > base and t[3].startswith('file://')]


def achar_link(href):
    return next(((t[0], t[1]) for t in da_resposta(tela()) if t[3] == href), None)


def esperar(condicao, segundos, passo=0.5):
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            valor = condicao()
        except subprocess.CalledProcessError:  # o kitty ainda não abriu o socket
            valor = None
        if valor:
            return valor
        time.sleep(passo)
    return None


def clicar(x, y):
    avaliar('const Clutter = imports.gi.Clutter, GLib = imports.gi.GLib;'
            'globalThis.__vp ??= Clutter.get_default_backend().get_default_seat()'
            '.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);'
            f'__vp.notify_absolute_motion(GLib.get_monotonic_time(), {x}, {y}); 1')
    time.sleep(0.3)
    avaliar('__vp.notify_button(imports.gi.GLib.get_monotonic_time(), imports.gi.Clutter.BUTTON_PRIMARY,'
            ' imports.gi.Clutter.ButtonState.PRESSED); 1')
    time.sleep(0.08)
    avaliar('__vp.notify_button(imports.gi.GLib.get_monotonic_time(), imports.gi.Clutter.BUTTON_PRIMARY,'
            ' imports.gi.Clutter.ButtonState.RELEASED); 1')


def abertos():
    try:
        return open(f'{T}/aberto.log').read().splitlines()
    except FileNotFoundError:
        return []


def main():
    os.makedirs(SAIDA, exist_ok=True)
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('CLAUDE', 'PTYXIS')) and k not in ('VTE_VERSION', 'TERM_PROGRAM', 'DISPLAY')}
    env.update(WAYLAND_DISPLAY=f'{T}/run/wayland-0', XDG_RUNTIME_DIR=f'{T}/run', DBUS_SESSION_BUS_ADDRESS=BUS,
               PATH=f'{T}/fakebin:{env["PATH"]}')
    ajustes = json.dumps({'enabledPlugins': {p: False for p in OUTROS_PLUGINS},
                          'statusLine': {'type': 'command', 'command': 'true'}})
    cmd = ['kitty', '-o', 'allow_remote_control=socket-only', '--listen-on', SOCK,
           '-o', 'initial_window_width=130c', '-o', 'initial_window_height=40c', '-o', 'remember_window_size=no',
           '-o', 'hide_window_decorations=yes', '-o', 'window_padding_width=0', '-o', 'placement_strategy=top-left',
           '--directory', '/home/gabriel/projetos',  # pasta já confiável: na pasta pessoal ele sempre pergunta
           'claude', '--plugin-dir', MOD, '--model', 'haiku', '--session-id', SESSAO, '--settings', ajustes]
    with open(f'{SAIDA}/kitty.log', 'w') as log:
        kitty = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        pronto = esperar(lambda: 'trust' in (s := tela(False)) or 'for shortcuts' in s or ('❯' in s and '───' in s), 60)
        time.sleep(3)
        open(f'{SAIDA}/0-inicio.txt', 'w').write(tela(False))
        if 'trust' in tela(False):
            print('o Claude Code perguntou se confia na pasta; ver 0-inicio.txt')
            return 1
        if not pronto:
            print('o Claude Code não ficou pronto; ver 0-inicio.txt e kitty.log')
            return 1
        time.sleep(2)
        pedido = (f'Sem usar ferramentas, responda apenas com estas duas linhas, copiando exatamente: '
                  f'Guia: {ARQUIVO} (primeira linha) e Pasta: `{PASTA}` (segunda linha).')
        kitten('send-text', pedido)
        time.sleep(1)
        kitten('send-key', 'enter')
        href_arquivo = 'file://' + ARQUIVO
        href_pasta = 'file://' + PASTA
        achou = esperar(lambda: achar_link(href_arquivo) and achar_link(href_pasta), 120, 1)
        open(f'{SAIDA}/1-resposta.ansi', 'w').write(tela())
        open(f'{SAIDA}/1-resposta.txt', 'w').write(tela(False))
        if not achou:
            print('a resposta não trouxe os dois links file://; ver 1-resposta.txt')
            return 1
        time.sleep(3)  # o Markdown recém-montado descarta clique de começo como "perdido"

        geo = avaliar('(() => { const w = global.get_window_actors().map(a => a.meta_window)'
                      '.find(m => /kitty/i.test(m.get_wm_class() || "")); if (!w) return null;'
                      ' const f = w.get_frame_rect(), b = w.get_buffer_rect();'
                      ' return { frame: [f.x, f.y, f.width, f.height], buffer: [b.x, b.y, b.width, b.height],'
                      ' foco: w.has_focus() }; })()')
        janela = json.loads(kitten('ls'))[0]['tabs'][0]['windows'][0]
        colunas, linhas = janela['columns'], janela['lines']
        fx, fy, fw, fh = geo['frame']
        cw, ch = fw / colunas, fh / linhas
        print(f'janela {geo} | {colunas}x{linhas} células de {cw:.2f}x{ch:.2f} px')

        resposta = da_resposta(tela())
        json.dump(resposta, open(f'{SAIDA}/trechos.json', 'w'), indent=1, ensure_ascii=False)
        do_arquivo = [t for t in resposta if t[3] == href_arquivo]
        da_pasta = [t for t in resposta if t[3] == href_pasta]
        do_dir = [t for t in resposta if t[3] == 'file://' + T]
        print('trechos com link na resposta:', [(t[0], t[1], t[4]) for t in resposta])

        def centro(t):
            return fx + ((t[1] + t[2]) / 2 + 0.5) * cw, fy + t[0] * ch + ch / 2

        # Um clique numa área vazia primeiro: o clique que só traz a janela para frente o Claude Code ignora.
        clicar(fx + 100 * cw, fy + 30 * ch)
        time.sleep(1.5)
        print('foco depois do clique vazio:', avaliar('global.display.focus_window?.get_wm_class() ?? null'),
              '| abertos até aqui:', abertos())

        # Passar o mouse por cima de um pedaço (sem clicar) e ver se o desenho daquela linha muda.
        if da_pasta:
            linha = da_pasta[0][0]
            antes_hover = tela().split('\n')[linha]
            x, y = centro(da_pasta[0])
            avaliar('const Clutter = imports.gi.Clutter, GLib = imports.gi.GLib;'
                    'globalThis.__vp ??= Clutter.get_default_backend().get_default_seat()'
                    '.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);'
                    f'__vp.notify_absolute_motion(GLib.get_monotonic_time(), {x}, {y}); 1')
            time.sleep(0.8)
            com_hover = tela().split('\n')[linha]
            open(f'{SAIDA}/hover.txt', 'w').write(repr(antes_hover) + '\n' + repr(com_hover) + '\n')
            print('o desenho muda com o mouse por cima:', antes_hover != com_hover)

        resultado = {}
        alvos = [('pedaço guia.md', do_arquivo[:1], ARQUIVO), ('pedaço alvo (texto)', da_pasta[:1], PASTA),
                 ('pedaço alvo (crases)', da_pasta[1:2], PASTA), ('pedaço do diretório de cima', do_dir[:1], T)]
        for nome, achados, esperado in alvos:
            if not achados:
                resultado[nome] = {'certo': False, 'motivo': 'o trecho não apareceu'}
                print(nome, resultado[nome])
                continue
            t = achados[0]
            x, y = centro(t)
            antes = len(abertos())
            clicar(x, y)
            novo = esperar(lambda: abertos()[antes:], 6, 0.3)
            resultado[nome] = {'trecho': t[4], 'celula': [t[0], t[1]], 'pixel': [round(x), round(y)], 'abriu': novo,
                               'certo': novo == [esperado]}
            print(nome, resultado[nome])
            time.sleep(1.5)
        open(f'{SAIDA}/2-depois.txt', 'w').write(tela(False))
        ok, arquivo = conexao.call_sync('org.gnome.Shell', '/org/gnome/Shell/Screenshot', 'org.gnome.Shell.Screenshot',
                                        'ScreenshotArea', GLib.Variant('(iiiibs)', (fx, fy, fw, fh, False, f'{SAIDA}/tela.png')),
                                        GLib.VariantType('(bs)'), Gio.DBusCallFlags.NONE, 10_000, None).unpack()
        print('print:', ok, arquivo)
        json.dump(resultado, open(f'{SAIDA}/resultado.json', 'w'), indent=2, ensure_ascii=False)
        return 0 if all(r['certo'] for r in resultado.values()) else 1
    finally:
        try:
            kitten('close-window')
        except subprocess.CalledProcessError:
            pass
        try:
            kitty.wait(10)
        except subprocess.TimeoutExpired:
            os.killpg(kitty.pid, 9)


if __name__ == '__main__':
    sys.exit(main())
