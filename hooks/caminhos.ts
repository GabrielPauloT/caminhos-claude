/** O que um caminho achado leva: um arquivo ou uma pasta. */
export type Tipo = 'file' | 'dir'

/** De onde partem os caminhos com `~/` e os relativos. */
export type Bases = { home?: string; cwd: string }

/**
 * Um caminho achado no markdown de uma resposta.
 *
 * `rotulo`: o trecho de `inicio` a `fim` é o próprio caminho, solto ou entre crases, e cada pedaço
 * dele vira um link. `destino`: o trecho é o endereço de um link markdown que já existe, e só ele
 * é trocado.
 */
export type Achado = {
  inicio: number
  fim: number
  /** Como foi escrito, sem o `:linha` do fim; `~/` e relativo ainda por resolver. */
  caminho: string
  forma: 'rotulo' | 'destino'
  /** Num caminho entre crases, as crases de cada lado: cada pedaço leva as suas. */
  crases?: string
}

/** Um pedaço do caminho como escrito e o caminho até ele, que é o que o clique nele abre. */
export type Parte = { texto: string; ate: string }

/** O texto com os links e os endereços que eles levam, na ordem e sem repetir. */
export type Ligado = { texto: string; hrefs: string[] }

/** As variáveis de ambiente pelas quais o Claude Code decide se o terminal mostra link de verdade (OSC 8). */
export type Ambiente = Partial<Record<
  'FORCE_HYPERLINK' | 'NETLIFY' | 'CI' | 'TEAMCITY_VERSION' | 'TERM_PROGRAM' | 'TERM_PROGRAM_VERSION' | 'VTE_VERSION' |
  'TERMINAL_EMULATOR' | 'WT_SESSION' | 'TMUX' | 'LC_TERMINAL' | 'TERM',
  string
>>

/** Quantos links clicáveis um `Markdown` aceita. */
export const MAX_LINKS = 256
/** Quantos caminhos de uma resposta vão para a conferência no disco. */
export const MAX_ACHADOS = 400

const CERCA = /^ {0,3}(`{3,}|~{3,})(.*)$/

// O que, numa linha, não é texto corrido: código entre crases, link ou imagem markdown, autolink
// `<...>` e endereço solto (https://, file://, www.).
const TRECHO =
  /(?<!`)(?<crases>`+)(?!`)(?<codigo>.+?)(?<!`)\k<crases>(?!`)|!?\[(?:[^\[\]\\]|\\.|\[[^\]]*\])*\]\(\s*(?<destino><[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)|<[A-Za-z][\w+.-]*:[^\s<>]*>|\b[A-Za-z][\w+.-]*:\/\/[^\s<>]+|\bwww\.[^\s<>]+/dg

// Caminho solto no texto: absoluto, na pasta pessoal (`~/`) ou relativo com uma barra. Antes dele
// não vem letra, número, ponto, barra, til, dois-pontos, hífen nem barra invertida, senão é pedaço
// de outra coisa (um endereço, uma data, uma palavra).
const SOLTO = /(?<![\p{L}\p{N}_.\/~:\\-])(?:~\/|\/(?!\/)|[\p{L}\p{N}_@.+-]+\/)[^\s`<>"'|*()\[\]{}]*/gu

const TERMINAIS_COM_LINK = ['ghostty', 'Hyper', 'kitty', 'alacritty', 'iTerm.app', 'iTerm2', 'WarpTerminal']

const PONTUACAO_DO_FIM = /[.,;:!?…]+$/u
const LINHA_DO_FIM = /:\d+(?:[:-]\d+)?$/
const ESQUEMA = /^[A-Za-z][\w+-]*:/

function versao(texto: string): { major: number; minor: number } {
  if (/^\d{3,4}$/.test(texto)) {
    const m = /(\d{1,2})(\d{2})/.exec(texto)
    return { major: 0, minor: Number(m?.[1] ?? 0) }
  }
  const [major, minor] = texto.split('.').map(n => parseInt(n, 10))
  return { major: major ?? NaN, minor: minor ?? NaN }
}

/** O que a biblioteca supports-hyperlinks diz, num terminal com cor (o caso de uma sessão interativa). */
function pelaBiblioteca(e: Ambiente): boolean {
  if (e.FORCE_HYPERLINK) return !(parseInt(e.FORCE_HYPERLINK, 10) === 0)
  if (e.NETLIFY) return true
  if (e.WT_SESSION !== undefined) return true
  if (e.CI || e.TEAMCITY_VERSION) return false
  if (e.TERM_PROGRAM) {
    const v = versao(e.TERM_PROGRAM_VERSION ?? '')
    switch (e.TERM_PROGRAM) {
      case 'iTerm.app':
        return v.major === 3 ? v.minor >= 1 : v.major > 3
      case 'WezTerm':
        return v.major >= 20200620
      case 'vscode':
        return v.major > 1 || (v.major === 1 && v.minor >= 72)
      case 'ghostty':
        return true
    }
  }
  if (e.VTE_VERSION) {
    if (e.VTE_VERSION === '0.50.0') return false
    const v = versao(e.VTE_VERSION)
    return v.major > 0 || v.minor >= 50
  }
  return e.TERM === 'alacritty'
}

/**
 * Se o Claude Code escreve link de verdade (OSC 8) neste terminal, pela mesma regra dele (2.1.312). Sem isso ele
 * escreve "texto (endereço)", e cada pedaço do caminho sairia seguido do próprio endereço.
 */
export function terminalTemLink(e: Ambiente): boolean {
  if (e.FORCE_HYPERLINK !== undefined) return pelaBiblioteca(e)
  if (pelaBiblioteca(e)) return true
  if (e.TERM_PROGRAM && TERMINAIS_COM_LINK.includes(e.TERM_PROGRAM)) return true
  if (e.TERMINAL_EMULATOR === 'JetBrains-JediTerm') return true
  if (e.WT_SESSION && e.TERM_PROGRAM !== 'tmux' && !e.TMUX) return true
  if (e.TERM_PROGRAM === 'tmux') {
    const [maior, menor] = (e.TERM_PROGRAM_VERSION ?? '').split('.').map(n => parseInt(n, 10))
    if ((maior ?? 0) > 3 || (maior === 3 && (menor ?? 0) >= 4)) return true
  }
  if (e.LC_TERMINAL && TERMINAIS_COM_LINK.includes(e.LC_TERMINAL)) return true
  return e.TERM?.includes('kitty') ?? false
}

/** O caminho sem o `:12`, `:12:5` ou `:12-20` que aponta a linha. */
function semLinha(caminho: string): string {
  return caminho.replace(LINHA_DO_FIM, '')
}

/** Tira as barras invertidas que o markdown usa para escapar pontuação (`meu\_arquivo`). */
function desescapar(caminho: string): string {
  return caminho.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

/** Se sobra nome depois de tirar pontos, barras e til: `/`, `./` e `../` sozinhos não contam. */
function temNome(caminho: string): boolean {
  return /[^./~]/.test(caminho)
}

/** O caminho de um código entre crases, se ele inteiro tem cara de caminho. */
function deCodigo(codigo: string): string | undefined {
  const s = codigo.trim()
  // Absoluto ou em ~/ pode ter espaço (as crases dizem onde termina); relativo, só sem espaço.
  const temForma = /^(?:~\/|\/(?!\/))/.test(s) || /^[\p{L}\p{N}_@.+-]+\/\S*$/u.test(s)
  if (!temForma) return undefined
  const caminho = semLinha(s)

  return temNome(caminho) ? caminho : undefined
}

/** O caminho que o endereço de um link markdown leva, se é um caminho ou um `file://`. */
function deDestino(destino: string): string | undefined {
  if (/^file:/i.test(destino)) return deHref(destino)
  // Outro esquema (https:, mailto:) ou âncora (#...): não é caminho.
  if (destino === '' || destino.startsWith('#') || ESQUEMA.test(destino)) return undefined
  let caminho = destino.replace(/#.*$/, '')
  try {
    caminho = decodeURIComponent(caminho)
  } catch {
    // Um % que não é escape: fica como escrito.
  }
  caminho = semLinha(caminho)

  return temNome(caminho) ? caminho : undefined
}

function soltos(trecho: string, desloc: number, achados: Achado[]): void {
  for (const m of trecho.matchAll(SOLTO)) {
    const bruto = m[0].replace(PONTUACAO_DO_FIM, '')
    const caminho = desescapar(semLinha(bruto))
    if (!temNome(caminho)) continue
    achados.push({ inicio: desloc + m.index, fim: desloc + m.index + bruto.length, caminho, forma: 'rotulo' })
  }
}

function naLinha(linha: string, desloc: number, achados: Achado[]): void {
  let desde = 0
  for (const m of linha.matchAll(TRECHO)) {
    soltos(linha.slice(desde, m.index), desloc + desde, achados)
    desde = m.index + m[0].length
    const { crases, codigo, destino } = m.groups ?? {}
    if (codigo !== undefined) {
      const caminho = deCodigo(codigo)
      if (caminho !== undefined) achados.push({ inicio: desloc + m.index, fim: desloc + desde, caminho, forma: 'rotulo', crases })
      continue
    }
    const faixa = m.indices?.groups?.destino
    if (destino === undefined || faixa === undefined || m[0].startsWith('!')) continue
    // `[texto](<caminho com espaço>)`: troca só o que está dentro dos sinais.
    const embrulhado = destino.startsWith('<') ? 1 : 0
    const caminho = deDestino(embrulhado ? destino.slice(1, -1) : destino)
    if (caminho !== undefined) {
      achados.push({ inicio: desloc + faixa[0] + embrulhado, fim: desloc + faixa[1] - embrulhado, caminho, forma: 'destino' })
    }
  }
  soltos(linha.slice(desde), desloc + desde, achados)
}

/**
 * Os caminhos do markdown de uma resposta, na ordem do texto: soltos, entre crases e no endereço
 * de um link. Bloco de código (```) e endereço da web ficam de fora. Se cada um existe, quem diz é
 * o disco: aqui só se olha a forma.
 */
export function acharCaminhos(texto: string): Achado[] {
  const achados: Achado[] = []
  let cerca: { marca: string; tamanho: number } | undefined
  let inicio = 0
  for (const linha of texto.split('\n')) {
    const desloc = inicio
    inicio += linha.length + 1
    const c = CERCA.exec(linha)
    const marca = c?.[1] ?? ''
    const resto = c?.[2] ?? ''
    if (cerca !== undefined) {
      if (marca.startsWith(cerca.marca) && marca.length >= cerca.tamanho && resto.trim() === '') cerca = undefined
      continue
    }
    // Abre um bloco de código (a cerca de crases não leva crase no resto da linha).
    if (c !== null && !(marca.startsWith('`') && resto.includes('`'))) {
      cerca = { marca: marca.slice(0, 1), tamanho: marca.length }
      continue
    }
    naLinha(linha, desloc, achados)
    if (achados.length >= MAX_ACHADOS) return achados.slice(0, MAX_ACHADOS)
  }

  return achados
}

/** O caminho absoluto e limpo (sem `.`, `..` e barras repetidas); undefined se `~/` sem pasta pessoal. */
export function absoluto(caminho: string, bases: Bases): string | undefined {
  let bruto: string
  if (caminho.startsWith('/')) bruto = caminho
  else if (caminho === '~' || caminho.startsWith('~/')) {
    if (!bases.home) return undefined
    bruto = `${bases.home}/${caminho.slice(2)}`
  } else bruto = `${bases.cwd}/${caminho}`
  const partes: string[] = []
  for (const parte of bruto.split('/')) {
    if (parte === '' || parte === '.') continue
    if (parte === '..') partes.pop()
    else partes.push(parte)
  }

  return `/${partes.join('/')}`
}

/** O endereço `file://` de um caminho absoluto, cada parte codificada (espaço, acento, parênteses). */
export function paraHref(caminho: string): string {
  const partes = caminho
    .split('/')
    .map(parte => encodeURIComponent(parte).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))

  return `file://${partes.join('/')}`
}

/** O caminho que um endereço `file://` leva, ou undefined se não for um. */
export function deHref(href: string): string | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }
  if (url.protocol !== 'file:' || (url.hostname !== '' && url.hostname !== 'localhost')) return undefined
  try {
    return decodeURIComponent(url.pathname)
  } catch {
    return undefined
  }
}

/**
 * Os pedaços de um caminho como escrito, cada um com o caminho até ele: `/home/gabriel/a.md:12` dá
 * `/home`, `/gabriel` e `/a.md:12`. A barra vai com o nome que vem depois dela; a barra do fim e o
 * `:linha` ficam com o último pedaço.
 */
export function partes(escrito: string): Parte[] {
  const linha = LINHA_DO_FIM.exec(escrito)?.[0] ?? ''
  const corpo = escrito.slice(0, escrito.length - linha.length)
  const lista: Parte[] = []
  let inicio = 0
  for (let i = 1; i < corpo.length - 1; i++) {
    if (corpo[i] !== '/' || corpo[i - 1] === '/') continue
    lista.push({ texto: corpo.slice(inicio, i), ate: corpo.slice(0, i) })
    inicio = i
  }
  lista.push({ texto: corpo.slice(inicio) + linha, ate: corpo })

  return lista
}

type Link = { texto: string; href: string }

/** Os links de um achado: um por pedaço do caminho ou, no endereço de um link pronto, um só. */
function linksDe(trecho: string, achado: Achado, hrefDe: (caminho: string) => string | undefined): Link[] | undefined {
  if (achado.forma === 'destino') {
    const href = hrefDe(achado.caminho)

    return href === undefined ? undefined : [{ texto: trecho, href }]
  }
  const crases = achado.crases ?? ''
  const escrito = crases === '' ? trecho : trecho.slice(crases.length, trecho.length - crases.length).trim()
  const links: Link[] = []
  for (const parte of partes(escrito)) {
    const href = hrefDe(crases === '' ? desescapar(parte.ate) : parte.ate)
    if (href === undefined) return undefined
    links.push({ texto: `${crases}${parte.texto}${crases}`, href })
  }

  return links
}

/**
 * O texto com cada caminho que `existe` confirma virado links, um por pedaço (o clique abre até
 * ali), e os endereços desses links. Os rótulos juntos são o trecho como estava (crases e `:linha`
 * inclusos), então o texto desenhado não muda. `hrefDe` dá o endereço de qualquer caminho até um
 * pedaço: se o caminho inteiro existe, as pastas acima dele também existem.
 */
export function ligar(
  texto: string,
  achados: readonly Achado[],
  existe: (caminho: string) => boolean,
  hrefDe: (caminho: string) => string | undefined,
): Ligado {
  const hrefs = new Set<string>()
  const cabem = (links: Link[]) => hrefs.size + new Set(links.map(l => l.href).filter(h => !hrefs.has(h))).size <= MAX_LINKS
  let saida = ''
  let desde = 0
  for (const achado of achados) {
    if (achado.inicio < desde || !existe(achado.caminho)) continue
    const trecho = texto.slice(achado.inicio, achado.fim)
    let links = linksDe(trecho, achado, hrefDe)
    // Sem lugar para todos os pedaços, o caminho vira um link só; sem lugar nem para ele, fica texto.
    if (links !== undefined && !cabem(links)) {
      const href = hrefDe(achado.caminho)
      links = href === undefined ? undefined : [{ texto: trecho, href }]
      if (links !== undefined && !cabem(links)) links = undefined
    }
    if (links === undefined) continue
    for (const link of links) hrefs.add(link.href)
    const antes = texto.slice(desde, achado.inicio)
    // Um `!` logo antes do `[` faria do link uma imagem.
    saida += achado.forma === 'rotulo' && /(?<!\\)!$/.test(antes) ? `${antes.slice(0, -1)}\\!` : antes
    saida += achado.forma === 'destino' ? links.map(l => l.href).join('') : links.map(l => `[${l.texto}](${l.href})`).join('')
    desde = achado.fim
  }

  return { texto: saida + texto.slice(desde), hrefs: [...hrefs] }
}
