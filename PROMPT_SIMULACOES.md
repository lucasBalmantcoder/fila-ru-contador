# PROMPT DE ESPECIFICAÇÃO: MÓDULO DE SIMULAÇÕES "WHAT-IF" BASEADO EM DADOS REAIS
**Versão:** 2.2 (Consistência de modelagem, tratamento de casos-limite e verificação prévia contra o código)

Você é o engenheiro de software especialista responsável pelo desenvolvimento do sistema **Fila RU** (Node.js nativo, Vanilla JS, Event Sourcing e Teoria das Filas).
Sua tarefa é projetar, implementar e testar o novo módulo e menu **"Simulações"**, permitindo que gestores e pesquisadores executem **Simulações de Eventos Discretos Guiadas por Traço Histórico (*Trace-Driven Discrete-Event Simulation*)** sobre coletas reais gravadas no histórico (`dados/<sessao>/eventos.jsonl`), avaliando cenários hipotéticos (*What-If*) de capacidade, postos de atendimento e velocidade do serviço.

---

## 0. VERIFICAÇÃO PRÉVIA OBRIGATÓRIA (ANTES DE CODIFICAR)

Inspecione `shared/estado.js`, `shared/metricas.js`, `server/server.js` e um `eventos.jsonl` real, e confirme cada item abaixo. Esta especificação **não presume** nenhum deles. Se a realidade divergir, adote o padrão indicado, exiba aviso na interface e registre a divergência no relatório final.

| # | Item a confirmar | Padrão se ausente |
|---|---|---|
| V1 | Tipos de evento de movimentação (esperado: `chegada`, `atendimento`) e demais campos (`seq`, `t`, `fila`, `pessoa`, `encadeado`, `config`) | Adaptar o esquema da Seção 2.1 ao real |
| V2 | Se `pessoa` identifica o aluno individualmente. Se não, parear `chegada` e `atendimento` por ordem FIFO dentro de cada fila | Pareamento FIFO |
| V3 | Em `sessao_iniciada.config`: servidores por fila ($c_{1,\text{real}}$, $c_{2,\text{real}}$), capacidade das mesas, tempo padrão de permanência | $c=1$; 216 cadeiras; 20 min |
| V4 | Valor literal de `meta.status` para sessão encerrada | `'encerrada'` |
| V5 | Existência e formato de `GET /api/sessoes` e `GET /api/sessoes/:id` (resposta `{ meta, eventos }`) | Criar a rota ausente |
| V6 | Como `metricas.js` calcula $\rho$, $T_{\text{trânsito}}$, ocupação das mesas e se exige eventos da Fila 3 | Documentar a divergência |
| V7 | Padrão real dos identificadores de sessão (para o regex da Seção 6.2) | `sessao_YYYY-MM-DDTHH-mm-ss-sssZ_xxxxx` |

---

## 1. OBJETIVO E ESCOPO OPERACIONAL

O módulo deve permitir selecionar uma sessão real finalizada e reexecutar o fluxo dos estudantes sob parâmetros operacionais modificados, respondendo a perguntas centrais de dimensionamento:
1. *"E se adicionássemos uma segunda catraca na entrada ($c_1 = 2$)?"*
2. *"E se aumentássemos a velocidade de distribuição de bandejas/comida na Fila 2 em 20% ou adicionássemos mais uma linha de buffet ($c_2 = 2$)?"*
3. *"E se o tempo médio de permanência dos alunos nas mesas diminuir ou aumentar em 5 minutos?"*
4. *"Ao acelerar a entrada e o atendimento, as mesas do salão atingirão lotação máxima, gerando bloqueio de serviço (*service blocking*) por falta de assentos?"*

O resultado da simulação deve ser submetido diretamente à função pura existente `calcularMetricas()` de `shared/metricas.js`, gerando uma comparação quantitativa entre o **Cenário Real (Baseline)** e o **Cenário Simulado**.

---

## 2. ESQUEMA FORMAL DE EVENTOS E INTEGRAÇÃO COM AS MÉTRICAS

### 2.1 Esquema dos Eventos Simulados
O motor (`shared/simulador.js`) gera eventos em memória aderentes ao contrato consumido por `shared/metricas.js` e `shared/estado.js` (ajustar conforme V1).

```typescript
interface EventoSimulado {
  seq: number;                  // Sequencial monotônico estrito (1, 2, 3...), atribuído após a ordenação final
  t: number;                    // Timestamp simulado em epoch ms
  tipo: 'sessao_iniciada' | 'chegada' | 'atendimento' | 'sessao_encerrada';
  fila?: 1 | 2 | 3;             // Obrigatório em 'chegada' e 'atendimento'
  pessoa?: number;              // Obrigatório em 'chegada' e 'atendimento'; preservado em 1 -> 2 -> 3
  encadeado?: boolean;          // true para chegadas automáticas (F1>F2 na catraca, F2>F3 ao sentar)
  origem: 'simulado';           // Marcação obrigatória
  config?: Record<string, any>; // Presente em 'sessao_iniciada'
}
```

- `sessao_iniciada` reutiliza o `t` e o `config` da sessão real.
- `sessao_encerrada` recebe o maior $t$ entre todos os eventos simulados.

### 2.2 Escopo das Métricas: Comparáveis vs. Excluídas
- **Comparáveis (obrigatórias):**
  - Contagens e vazão: $n_e$ (`M-01`), $n_s$ (`M-02`), Vazão global (`M-11`), Vazão em operação (`M-12`).
  - Taxas e utilização: $\lambda$ (`M-10`), $\mu$ (`M-13`, `M-14`, `M-15`), $\rho$ (`M-16`, $\rho = \frac{\sum t_{\text{ocupado}}}{c \cdot T}$).
  - Tempos de espera: Média $W_q$ (`M-20`), Mediana (`M-21`), Desvio Padrão (`M-22`), P90 (`M-25`) e P95 (`M-26`).
  - Fila: $L_q$ médio ponderado no tempo (`M-40`), Pico (`M-41`).
  - Lei de Little (`M-50` a `M-53`).
  - Trânsito encadeado: até as mesas (`M-86`) e até a saída final (`M-88`).
  - Salão: ocupação média (`M-111`), pico (`M-112`), status de estresse (`M-120`).
- **Excluídas:** anulações e reversões (`M-03`, `M-04`), ajustes manuais (`M-05`), cobertura de operadores e dispositivos/rede (`M-64`, `M-70` a `M-76`).
- **Dependentes da Fila 3:** as métricas de mesas e de trânsito até as mesas/saída final só têm coluna "Real" se a Fila 3 foi monitorada (ver Seção 7.3).

---

## 3. METODOLOGIA DE SIMULAÇÃO DE EVENTOS DISCRETOS (DES)

### 3.1 Traço Histórico Fixo
O vetor de instantes de chegada à Fila 1, $\{t_{\text{chegada,F1}}(i)\}$, é extraído dos eventos reais e preservado integralmente (curva de demanda e intervalos entre chegadas).

### 3.2 Extração e Escalonamento dos Tempos de Serviço Puro
No registro real, `chegada` marca o ingresso na fila e `atendimento` marca a liberação no posto. A diferença $t_{\text{atendimento}} - t_{\text{chegada}}$ inclui a espera ($W_q + S$). O serviço puro deve ser reconstruído para não contar a espera duas vezes.

**Reconstrução do serviço puro (Filas 1 e 2), válida para qualquer $c_{\text{real}}$:**
1. Ordenar os alunos por $t_{\text{chegada}}$ (desempate por `pessoa`).
2. Manter um *min-heap* $H$ com $c_{\text{real}}$ valores, inicializados com o instante de início da sessão.
3. Para cada aluno $i$: $t_{\text{livre}} = \text{extrairMin}(H)$; $t_{\text{ini\_serv}}(i) = \max(t_{\text{chegada}}(i), t_{\text{livre}})$; $S(i) = t_{\text{atendimento}}(i) - t_{\text{ini\_serv}}(i)$; inserir $t_{\text{atendimento}}(i)$ em $H$. Se $i$ não tiver `atendimento` (residual), reinserir $t_{\text{livre}}$.
4. Para $c_{\text{real}} = 1$ isto equivale a $t_{\text{ini\_serv}}(i) = \max(t_{\text{chegada}}(i), t_{\text{atendimento}}(i-1))$.
5. Para $c_{\text{real}} > 1$ a reconstrução é uma **aproximação** (não se sabe qual posto atendeu cada aluno); exibir aviso na interface (Seção 5).

Para a Fila 2, $t_{\text{chegada,F2}}(i) = t_{\text{atendimento,F1}}(i)$ observado.

**Valores inválidos e residuais:** se $S(i) \le 0$ ou o aluno não tiver `atendimento` na fila, atribuir $\tilde{S}$, a mediana dos $S > 0$ da mesma fila na sessão. Se não houver nenhum $S > 0$, a sessão é tratada como "Dados Insuficientes".

**Duração simulada com piso que preserva o baseline:**
- $S_{1,\text{sim}}(i) = \max\big(S_1(i) \cdot f_1,\ \min(2000, S_1(i))\big)$ ms
- $S_{2,\text{sim}}(i) = \max\big(S_2(i) \cdot f_2,\ \min(3000, S_2(i))\big)$ ms

O piso só atua quando o fator reduz o tempo; com $f = 1$ o tempo observado é mantido (requisito do teste de baseline).

**Permanência nas mesas:**
- $S_{\text{mesas}}(i) = t_{\text{atendimento,F3}}(i) - t_{\text{chegada,F3}}(i)$ observado. Se a Fila 3 não foi monitorada, ou o aluno é residual na Fila 3, usar o tempo padrão da sessão (padrão: 20 min).
- $S_{\text{mesas,sim}}(i) = \max\big(S_{\text{mesas}}(i) + \Delta t_{\text{mesas}},\ \min(60000, S_{\text{mesas}}(i))\big)$ ms. Piso de 1 minuto para reduções; com $\Delta t = 0$ o valor observado é mantido.

### 3.3 Disciplina de Fila com Múltiplos Servidores ($c > 1$)
Aplica-se às Filas 1 e 2: **fila única compartilhada FIFO com despacho paralelo ($M/G/c$)**.
- Cada servidor $k$ possui $\text{tempoLivre}_k$. O próximo aluno vai ao servidor $k^* = \arg\min_k \text{tempoLivre}_k$ (empate: menor $k$).
- $t_{\text{inicio}} = \max(t_{\text{chegada}}, \text{tempoLivre}_{k^*})$; $t_{\text{conclusao}} = t_{\text{inicio}} + S_{\text{sim}}(i)$.
- Implementar com fila de eventos ordenada (*heap*), não com laço sequencial por aluno, pois com $c_2 > 1$ e bloqueio os alunos podem concluir fora da ordem de chegada.

### 3.4 Encadeamento entre Filas e Buffer da Fila 2
- $t_{\text{chegada,F2}}(i) = t_{\text{atendimento,F1}}(i)$, com `encadeado: true`, mesma `pessoa` e `origem: 'simulado'`.
- **A Fila 2 possui buffer ilimitado.** A catraca nunca é bloqueada pela Fila 2 nem pelo salão. Consequência: $W_{q1}$ simulado depende apenas de $c_1$ e de $f_1$ (ou do tempo fixo).
- A transição Fila 2 → Fila 3 segue a Seção 3.5.

### 3.5 Bloqueio por Falta de Assentos (*Service Blocking*)
1. $C_{\text{mesas}}$ vem da configuração da sessão (padrão 216) ou do parâmetro de simulação.
2. Ao concluir o preparo em $t_{\text{fim\_preparo}} = t_{\text{inicio,F2}}(i) + S_{2,\text{sim}}(i)$:
   - **Se $\text{cadeirasOcupadas} < C_{\text{mesas}}$:** o aluno senta; os eventos `atendimento` (F2) e `chegada` (F3, `encadeado: true`) recebem $t = t_{\text{fim\_preparo}}$; o posto é liberado.
   - **Se $\text{cadeirasOcupadas} = C_{\text{mesas}}$:** ocorre bloqueio. O aluno aguarda com a bandeja até $t_{\text{desocupacao}}$ (próxima liberação de cadeira); os eventos `atendimento` (F2) e `chegada` (F3) recebem $t = t_{\text{desocupacao}}$; o posto $k^*$ permanece ocupado até esse instante.
3. **Ordem de liberação:** com vários postos bloqueados, as cadeiras liberadas são concedidas em FIFO por $t_{\text{fim\_preparo}}$ (desempate: menor `pessoa`).
4. **Efeito sobre as métricas:** o tempo de bloqueio integra o tempo de ocupação do posto da Fila 2 (afeta $\rho_2$) e o intervalo entre `chegada` e `atendimento` na Fila 2. O bloqueio **não** propaga para a Fila 1 (Seção 3.4); seu efeito aparece em $W_{q2}$, $L_{q2}$ e $T_{\text{trânsito}}$.
5. **Diagnósticos próprios do simulador** (não vêm de `calcularMetricas()`): `tempoSaturacaoMs` (tempo com $\text{cadeirasOcupadas} = C_{\text{mesas}}$), `instantePrimeiraSaturacaoMs`, `nBloqueados`, `bloqueioTotalMs`, `bloqueioMaxMs`.

### 3.6 Ordem de Eventos Simultâneos
Para eventos com o mesmo $t$, a ordem é: (1) `atendimento` da Fila 3 (libera cadeira); (2) `atendimento` da Fila 2 e `chegada` encadeada na Fila 3; (3) `atendimento` da Fila 1 e `chegada` encadeada na Fila 2; (4) `chegada` externa na Fila 1. Desempate final por `pessoa` crescente. O `seq` é atribuído somente após a ordenação.

### 3.7 Determinismo
- Simulação 100% determinística: mesma sessão e mesmos parâmetros produzem resultado idêntico.
- Não há sorteios nem estado oculto. A assinatura **não possui** parâmetro de semente. Qualquer extensão estocástica futura deve introduzir uma semente obrigatória, exibida no relatório.

---

## 4. SEMÂNTICA E PRECEDÊNCIA DOS PARÂMETROS "WHAT-IF"

Interface de `paramsSimulacao`:
```javascript
{
  c1: 1..4,
  modoVelocidadeF1: 'taxa' | 'fixo',
  deltaTaxaF1: -50..100,        // %
  tempoFixoF1: 2..30,           // s
  c2: 1..3,
  deltaTaxaF2: -50..100,        // %
  capacidadeMesas: number,      // padrão: da sessão
  deltaPermanenciaMin: -10..15  // minutos inteiros
}
```

### 4.1 Fila 1 (Entrada / Catraca)
- **Servidores ($c_1$):** 1 a 4 (padrão: $c_{1,\text{real}}$).
- **Ajuste de velocidade (radio button, mutuamente exclusivo):**
  - *Modo Taxa:* $f_1 = \frac{1}{1 + \Delta\%/100}$ ($+100\%$ → $f_1 = 0{,}5$; $-50\%$ → $f_1 = 2{,}0$). Preserva a variabilidade individual.
  - *Modo Tempo Fixo:* $S_{1,\text{sim}}(i) = T_{\text{fixo}}$ para todos os alunos, eliminando a variância individual.

### 4.2 Fila 2 (Atendimento / Buffet)
- **Servidores ($c_2$):** 1 a 3 (padrão: $c_{2,\text{real}}$).
- **Velocidade:** $f_2 = \frac{1}{1 + \Delta\%/100}$, com $\Delta\%$ de $-50\%$ a $+100\%$.

### 4.3 Salão e Mesas
- **Capacidade ($C_{\text{mesas}}$):** campo numérico inicializado com o valor da sessão (padrão 216).
- **Permanência:** ajuste aditivo $\Delta t_{\text{mesas}}$ de $-10$ a $+15$ min. Não existe fator multiplicativo de permanência.

---

## 5. PREMISSAS E LIMITAÇÕES DO MODELO

A documentação e a interface devem exibir, de forma resumida:
1. **Demanda inelástica:** chegadas nos instantes históricos; sem desistência (*no balking/reneging*).
2. **Tempos vinculados ao traço:** serviços individuais observados, escalados pelos fatores escolhidos.
3. **Disciplina estrita:** fila única FIFO, sem ultrapassagens.
4. **Buffer ilimitado na Fila 2:** a lotação do salão não bloqueia a catraca.
5. **Alunos residuais:** alunos sem `atendimento` em alguma fila são simulados como atendidos, com tempo mediano (Filas 1 e 2) ou tempo padrão (mesas). Por isso $n_s$ simulado pode exceder o real.
6. **Reconstrução aproximada** dos tempos de serviço quando $c_{\text{real}} > 1$ (aviso condicional).

---

## 6. ARQUITETURA DE SOFTWARE E SEGURANÇA

### 6.1 Motor Isomórfico (`shared/simulador.js`)
- Módulo ES puro, sem dependência de DOM nem de Node.js.
- Assinatura obrigatória:
  ```javascript
  export function simularSessao(eventosReais, configSessao, paramsSimulacao)
  // retorna { eventos: EventoSimulado[], diagnosticos: {...}, avisos: string[] }
  ```
- **Proibida** a gravação de eventos simulados em `dados/`. Tudo permanece em memória no navegador.

### 6.2 Prevenção de Path Traversal
Validar `sessaoId` em `server/server.js` contra o padrão confirmado em V7:
```javascript
if (!/^[a-zA-Z0-9_\-]+$/.test(sessaoId)) {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ erro: 'Identificador de sessão inválido.' }));
  return;
}
```

### 6.3 Dependências Locais e Exportação
- **Gráficos:** exclusivamente `public/lib/chart.umd.min.js`. Proibido usar CDN.
- **PDF:** botão que chama `window.print()`, com regras `@media print` em `public/estilo.css`.
- **CSV (compatível com Excel):** UTF-8 com BOM, separador `;`, vírgula decimal. Dois botões: "Exportar comparação (CSV)" (tabela da Seção 7.3) e "Exportar eventos simulados (CSV)" (`seq;t;tipo;fila;pessoa;encadeado`).

---

## 7. INTERFACE DO USUÁRIO (UI/UX)

### 7.1 Navegação Global
- Link **"Simulações"** (`<a href="simulacoes.html">Simulações</a>`) em `public/painel.html` e `public/historico.html`.
- Criar `public/simulacoes.html` (com a mesma barra e classe `.active`) e `public/simulacoes.js`.
- O servidor deve servir `simulacoes.html` (rota `/simulacoes` ou estática, conforme o padrão existente).

### 7.2 Estados da Interface
- **Sessão válida:** `meta.status` igual ao valor confirmado em V4 e ao menos 5 atendimentos registrados. O seletor lista data, nome e quantidade de alunos atendidos.
- **Dados insuficientes:** menos de 5 atendimentos, status ativo ou ausência de $S > 0$: exibir *"Esta sessão não possui dados suficientes para simulação."*
- **Carregamento:** indicador visual durante a busca da sessão e o processamento.
- **Erro:** mensagem textual para falha de rede ou resposta inválida.
- **Avisos:** exibir os `avisos` retornados pelo motor (por exemplo, $c_{\text{real}} > 1$, Fila 3 não monitorada, valores padrão adotados).
- **Padrão visual:** consistência com `estilo.css`; sem emojis; usar badges com classes de status (`badge-success`, `badge-warning`, `badge-danger`).

### 7.3 Painel de Resultados
1. **Banner de calibração do baseline:**
   - $\Delta_{\text{calibracao}} = \frac{|W_{q1,\text{sim}}(\text{parâmetros reais}) - W_{q1,\text{real}}|}{W_{q1,\text{real}}} \times 100\%$; se $W_{q1,\text{real}} = 0$, exibir "não aplicável".
   - $\le 5\%$: indicador aderente (exemplo ilustrativo: *"Calibração: desvio de 1,8%"*). $> 5\%$: aviso âmbar sobre variações operacionais do traço (atendimento não-FIFO, pausas manuais). Nunca bloqueia a execução.
2. **Diagnóstico de gargalos:** texto direto com `tempoSaturacaoMs`, `nBloqueados`, `bloqueioTotalMs` e se as mesas atingiram lotação.
3. **Tabela comparativa (Métrica | Real | Simulado | $\Delta\%$):** $W_{q1}$ (média, mediana, P95), $W_{q2}$, $T_{\text{trânsito}}$, $\rho_1$, $\rho_2$, pico de fila, pico de ocupação das mesas.
   - $\Delta\%$ em verde quando melhora e vermelho quando piora (menor é melhor para esperas, filas, trânsito e ocupação de pico). $\rho$ é exibido sem cor.
   - Se a Fila 3 não foi monitorada, as linhas dependentes dela mostram "—" na coluna Real e nota explicativa.
4. **Gráficos sobrepostos (Chart.js):**
   - Alunos aguardando na fila ao longo do tempo (azul: Real; verde: Simulada).
   - Assentos ocupados ao longo do tempo, com linha horizontal da capacidade; a série "Real" é omitida se a Fila 3 não foi monitorada.
5. **Execução:** botão "Executar Simulação"; o resultado deve aparecer sem travar a interface.

---

## 8. CRITÉRIOS DE ACEITE E TESTES AUTOMATIZADOS

Adicionar a `teste/testes.js`:

1. **Conservação de massa:** número de `chegada` na Fila 1 simulado igual ao real; todo aluno simulado possui `chegada` e `atendimento` nas três filas.
2. **Baseline (tolerância $\le 5\%$):** em sessão sintética FIFO com $c_{\text{real}} = 1$, parâmetros reais e $f = 1$ reproduzem $W_{q1}$ com diferença $\le 5\%$. Repetir com $c_{\text{real}} = 2$ para validar a reconstrução por *heap*.
3. **Monotonicidade não estrita:** $W_{q1}(c_1+1) \le W_{q1}(c_1)$ e $W_{q2}(c_2+1) \le W_{q2}(c_2)$.
4. **Independência da catraca:** $W_{q1}$ simulado não muda ao variar $c_2$, $f_2$ ou $C_{\text{mesas}}$ (Seção 3.4).
5. **Capacidade das mesas:** $\text{cadeirasOcupadas}(t) \le C_{\text{mesas}}$ para todo $t$.
6. **Bloqueio:** com $C_{\text{mesas}} = 2$ e refeição de 10 min, `atendimento` da Fila 2 é retido, `bloqueioTotalMs > 0` e o valor confere com o cálculo manual do cenário.
7. **FIFO por servidor:** em cada servidor, os alunos iniciam o atendimento na ordem de chegada.
8. **Determinismo:** `JSON.stringify(r1) === JSON.stringify(r2)` para duas execuções idênticas.
9. **Piso:** com $f = 1$ e $\Delta t = 0$, os tempos observados são mantidos mesmo abaixo dos pisos; com redução, os pisos de 2 s, 3 s e 60 s são respeitados.
10. **Casos extremos:** sessão vazia (sem exceção); um único aluno ($W_q = 0$); chegadas simultâneas e eventos simultâneos (ordem da Seção 3.6); alunos residuais nas Filas 1, 2 e 3; Fila 3 não monitorada (usa tempo padrão e emite aviso).
11. **Desempenho:** simulação de 5.000 chegadas em **menos de 500 ms**. Medir e reportar também o tempo de `calcularMetricas()` sobre o resultado, sem alterá-lo.
12. **Não regressão:** todos os testes existentes continuam 100% aprovados.

---

## 9. INSTRUÇÕES PARA O AGENTE EXECUTOR

1. **Ordem de trabalho:** executar a Seção 0, depois implementar e testar.
2. **Integridade de arquivos:** entregar arquivos completos e funcionais (`shared/simulador.js`, `public/simulacoes.html`, `public/simulacoes.js`, `public/estilo.css`, `server/server.js`, `teste/testes.js`), sem trechos abreviados.
3. **Núcleo imutável:** é proibido alterar `shared/metricas.js` e `shared/estado.js`.
4. **Validação final:** executar `node teste/testes.js`, confirmar 100% de aprovação e informar a contagem exata.
5. **Relatório final:** listar os resultados da Seção 0 (V1 a V7), as divergências encontradas, os padrões adotados e o desempenho medido.
6. **Versionamento:** atualizar `CHANGELOG.md` na seção `[Não lançado]` e registrar o commit no padrão do projeto:
   `pu: implementa modulo de simulacoes what-if com trace-driven simulation`
