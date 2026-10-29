import { expect, test } from 'claude-code/testing'

import { absoluto, acharCaminhos, deHref, ligar, paraHref, partes, terminalTemLink, utf16Base64 } from '../hooks/caminhos'
import type { Ligado } from '../hooks/caminhos'

const BASES = { home: '/home/gabriel', cwd: '/home/gabriel/projeto' }

function caminhos(texto: string): string[] {
  return acharCaminhos(texto).map(achado => achado.caminho)
}

/** Liga como o mod liga, fingindo que só os caminhos da lista existem. */
function ligarCom(texto: string, existentes: string[]): Ligado {
  return ligar(
    texto,
    acharCaminhos(texto),
    caminho => {
      const abs = absoluto(caminho, BASES)

      return abs !== undefined && existentes.includes(abs)
    },
    caminho => {
      const abs = absoluto(caminho, BASES)

      return abs === undefined ? undefined : paraHref(abs)
    },
  )
}

/** O texto como fica desenhado: cada link vira só o seu rótulo. */
function semLinks(texto: string): string {
  return texto.replace(/\[((?:`[^`]*`|[^\]])*)\]\((?:<[^>]*>|[^)\s]*)\)/g, '$1')
}

test('cada pedaço do caminho vira um link para o caminho até ele', () => {
  const relatorio = '/home/gabriel/projetos/loja/qa/relatorio.md'
  const r = ligarCom(`Relatório: ${relatorio}`, [relatorio])

  expect(r.texto).toBe(
    'Relatório: [/home](file:///home)[/gabriel](file:///home/gabriel)[/projetos](file:///home/gabriel/projetos)' +
      '[/loja](file:///home/gabriel/projetos/loja)[/qa](file:///home/gabriel/projetos/loja/qa)' +
      '[/relatorio.md](file:///home/gabriel/projetos/loja/qa/relatorio.md)',
  )
  expect(r.hrefs).toHaveLength(6)
})

test('o caminho numa linha só dele vira links e o texto desenhado não muda (o caso do print)', () => {
  const guia = '/home/gabriel/projetos/loja/docs/guia-do-front.md'
  const texto = `O guia está pronto e você já pode mandar:\n\n${guia}\n\n**O que o guia cobre:**`

  expect(caminhos(texto)).toEqual([guia])
  const r = ligarCom(texto, [guia])
  expect(semLinks(r.texto)).toBe(texto)
  expect(r.hrefs.at(-1)).toBe(`file://${guia}`)
})

test('a pontuação do fim fica fora e o :linha fica no último pedaço', () => {
  const texto = 'Veja /home/gabriel/a.md, e também (~/b/c.ts:12).'

  expect(caminhos(texto)).toEqual(['/home/gabriel/a.md', '~/b/c.ts'])
  expect(ligarCom(texto, ['/home/gabriel/a.md', '/home/gabriel/b/c.ts']).texto).toBe(
    'Veja [/home](file:///home)[/gabriel](file:///home/gabriel)[/a.md](file:///home/gabriel/a.md), e também ' +
      '([~](file:///home/gabriel)[/b](file:///home/gabriel/b)[/c.ts:12](file:///home/gabriel/b/c.ts)).',
  )
})

test('o relativo parte da pasta da sessão', () => {
  expect(ligarCom('Em hooks/register.tsx:12', ['/home/gabriel/projeto/hooks/register.tsx']).texto).toBe(
    'Em [hooks](file:///home/gabriel/projeto/hooks)[/register.tsx:12](file:///home/gabriel/projeto/hooks/register.tsx)',
  )
})

test('entre crases cada pedaço leva as suas crases, com espaço e acento', () => {
  const texto = 'Em `/home/gabriel/Área de Trabalho/x (1).png` e **/tmp/negrito**'

  expect(caminhos(texto)).toEqual(['/home/gabriel/Área de Trabalho/x (1).png', '/tmp/negrito'])
  expect(ligarCom(texto, ['/home/gabriel/Área de Trabalho/x (1).png', '/tmp/negrito']).texto).toBe(
    'Em [`/home`](file:///home)[`/gabriel`](file:///home/gabriel)' +
      '[`/Área de Trabalho`](file:///home/gabriel/%C3%81rea%20de%20Trabalho)' +
      '[`/x (1).png`](file:///home/gabriel/%C3%81rea%20de%20Trabalho/x%20%281%29.png)' +
      ' e **[/tmp](file:///tmp)[/negrito](file:///tmp/negrito)**',
  )
})

test('a barra do fim fica com o último pedaço', () => {
  expect(ligarCom('Em `~/projetos/`', ['/home/gabriel/projetos']).texto).toBe(
    'Em [`~`](file:///home/gabriel)[`/projetos/`](file:///home/gabriel/projetos)',
  )
})

test('bloco de código, endereço da web e link pronto para a web ficam como estão', () => {
  const texto = [
    '```bash',
    'ls /home/gabriel/a',
    '```',
    'https://github.com/x/y e [doc](https://x.com/a/b) e www.exemplo.com/a/b',
    '~~~',
    '/home/gabriel/a',
    '~~~',
  ].join('\n')

  expect(caminhos(texto)).toEqual([])
  expect(ligarCom(texto, ['/home/gabriel/a']).texto).toBe(texto)
})

test('código que não é caminho e palavra com barra não viram link', () => {
  const texto = 'Rode `npm run build` e `/usr/bin/env python3`; e/ou 29/10/2026, TCP/IP, km/h, a / b'

  expect(ligarCom(texto, []).texto).toBe(texto)
  expect(caminhos(texto)).not.toContain('/')
})

test('link markdown com caminho no endereço troca só o endereço, inteiro', () => {
  const texto = 'Abra [o guia](/home/gabriel/guia.md) ou [o outro](<~/a b.md>) ou [web](https://x.com).'

  expect(caminhos(texto)).toEqual(['/home/gabriel/guia.md', '~/a b.md'])
  expect(ligarCom(texto, ['/home/gabriel/guia.md', '/home/gabriel/a b.md']).texto).toBe(
    'Abra [o guia](file:///home/gabriel/guia.md) ou [o outro](<file:///home/gabriel/a%20b.md>) ou [web](https://x.com).',
  )
})

test('o mesmo caminho duas vezes repete os links sem repetir os endereços', () => {
  const r = ligarCom('/tmp/x.md e de novo /tmp/x.md', ['/tmp/x.md'])

  expect(r.texto).toBe('[/tmp](file:///tmp)[/x.md](file:///tmp/x.md) e de novo [/tmp](file:///tmp)[/x.md](file:///tmp/x.md)')
  expect(r.hrefs).toEqual(['file:///tmp', 'file:///tmp/x.md'])
})

test('o escape do markdown sai do caminho, não do rótulo', () => {
  const texto = 'em /tmp/meu\\_arquivo.md'

  expect(caminhos(texto)).toEqual(['/tmp/meu_arquivo.md'])
  expect(ligarCom(texto, ['/tmp/meu_arquivo.md']).texto).toBe('em [/tmp](file:///tmp)[/meu\\_arquivo.md](file:///tmp/meu_arquivo.md)')
})

test('um ! logo antes do caminho não vira imagem', () => {
  expect(ligarCom('Pronto!/tmp/x.md', ['/tmp/x.md']).texto).toBe('Pronto\\![/tmp](file:///tmp)[/x.md](file:///tmp/x.md)')
})

test('passando de 256 endereços, o caminho vira um link só e depois fica texto', () => {
  const lista = Array.from({ length: 200 }, (_, i) => `/tmp/a${i}/b${i}.md`)
  const r = ligarCom(lista.join('\n\n'), lista)

  expect(r.hrefs).toHaveLength(256)
  const usados = [...r.texto.matchAll(/\]\((file:[^)]*)\)/g)].map(m => m[1] ?? '')
  expect(usados.every(href => r.hrefs.includes(href))).toBe(true)
  expect(r.texto).toContain('[/tmp](file:///tmp)[/a126](file:///tmp/a126)[/b126.md](file:///tmp/a126/b126.md)')
  expect(r.texto).toContain('\n\n[/tmp/a127/b127.md](file:///tmp/a127/b127.md)\n\n/tmp/a128/b128.md\n\n')
})

test('partes: a barra vai com o nome depois dela', () => {
  expect(partes('/home/x/a.md:3')).toEqual([
    { texto: '/home', ate: '/home' },
    { texto: '/x', ate: '/home/x' },
    { texto: '/a.md:3', ate: '/home/x/a.md' },
  ])
  expect(partes('src/')).toEqual([{ texto: 'src/', ate: 'src/' }])
  expect(partes('a//b')).toEqual([
    { texto: 'a', ate: 'a' },
    { texto: '//b', ate: 'a//b' },
  ])
})

test('absoluto resolve ~ e relativo e limpa . e ..', () => {
  expect(absoluto('~', BASES)).toBe('/home/gabriel')
  expect(absoluto('~/x/../y/./z', BASES)).toBe('/home/gabriel/y/z')
  expect(absoluto('../outro/a.md', BASES)).toBe('/home/gabriel/outro/a.md')
  expect(absoluto('/a//b/', BASES)).toBe('/a/b')
  expect(absoluto('~/a', { cwd: '/' })).toBeUndefined()
})

test('o endereço volta para o mesmo caminho', () => {
  for (const caminho of ['/home/gabriel/Área de Trabalho/a (1).md', '/tmp/x#y?z.txt', "/tmp/it's 100%.txt"]) {
    expect(deHref(paraHref(caminho))).toBe(caminho)
  }
  expect(deHref('https://x.com/a')).toBeUndefined()
  expect(deHref('file://servidor/a')).toBeUndefined()
})

test('link de verdade: os terminais que o Claude Code reconhece', () => {
  expect(terminalTemLink({ VTE_VERSION: '8001', TERM: 'xterm-256color' })).toBe(true) // Ptyxis, GNOME Terminal
  expect(terminalTemLink({ TERM: 'xterm-kitty' })).toBe(true)
  expect(terminalTemLink({ TERM_PROGRAM: 'ghostty' })).toBe(true)
  expect(terminalTemLink({ TERM_PROGRAM: 'WarpTerminal' })).toBe(true)
  expect(terminalTemLink({ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.95.0' })).toBe(true)
  expect(terminalTemLink({ TERMINAL_EMULATOR: 'JetBrains-JediTerm' })).toBe(true)
  expect(terminalTemLink({ WT_SESSION: 'x' })).toBe(true)
  expect(terminalTemLink({ TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.4' })).toBe(true)
  expect(terminalTemLink({ FORCE_HYPERLINK: '1', TERM: 'xterm-256color' })).toBe(true)
})

test('sem link de verdade: o Bullpen sem FORCE_HYPERLINK, tmux antigo, FORCE_HYPERLINK=0', () => {
  expect(terminalTemLink({ TERM: 'xterm-256color' })).toBe(false) // o terminal dos agentes do Bullpen
  expect(terminalTemLink({ TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.3a' })).toBe(false)
  expect(terminalTemLink({ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.71.2' })).toBe(false)
  expect(terminalTemLink({ FORCE_HYPERLINK: '0', VTE_VERSION: '8001' })).toBe(false)
  expect(terminalTemLink({ VTE_VERSION: '0.50.0' })).toBe(false)
})

const WIN = { home: 'C:\\Users\\gabri', cwd: 'C:\\Users\\gabri\\projeto' }

/** Liga como o mod liga no Windows, fingindo que só os caminhos da lista existem. */
function ligarNoWindows(texto: string, existentes: string[]): Ligado {
  return ligar(
    texto,
    acharCaminhos(texto, true),
    caminho => {
      const abs = absoluto(caminho, WIN, true)

      return abs !== undefined && existentes.includes(abs)
    },
    caminho => {
      const abs = absoluto(caminho, WIN, true)

      return abs === undefined ? undefined : paraHref(abs)
    },
    true,
  )
}

test('Windows: C:\\ vira um link por pedaço, a unidade primeiro', () => {
  const texto = 'Salvei em C:\\Users\\gabri\\loja\\qa\\relatorio.md.'

  expect(acharCaminhos(texto, true).map(a => a.caminho)).toEqual(['C:\\Users\\gabri\\loja\\qa\\relatorio.md'])
  expect(ligarNoWindows(texto, ['C:\\Users\\gabri\\loja\\qa\\relatorio.md']).texto).toBe(
    'Salvei em [C:](file:///C:/)[\\Users](file:///C:/Users)[\\gabri](file:///C:/Users/gabri)' +
      '[\\loja](file:///C:/Users/gabri/loja)[\\qa](file:///C:/Users/gabri/loja/qa)' +
      '[\\relatorio.md](file:///C:/Users/gabri/loja/qa/relatorio.md).',
  )
})

test('Windows: entre crases com espaço e barra normal, ~\\ e relativo com barra invertida', () => {
  expect(ligarNoWindows('`C:/Program Files/App/app.exe`', ['C:\\Program Files\\App\\app.exe']).texto).toBe(
    '[`C:`](file:///C:/)[`/Program Files`](file:///C:/Program%20Files)[`/App`](file:///C:/Program%20Files/App)' +
      '[`/app.exe`](file:///C:/Program%20Files/App/app.exe)',
  )
  expect(ligarNoWindows('~\\Documents\\x.md', ['C:\\Users\\gabri\\Documents\\x.md']).texto).toBe(
    '[~](file:///C:/Users/gabri)[\\Documents](file:///C:/Users/gabri/Documents)[\\x.md](file:///C:/Users/gabri/Documents/x.md)',
  )
  expect(ligarNoWindows('veja src\\a.ts:3', ['C:\\Users\\gabri\\projeto\\src\\a.ts']).texto).toBe(
    'veja [src](file:///C:/Users/gabri/projeto/src)[\\a.ts:3](file:///C:/Users/gabri/projeto/src/a.ts)',
  )
})

test('Windows: a barra invertida do fim não escapa o ] do link', () => {
  expect(ligarNoWindows('em C:\\Users\\gabri\\ ok', ['C:\\Users\\gabri']).texto).toBe(
    'em [C:](file:///C:/)[\\Users](file:///C:/Users)[\\gabri\\\\](file:///C:/Users/gabri) ok',
  )
})

test('Windows: absoluto, endereço e o /c/ do Git Bash', () => {
  expect(absoluto('/c/Users/gabri/a.md', WIN, true)).toBe('C:\\Users\\gabri\\a.md')
  expect(absoluto('c:', WIN, true)).toBe('C:\\')
  expect(absoluto('..\\outro\\.\\b.md', WIN, true)).toBe('C:\\Users\\gabri\\outro\\b.md')
  expect(absoluto('\\Windows', WIN, true)).toBe('C:\\Windows')
  expect(paraHref('C:\\')).toBe('file:///C:/')
  expect(deHref('file:///C:/')).toBe('C:\\')
  const caminho = 'C:\\Users\\gabri\\Área de Trabalho\\a (1).md'
  expect(deHref(paraHref(caminho))).toBe(caminho)
  expect(acharCaminhos('C:\\Users\\x e src\\y')).toEqual([]) // no Linux, sem barra normal não é caminho
})

test('utf16Base64 é o que o -EncodedCommand do PowerShell lê', () => {
  expect(utf16Base64('a')).toBe('YQA=')
  expect(utf16Base64('exit 0')).toBe('ZQB4AGkAdAAgADAA')
  expect(utf16Base64('ã$env:CAMINHOS_ALVO')).toBe('4wAkAGUAbgB2ADoAQwBBAE0ASQBOAEgATwBTAF8AQQBMAFYATwA=')
})
