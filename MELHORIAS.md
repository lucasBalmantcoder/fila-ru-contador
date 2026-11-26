# Possíveis Melhorias — Projeto Fila RU

Documento gerado a partir de revisão de código do projeto (versão `4.6.1`, suíte `npm test` com 203 testes aprovados).  
Os itens abaixo estão organizados por prioridade e área.

---

## 1. Prioridade Alta — Bugs e Comportamentos Inconsistentes

### 1.1. Canvas congelado quando a simulação está pausada (`simulador_ru_alternativo.html`)
* **Onde:** `simulador_ru_alternativo.html` (`onScrub`, `atualizarParametros`, `resizeCanvas`).
* **Problema:** `renderizarCanvas()` só é chamado dentro de `animarLoop()` e na carga inicial da página. Ao arrastar o slider de tempo (`onScrub`), alterar parâmetros (`atualizarParametros`) ou redimensionar a janela (`resizeCanvas`) com a simulação pausada, o canvas não é atualizado.
* **Melhoria:** Chamar `renderizarCanvas()` ao final de `onScrub()`, `atualizarParametros()` e `resizeCanvas()`.

### 1.2. Uso de `event` implícito em `carregarPreset` (`simulador_ru_alternativo.html`)
* **Onde:** `simulador_ru_alternativo.html` (linha ~664).
* **Problema:** `event.target.classList.add('active')` depende da variável global legada `window.event`, pois `event` não é passado como parâmetro no `onclick`. Chamadas programáticas falham com `ReferenceError`.
* **Melhoria:** Passar `this` no HTML (`onclick="carregarPreset('baseline', this)"`) e receber `(tipo, el)` na função, como já é feito em `setVelocidade(v, el)`.

### 1.3. Gráficos fora de ordem ao voltar no tempo (`simulador_ru_alternativo.html`)
* **Onde:** `simulador_ru_alternativo.html` (`atualizarInterface`, linhas ~812–827).
* **Problema:** `historicoTempo` e os datasets do Chart.js só recebem `push()` quando `t - ultimo >= 25`. Se o usuário retroceder o scrubber (`onScrub`) e retomar a reprodução, novos pontos são adicionados ao final do gráfico fora de ordem cronológica.
* **Melhoria:** Pré-computar a série amostrada em `resolverTimelineDiscreta()` e apenas fatiar/exibir até `t`, ou limpar os pontos posteriores a `t` quando houver retrocesso no scrubber.

### 1.4. Contador de total de alunos fixo no HTML (`simulador_ru_alternativo.html`)
* **Onde:** `simulador_ru_alternativo.html` (linha ~358).
* **Problema:** O subtítulo do KPI "Total Atendidos" exibe `de 192 alunos` fixo no HTML, mesmo quando `slider-demanda` altera o tamanho da coorte simulada.
* **Melhoria:** Atualizar dinamicamente o total de alunos exibido com base em `SimState.alunos.length`.

### 1.5. Parse de URL sem tratamento de erro no servidor HTTP (`server/server.js`)
* **Onde:** `server/server.js` (linhas 51–53).
* **Problema:** `new URL(req.url, \`http://${req.headers.host}\`)` e `decodeURIComponent(urlParsed.pathname)` podem lançar exceções não tratadas se `Host` estiver ausente/malformado ou houver sequência `%` inválida na URL, encerrando o processo Node.
* **Melhoria:** Envolver o parse da URL em `try/catch` e responder `400 Bad Request` em caso de falha.

### 1.6. `transmitirParaPainel` envia mensagens para todos os clientes (`server/server.js`)
* **Onde:** `server/server.js` (linhas 941–948).
* **Problema:** A implementação de `transmitirParaPainel(objetoMsg)` é idêntica à de `transmitirParaTodos`, não filtrando `disp.papel === 'painel'`. Celulares acabam recebendo eventos de `lista_aparelhos` e `comando_rejeitado` desnecessariamente.
* **Melhoria:** Filtrar `disp.autenticado && disp.papel === 'painel' && ws.readyState === WebSocket.OPEN`.

---

## 2. Prioridade Média — Segurança e Robustez

### 2.1. Endpoints administrativos sem validação de origem local ou autenticação (`server/server.js`)
* **Onde:** `server/server.js` (linhas 305–352 e 484–533).
* **Problema:** Enquanto `/api/config/pin` exige `ehOrigemLocal(req)`, os endpoints `POST /api/sessoes/:id/excluir`, `renomear`, `editar` e `/api/sessoes/importar` aceitam requisições de qualquer origem (combinado com `Access-Control-Allow-Origin: *`).
* **Melhoria:** Restringir operações destrutivas e de edição de sessões a `ehOrigemLocal(req)` (ou exigir autenticação via PIN).

### 2.2. Leitura de body HTTP sem limite de tamanho e sem tratamento de erro (`server/server.js`)
* **Onde:** `server/server.js` (linhas 229–231, 320–322, 338–340, 485–487).
* **Problema:** Os endpoints `POST` concatenam `body += chunk` sem limite máximo de bytes e sem listener `req.on('error')`, além de repetirem o mesmo boilerplate.
* **Melhoria:** Extrair um helper único `lerJsonBody(req, maxBytes)` com limite configurável (ex.: 5 MB para importação, 64 KB para demais rotas) e tratamento de `error`.

### 2.3. Risco de XSS / quebra de HTML via `innerHTML` (`public/historico.js`, `public/celular.js`)
* **Onde:** `public/historico.js` (linha 157) e `public/celular.js` (linha 459), entre outros trechos com template strings em `innerHTML`.
* **Problema:** Nomes de sessão, observações ou nomes de dispositivos inseridos diretamente em `innerHTML` podem quebrar o layout ou executar scripts se contiverem `<`, `>` ou aspas.
* **Melhoria:** Usar `textContent` para textos dinâmicos ou aplicar uma função de escape HTML antes de interpolar.

### 2.4. Geração de IDs com `Math.random()` (`server/server.js`, `server/sessao.js`)
* **Onde:** `server/server.js` (linha 573) e `server/sessao.js` (linha 134).
* **Melhoria:** Substituir `Math.random().toString(36)` por `crypto.randomUUID()` ou `crypto.randomBytes()` nativos do Node.js.

---

## 3. Prioridade Média/Baixa — Arquitetura, Performance e Manutenibilidade

### 3.1. Dependência de CDN externa e lógica duplicada (`simulador_ru_alternativo.html`)
* **Onde:** `simulador_ru_alternativo.html` (linha 7 e linhas 399–615).
* **Problema:** Carrega `chart.js` de `cdn.jsdelivr.net`, falhando em ambiente offline/hotspot local, mesmo o projeto já possuindo `public/lib/chart.umd.min.js`. Também duplica a lógica de simulação e embute `DADOS_REAIS` manualmente em vez de reutilizar `shared/simulador.js`.
* **Melhoria:** Apontar para `public/lib/chart.umd.min.js` (ou mover para `public/` e servir via servidor) e integrar com `shared/simulador.js`.

### 3.2. Reprocessamento $O(N)$ do log de eventos a cada comando (`server/sessao.js`)
* **Onde:** `server/sessao.js` (`processarComando`, linha 419 e demais chamadas a `derivarEstado`).
* **Problema:** A cada evento recebido, `derivarEstado(this.sessaoAtiva.eventos, Infinity, ...)` reprocessa todos os eventos desde o início, combinado com `fs.appendFileSync` síncrono. Em sessões longas, o custo por evento cresce linearmente ($O(N^2)$ no acumulado).
* **Melhoria:** Atualizar o estado em memória de forma incremental no `processarComando` (mantendo `derivarEstado` para replay, testes e retomada do disco) e considerar escrita assíncrona em stream/fila.

### 3.3. Geração repetida de 4 QR Codes por requisição (`server/server.js`)
* **Onde:** `server/server.js` (`/api/info`, linhas 130–133).
* **Problema:** Os 4 QR codes são gerados sequencialmente com `await` a cada `GET /api/info`.
* **Melhoria:** Gerar em paralelo com `Promise.all` e cachear os DataURLs enquanto `ipPreferido` e `PORTA` não mudarem.

### 3.4. Versão hardcoded dessincronizada (`server/server.js`)
* **Onde:** `server/server.js` (linha 144) vs `package.json` (linha 3).
* **Problema:** `/api/info` retorna `versao: '4.6.0'`, enquanto `package.json` está em `4.6.1`.
* **Melhoria:** Ler a versão diretamente do `package.json` na inicialização do servidor.

### 3.5. Padrões de código e modularização
* **Monkey-patch em `Set` (`server/sessao.js`, linhas 15–19):** `criarSetFilasDesativadas` adiciona `.includes()` em uma instância de `Set`. Padronizar com `.has()` torna o código mais previsível.
* **Lookup de histórico em reversão (`shared/estado.js`, linha 210):** `historicoAtendimentos.map(h => h.pessoa).lastIndexOf(pId)` cria um array intermediário inteiro; um loop reverso ou `findLastIndex` evita alocação.
* **Cache de interfaces de rede (`server/rede.js`, linhas 62–83):** `ehOrigemLocal(req)` consulta `os.networkInterfaces()` a cada chamada; pode ser cacheado por alguns segundos.
* **Modularização:** `server/server.js` (1119 linhas), `server/sessao.js` (1126 linhas) e `public/historico.js` (~67 KB) concentram múltiplas responsabilidades e se beneficiariam de separação em módulos menores (ex.: rotas HTTP, handlers WS, exportação CSV).
