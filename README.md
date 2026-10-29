# caminhos: clique no caminho e abra no PC

Mod do Claude Code (feito na 2.1.312) que deixa clicáveis os caminhos que o Claude escreve nas respostas. Cada
pedaço do caminho é um link para o caminho até ele: em `~/projetos/loja/qa/relatorio.md`, clicar em `loja` abre
essa pasta no gerenciador de arquivos, e clicar em `relatorio.md` abre o arquivo no app padrão.

- **Clique simples:** abre. Arquivo vai para o app padrão do tipo dele, pasta vai para o gerenciador de arquivos
  (pelo `xdg-open`; no macOS, `open`). Um aviso "Abrindo …" aparece no canto.
- **Mouse por cima:** o pedaço que vai abrir fica sublinhado.
- **Ctrl+clique:** continua com o Claude Code e o terminal, como antes.

![Uma resposta do Claude com o caminho ~/projetos/loja/qa/relatorio.md: o mouse passa por /loja, /qa e /relatorio.md e cada pedaço fica sublinhado; o clique no arquivo abre o relatório num leitor de Markdown e o clique em /qa abre a pasta no gerenciador de arquivos](docs/caminhos.webp)

<sub>As telas são de um Claude Code de verdade (2.1.312, com o Haiku), com o mod instalado. A resposta, o sublinhado
de cada pedaço e os avisos "Abrindo …" foram gravados com um mouse de verdade, movido pelo GNOME numa tela sem
monitor. A pasta `loja` e o relatório são fictícios, e as janelas que abrem são ilustrações feitas no PhotoCraft (na
gravação, o `xdg-open` só anotava o caminho). O cursor, o anel do clique, as legendas e os cortes são da montagem no
EffectCraft.</sub>

## O que vira link

- caminho solto: absoluto (`/home/...`), na pasta pessoal (`~/...`) ou relativo com barra (`hooks/register.tsx`,
  a partir da pasta da sessão), com ou sem `:linha` no fim;
- caminho entre crases;
- o endereço de um link markdown que aponta para um caminho (`[o guia](/home/...)`), que vira um link só.

Só vira link o que existe no disco quando a resposta é desenhada. Ficam de fora os blocos de código (```), os
endereços da web e as palavras com barra que não são caminho (`e/ou`, `29/10/2026`).

## Onde funciona

No terminal, com o Claude Code em tela cheia (`"tui": "fullscreen"`), que é quando ele recebe o clique do mouse.
Testado com clique de verdade num kitty. No Ptyxis e no terminal dos agentes do Bullpen (xterm.js), o clique passa
pelo mesmo caminho dentro do Claude Code. Fora da tela cheia os links continuam lá e quem abre é o terminal (no
Ptyxis, Ctrl+clique). Desktop, VS Code e celular ficam como estão.

Com a janela do terminal sem foco, o primeiro clique só traz a janela para frente: o Claude Code ignora esse clique
de propósito. Clique de novo.

## Como funciona, e os limites

O Claude Code desenha cada parte de uma resposta pelo site `AssistantMessage`. Quando o texto tem um caminho que
existe, o mod desenha a parte ele mesmo, como o Claude Code desenha (o `●` na primeira linha e o texto ao lado),
com um `Markdown` do mod em que cada pedaço do caminho é um link `file://`. O clique simples num desses links chega
ao mod (`onLinkPress`), que roda o `xdg-open` com `setsid`, para o app não fechar junto com o terminal. Resposta sem
caminho fica com o desenho do próprio Claude Code.

Nas partes que o mod desenha:

- link com esquema que não seja `https`, `http` ou `file` (`vscode://`, `slack://`) aparece como texto;
- a configuração `maxProseWidth` não vale;
- o `●` entra na seleção do mouse.

## Instalar

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install caminhos --marketplace GabrielPauloT/caminhos-claude
```

Ele pergunta se pode adicionar o marketplace (responda `y`) e depois o escopo (o de usuário vem primeiro; Enter
escolhe). Pelo shell:

```sh
claude plugin install caminhos --marketplace GabrielPauloT/caminhos-claude
```

No app desktop, onde o `/plugin` não roda: clique no **+** ao lado da caixa do prompt, depois em **Plugins**,
**Add marketplace** com `GabrielPauloT/caminhos-claude` e então **Add plugin**. (O mod só desenha no terminal.)

Para desinstalar: `claude plugin uninstall caminhos@caminhos-claude`.

## Como mexer

| Arquivo | O quê |
| --- | --- |
| `hooks/register.tsx` | o hook do desenho, a conferência no disco (com cache) e o abrir |
| `hooks/caminhos.ts` | funções puras: achar os caminhos, partir em pedaços, montar os links |
| `tests/` | os testes |
| `e2e/` | o teste com clique de verdade |

Antes de recarregar:

```sh
claude plugin validate ~/projetos/caminhos-claude
claude plugin test ~/projetos/caminhos-claude
node ~/projetos/pixel-agents-linux/node_modules/typescript/bin/tsc -p ~/projetos/caminhos-claude
```

O teste com clique de verdade (gasta um turno do Haiku e não aparece na tela):

```sh
~/projetos/caminhos-claude/e2e/rodar.sh
```

Ele sobe um GNOME sem tela, abre um kitty com um Claude Code carregando o mod desta pasta, pede uma resposta com
um arquivo e uma pasta, e clica com um ponteiro virtual em quatro pedaços. Um `xdg-open` falso anota o que o mod
mandou abrir, e cada clique tem de abrir exatamente o caminho até o pedaço clicado.

## Instalar de uma pasta local

```sh
claude plugin marketplace add ~/projetos/caminhos-claude
claude plugin install caminhos@caminhos-claude --scope user
claude plugin uninstall caminhos@caminhos-claude
```

Instalado assim, o Claude Code lê os arquivos desta pasta. Depois de editar, rode `/reload-plugins` na sessão e em
cada agente do Bullpen (ou reinicie os agentes).
