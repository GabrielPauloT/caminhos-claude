import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const GUIA = '/home/gabriel/work/guia.md'
const PASTA = '/home/gabriel/work'
const CHAVE = 'caminhos:msg-1'
const LINKS_DO_GUIA = '[/home](file:///home)[/gabriel](file:///home/gabriel)[/work](file:///home/gabriel/work)[/guia.md](file:///home/gabriel/work/guia.md)'

/** Uma resposta do Claude como o terminal pede ao mod para desenhar. */
function resposta(text: string, isFirstOfReply = true) {
  return {
    plugin: 'caminhos',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-1',
    props: { text, isFirstOfReply },
  } as const
}

/** O ambiente do Ptyxis (VTE): o Claude Code escreve link de verdade. */
const PTYXIS = { HOME: '/home/gabriel', TERM: 'xterm-256color', VTE_VERSION: '8001' }

/**
 * O motor de mentira: pasta pessoal, pasta da sessão e um disco onde só a lista existe. Guarda o
 * que o mod mandou rodar e os avisos que deu; `saida` é o código com que o script de abrir sai.
 */
function motor(on: On, existentes: Record<string, 'file' | 'dir'>, saida = 0, ambiente: Record<string, string> = PTYXIS) {
  const rodados: string[][] = []
  const avisos: string[] = []
  mock.env(on, ambiente)
  mock.clock(on)
  on('session.cwd', () => ({ value: '/home/gabriel' }))
  on('fs.stat', (_, e) => ({ value: { kind: existentes[e.path] ?? 'other', size: 0, mtimeMs: 0, isLink: false } }))
  on('process.run', (_, e) => {
    rodados.push([...e.argv])

    return { value: { exitCode: saida, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    avisos.push(e.text)

    return { value: undefined }
  })

  return { rodados, avisos }
}

test('o caminho que existe vira um link por pedaço e o clique abre até o pedaço', async ($, on) => {
  const { rodados, avisos } = motor(on, { [GUIA]: 'file' })
  const ui = await $.ui.mount(resposta(`O guia está pronto:\n\n${GUIA}\n`))

  const md = await ui.find({ type: 'Markdown' })
  expect(md?.props.text).toBe(`O guia está pronto:\n\n${LINKS_DO_GUIA}\n`)
  expect(md?.props.pressableLinks).toEqual(['file:///home', 'file:///home/gabriel', `file://${PASTA}`, `file://${GUIA}`])
  expect((await ui.find({ type: 'Text', text: '●' }))?.text).toBe('●')

  await ui.press({ key: CHAVE, link: { href: `file://${GUIA}` } })
  await ui.press({ key: CHAVE, link: { href: `file://${PASTA}` } })
  expect(rodados.map(argv => argv.at(-1))).toEqual([GUIA, PASTA])
  expect(avisos).toEqual(['Abrindo guia.md', 'Abrindo work'])
  await ui.unmount()
})

test('entre crases também, e o sinal só vai na primeira parte da resposta', async ($, on) => {
  const { rodados } = motor(on, { [PASTA]: 'dir' })
  const ui = await $.ui.mount(resposta(`Tudo ficou em \`${PASTA}/\`.`, false))

  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(
    'Tudo ficou em [`/home`](file:///home)[`/gabriel`](file:///home/gabriel)[`/work/`](file:///home/gabriel/work).',
  )
  expect(await ui.find({ type: 'Text', text: '●' })).toBeUndefined()

  await ui.press({ key: CHAVE, link: { href: 'file:///home/gabriel' } })
  expect(rodados[0]?.at(-1)).toBe('/home/gabriel')
  await ui.unmount()
})

test('sem caminho que exista, quem desenha é o Claude Code', async ($, on) => {
  motor(on, {})
  // Nada desenha abaixo do mod num teste: este hook faz as vezes do Claude Code.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>motor</Text>
  })

  const ui = await $.ui.mount(resposta('Veja /home/gabriel/nao-existe.md, e/ou `npm test`.'))
  expect((await ui.find({ type: 'Text', text: /motor/ }))?.text).toBe('motor')
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

test('fora do terminal o mod não mexe', async ($, on) => {
  motor(on, { [GUIA]: 'file' })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>motor</Text>
  })

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...resposta(GUIA), surface })
    expect((await ui.find({ type: 'Text', text: /motor/ }))?.text).toBe('motor')
    await ui.unmount()
  }
})

test('se o caminho sumiu, o clique avisa', async ($, on) => {
  const { avisos } = motor(on, { [GUIA]: 'file' }, 2)
  const ui = await $.ui.mount(resposta(GUIA))

  await ui.press({ key: CHAVE, link: { href: `file://${GUIA}` } })
  expect(avisos).toEqual(['Abrindo guia.md', 'guia.md não existe mais'])
  await ui.unmount()
})

test('num terminal sem link de verdade (o do Bullpen sem FORCE_HYPERLINK), quem desenha é o Claude Code', async ($, on) => {
  motor(on, { [GUIA]: 'file' }, 0, { HOME: '/home/gabriel', TERM: 'xterm-256color' })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>motor</Text>
  })

  const ui = await $.ui.mount(resposta(`O guia está pronto:\n\n${GUIA}\n`))
  expect((await ui.find({ type: 'Text', text: /motor/ }))?.text).toBe('motor')
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

test('o Bullpen com FORCE_HYPERLINK=1 ganha os links', async ($, on) => {
  motor(on, { [GUIA]: 'file' }, 0, { HOME: '/home/gabriel', TERM: 'xterm-256color', FORCE_HYPERLINK: '1' })
  const ui = await $.ui.mount(resposta(GUIA))

  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(LINKS_DO_GUIA)
  await ui.unmount()
})
