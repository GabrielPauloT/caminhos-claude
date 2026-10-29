import type { EngineInterface, Register } from 'claude-code'

import { absoluto, acharCaminhos, deHref, ligar, paraHref } from './caminhos'
import type { Bases, Tipo } from './caminhos'

type Motor = EngineInterface
type Visto = { tipo: Tipo | undefined; em: number }

/** Quanto vale o que o disco disse de um caminho: o que existe muda pouco, o que falta pode surgir já. */
const VALE_SE_EXISTE_MS = 60_000
const VALE_SE_FALTA_MS = 5_000
const MAX_VISTOS = 2_000

// Abre o arquivo no app padrão ou a pasta no gerenciador de arquivos sem prender o Claude Code, e o
// app não morre junto com o terminal (setsid). Sai com 2 se o caminho sumiu e 3 se não há como abrir.
const SCRIPT_ABRIR = `
[ -e "$1" ] || exit 2
if command -v xdg-open >/dev/null 2>&1; then
  command -v setsid >/dev/null 2>&1 && exec setsid -w xdg-open "$1" </dev/null >/dev/null 2>&1
  exec xdg-open "$1" </dev/null >/dev/null 2>&1
fi
command -v open >/dev/null 2>&1 && exec open "$1" </dev/null >/dev/null 2>&1
exit 3
`

/** O que o mod guarda enquanto o módulo vive; o `register` zera a cada recarga. */
const mem: { vistos: Map<string, Visto>; home: string | undefined | null } = { vistos: new Map(), home: null }

async function basesDe($: Motor): Promise<Bases> {
  if (mem.home === null) mem.home = (await $.env.get('HOME')) || undefined

  return { home: mem.home, cwd: await $.session.cwd() }
}

/** O sinal que abre uma resposta no terminal, o mesmo do Claude Code (outro no macOS). */
function sinalDe(home: string | undefined): string {
  return home?.startsWith('/Users/') ? '⏺' : '●'
}

/** `file` ou `dir` se o caminho existe; o disco é lido de novo só quando a resposta anterior venceu. */
async function tipoDe($: Motor, caminho: string, agora: number): Promise<Tipo | undefined> {
  const visto = mem.vistos.get(caminho)
  if (visto !== undefined && agora - visto.em < (visto.tipo ? VALE_SE_EXISTE_MS : VALE_SE_FALTA_MS)) return visto.tipo
  const info = await $.fs.stat(caminho).catch(() => undefined)
  const tipo = info?.kind === 'file' || info?.kind === 'dir' ? info.kind : undefined
  mem.vistos.delete(caminho)
  mem.vistos.set(caminho, { tipo, em: agora })
  const maisAntigo = mem.vistos.keys().next().value
  if (mem.vistos.size > MAX_VISTOS && maisAntigo !== undefined) mem.vistos.delete(maisAntigo)

  return tipo
}

/** Abre o caminho de um link: o arquivo no app padrão, a pasta no gerenciador de arquivos. */
async function abrir($: Motor, href: string): Promise<void> {
  const caminho = deHref(href)
  if (caminho === undefined) return
  const nome = caminho.split('/').filter(Boolean).pop() ?? caminho
  void $.ui.toast(`Abrindo ${nome}`)
  const r = await $.process.run(['sh', '-c', SCRIPT_ABRIR, 'sh', caminho], { timeoutMs: 15_000 }).catch(() => undefined)
  // O aviso já sai com o nome do mod no título.
  if (r === undefined) void $.ui.toast(`${nome} não abriu a tempo`)
  else if (r.exitCode === 2) void $.ui.toast(`${nome} não existe mais`)
  else if (r.exitCode !== 0) void $.ui.toast(`Não consegui abrir ${nome}`)
}

export const register: Register = on => {
  mem.vistos = new Map()
  mem.home = null

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // Só no terminal: desktop, VS Code e celular abrem os links do jeito deles.
    if (e.surface !== 'terminal' || e.props.isSummary) return next(e)
    const achados = acharCaminhos(e.props.text)
    if (achados.length === 0) return next(e)

    const bases = await basesDe($)
    const agora = await $.clock.now()
    const absolutos = new Map(achados.map(({ caminho }) => [caminho, absoluto(caminho, bases)] as const))
    const tipos = new Map<string, Tipo | undefined>()
    const conferir = new Set([...absolutos.values()].filter(caminho => caminho !== undefined))
    await Promise.all([...conferir].map(async caminho => tipos.set(caminho, await tipoDe($, caminho, agora))))
    const { texto, hrefs } = ligar(
      e.props.text,
      achados,
      caminho => {
        const abs = absolutos.get(caminho)

        return abs !== undefined && tipos.get(abs) !== undefined
      },
      caminho => {
        const abs = absoluto(caminho, bases)

        return abs === undefined ? undefined : paraHref(abs)
      },
    )
    if (hrefs.length === 0) return next(e)

    // O desenho do Claude Code (o sinal na primeira linha da resposta e o texto ao lado) com o
    // Markdown do mod no lugar do dele: o clique simples num pedaço do caminho chega aqui e abre
    // no PC o caminho até ali; o Ctrl+clique continua com o terminal e o Claude Code, como antes.
    const { Box, Markdown, Text } = $.ui.resolve(e)

    return (
      <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
        {e.props.isFirstOfReply && (
          <Box minWidth={2}>
            <Text color="text">{sinalDe(bases.home)}</Text>
          </Box>
        )}
        <Box flexDirection="column">
          <Markdown
            key={`caminhos:${e.requestId}`}
            text={texto}
            pressableLinks={hrefs}
            onLinkPress={link => void abrir($, link.href)}
          />
        </Box>
      </Box>
    )
  })
}
