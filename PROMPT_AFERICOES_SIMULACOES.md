# PROMPT DE ESPECIFICAÇÃO: ALINHAMENTO DAS MÉTRICAS E MENU DE AFERIÇÕES POR ABAS EM "SIMULAÇÕES" (PADRÃO HISTÓRICO & ANÁLISES)

Você é o engenheiro frontend e de dados responsável pelo sistema **Fila RU**.
Sua tarefa é expandir a interface do módulo **"Simulações"** (`public/simulacoes.html` e `public/simulacoes.js`), implementando o **mesmo menu de navegação por abas de aferições existente em "Histórico & Análises"** (`public/historico.html` e `public/historico.js`), garantindo que o usuário possa inspecionar as métricas do cenário simulado em comparação com o cenário real com o **mesmo nível de profundidade, seções e organização visual por fila**.

---

## 1. OBJETIVO DA FUNCIONALIDADE

Atualmente, o módulo de Simulações exibe os resultados em uma única tabela consolidada e dois gráficos globais.
O objetivo desta tarefa é:
1. **Adicionar o Menu de Aferições por Abas:**
   - Aba **Visão Geral**
   - Abas dinâmicas por fila ativa: **Fila 1 (Entrada → Catraca)**, **Fila 2 (Atendimento → Mesas)** e **Fila 3 (Mesas → Saída)**.
2. **Espelhar as Seções Analíticas de `historico.html`:**
   - Em cada aba de fila, exibir o conjunto completo de indicadores analíticos que o sistema já calcula em `shared/metricas.js`:
     - **Grid de KPIs** (Chegadas $\lambda$, Vazão, Utilização $\rho$, $\mu$, Fila Média $L$, Pico, Tempo de Espera $W_q$, Mediana, P90, P95 e Intervalos $CV$).
     - **Ociosidade e Retenção por Bloqueio de Mesas**.
     - **Validação da Lei de Little ($L = \lambda \cdot W$)** para o cenário simulado vs. real.
     - **Modelo Teórico $M/M/c$ (Erlang C)**.
     - **Tabela de Agregação por Blocos de Tempo (5 min)** com comparativo de passagens reais vs. simuladas.
     - **Gráficos Acumulados da Fila**.
3. **Padrão Comparativo em Todas as Aferições:**
   - Em cada indicador, exibir de forma clara e intuitiva o valor **Real**, o valor **Simulado** e a **Variação ($\Delta\%$)** colorida (verde para melhoria, vermelho para piora).

---

## 2. ESTRUTURA VISUAL E ABAS A IMPLEMENTAR EM `simulacoes.html`

O container de resultados de `public/simulacoes.html` deve adotar a estrutura semântica já estilizada em `public/historico.html`:

```html
<!-- NAVEGAÇÃO POR ABAS: VISÃO GERAL E POR FILA -->
<nav class="tab-nav" id="tab-nav-filas-sim">
  <button class="tab-btn active" id="tab-sim-btn-geral" onclick="SimulacoesApp.selecionarAba('geral')">Visão Geral</button>
  <!-- Abas F1, F2, F3 geradas dinamicamente via JS -->
</nav>

<div id="conteudo-abas-sim">
  <!-- 1. ABA: VISÃO GERAL -->
  <div id="aba-sim-geral">
    <!-- Banner de Calibração e Card de Diagnóstico de Bloqueio -->
    <!-- Cards Resumo das Filas Ativas (Real vs Simulado) -->
    <!-- Card Percurso Completo até as Mesas (F1 + F2) -->
    <!-- Card Percurso Completo até a Saída (F1 + F2 + F3) -->
    <!-- Card Ocupação do Salão e Mesas (216 Lugares) -->
    <!-- Gráficos Comparativos Gerais (Fila no Tempo e Ocupação no Tempo) -->
  </div>

  <!-- 2. ABA: DETALHES DA FILA ESPECÍFICA (F1, F2 ou F3) -->
  <div id="aba-sim-fila-detalhe" style="display:none;">
    <!-- Grid de KPIs da Fila Selecionada (Tríade: Real | Simulado | Variação) -->
    <!-- Card: Lei de Little (L = λ · W) -->
    <!-- Card: Modelo Teórico Erlang C (M/M/c) -->
    <!-- Card: Ociosidade Segmentada & Bloqueio das Mesas -->
    <!-- Card: Agregação por Blocos de Tempo (5 min) comparativa -->
    <!-- Gráfico de Curvas Acumuladas da Fila -->
  </div>
</div>
```

---

## 3. ESPECIFICAÇÃO DETALHADA DAS SEÇÕES POR ABA

### 3.1 Aba "Visão Geral"
Deve conter:
1. **Banner de Calibração do Baseline:** Aderência percentual ($\Delta_{\text{calibracao}} \le 5\%$).
2. **Card Diagnóstico de Gargalos:** Status visual (Verde / Amarelo / Vermelho) indicando se houve *Service Blocking* nas mesas e quantidade de alunos retidos.
3. **Cards Resumo das Filas Ativas:** Card estilizado por fila com cor correspondente (Vermelho para F1, Verde para F2, Rosa para F3), comparando $n_s$, $W_q$ médio e utilização $\rho$.
4. **Card Percurso Completo até as Mesas ($T_{\text{trânsito, mesas}}$):**
   - Comparação Real vs. Simulado do tempo médio, mediana e P90 para chegar da entrada até a mesa.
5. **Card Percurso Completo até a Saída ($T_{\text{trânsito, saída}}$):**
   - Comparação do tempo total desde a calçada até a porta de saída.
6. **Card Ocupação do Salão de Mesas:**
   - Pico de cadeiras ocupadas, porcentagem da capacidade e assentos livres restantes.
7. **Gráficos Gerais Sobrepostos:**
   - Curva de pessoas na fila ao longo do tempo (Fila 1: Real vs. Simulado).
   - Curva de ocupação das mesas ao longo do tempo comparada à capacidade nominal $C_{\text{mesas}}$.

---

### 3.2 Abas Específicas de Fila (Fila 1, Fila 2, Fila 3)

Ao clicar em **"Fila 1 (Entrada → Catraca)"**, **"Fila 2 (Atendimento)"** ou **"Fila 3 (Saída)"**, a interface deve renderizar os dados detalhados da respectiva fila:

#### A. Grid de KPIs com Comparativo Real vs. Simulado
Cada KPI card deve exibir:
- Rótulo da métrica.
- Valor no **Cenário Simulado** (destaque principal).
- Linha de comparação: `Real: X | Dif: ±Y%` com classe semântica `.delta-melhoria` (verde) ou `.delta-piora` (vermelho).
- Indicadores obrigatórios:
  1. **Total Chegadas ($n_e$):** com taxa de chegada $\lambda$ (pessoas/min).
  2. **Total Passagens/Atendimentos ($n_s$):** com vazão operacional e global.
  3. **Fator de Utilização ($\rho$):** com taxa de serviço $\mu$ por servidor e quantidade de postos ativos ($c$).
  4. **Fila Média ($L_q$):** com pico máximo de pessoas na fila.
  5. **Tempo Médio de Espera ($W_q$):** com mediana e desvio padrão.
  6. **Percentis P90 e P95 de Espera.**
  7. **Intervalos entre Atendimentos:** Média em segundos e Coeficiente de Variação ($CV$).

#### B. Card: Lei de Little ($L = \lambda \cdot W$)
- Apresentar o teste de Little calculado sobre o cenário simulado:
  - $L_{\text{observado}}$ simulado.
  - $\lambda \cdot W$ simulado.
  - Diferença percentual e confirmação de consistência matemática do motor de simulação.
  - Comparação com a diferença da sessão real.

#### C. Card: Modelo Teórico $M/M/c$ (Erlang C)
- Avaliar a aplicabilidade da teoria analítica sob a nova configuração ($c$ servidores simulados):
  - Intensidade de tráfego $a = \lambda / \mu$ (Erlangs).
  - Utilização por servidor $\rho = a / c$.
  - $L_q$ teórico calculado pela equação de Erlang C vs. $L_q$ simulado obtido pelo traço.

#### D. Card: Ociosidade & Bloqueio Operacional
- Exibir a decomposição do tempo da fila:
  - Tempo de serviço em operação contínua.
  - Tempo ocioso por ausência de alunos na fila (sem demanda).
  - **Tempo retido por bloqueio de mesas (*Service Blocking*):** Exibir tempo total e número de alunos bloqueados segurando bandejas (especialmente relevante na Fila 2).

#### E. Tabela de Agregação por Blocos de Tempo (Janelas de 5 minutos)
- Tabela temporal dividida em blocos de 5 minutos:
  - Colunas: Bloco | Horário Início - Fim | Chegadas | Passagens Reais | Passagens Simuladas | Variação ($\Delta\%$) | Vazão p/min.
  - Permite visualizar em quais blocos do horário de pico o cenário simulado eliminou o represamento da fila.

#### F. Gráfico de Curvas Acumuladas
- Gráfico Chart.js plotando as curvas acumuladas de Chegadas vs. Passagens Reais vs. Passagens Simuladas para a fila selecionada.

---

## 4. DIRETRIZES DE IMPLEMENTAÇÃO E ARQUITETURA

1. **Reaproveitamento de Dados sem Recálculo Redundante:**
   - A função `simularSessao()` em `shared/simulador.js` já retorna os objetos completos `metricasSimuladas` e `metricasReais` calculados via `calcularMetricas()`.
   - As métricas de cada fila já contêm:
     - `mf.n_chegadas`, `mf.n_atendimentos`, `mf.lambda`, `mf.muPorServidor`, `mf.utilizacao`.
     - `mf.statsEspera` (`media`, `mediana`, `desvioPadrao`, `p90`, `p95`).
     - `mf.filaTempo` (`mediaPonderada`, `max`).
     - `mf.little` (`L_observado`, `L_calculado_lambda_W`, `diffPerc`, `consistente`).
     - `mf.teorico` (modelo Erlang C).
     - `mf.vazaoBlocos` (lista de blocos de 5 min).
   - Basta que `public/simulacoes.js` extraia esses dados já prontos e popule as abas e cards.

2. **Isolamento de Estado e Ciclo de Vida da UI:**
   - Adicionar em `SimulacoesApp` o controle de abas:
     ```javascript
     abaAtual: 'geral',
     selecionarAba(abaId) { ... },
     construirAbasFilas() { ... },
     renderizarAbaGeral() { ... },
     renderizarAbaFila(fNum) { ... }
     ```
   - Destruir instâncias antigas de gráficos Chart.js ao trocar de aba ou reexecutar a simulação para prevenir vazamento de memória.

3. **Consistência de Estilo:**
   - Utilizar as classes nativas já presentes em `public/estilo.css`:
     `.tab-nav`, `.tab-btn`, `.tab-btn.active`, `.kpi-grid-relatorio`, `.hud-stat`, `.delta-melhoria`, `.delta-piora`, `.table-container`.
   - Manter compatibilidade com Dark Mode e regras de impressão `@media print`.

---

## 5. CRITÉRIOS DE ACEITE E VERIFICAÇÃO

- [ ] A interface de Simulações apresenta a barra de abas com botões: **Visão Geral**, **Fila 1**, **Fila 2** e **Fila 3** (conforme as filas ativas da sessão selecionada).
- [ ] A troca entre as abas é fluida e altera o conteúdo sem recarregar a página.
- [ ] A aba Visão Geral exibe os cards de percurso completo ($T_{\text{trânsito}}$), salão de mesas e os dois gráficos sobrepostos.
- [ ] As abas das filas específicas exibem todos os KPIs (chegadas, atendimentos, tempos de espera, Little, Erlang C, ociosidade/bloqueio e blocos de tempo).
- [ ] Todos os indicadores mostram a comparação entre o cenário simulado e o baseline real com o delta percentual colorido.
- [ ] Os testes automatizados em `teste/testes.js` permanecem 100% aprovados sem quebras de regressão.
- [ ] O relatório em PDF (`window.print()`) imprime a aba selecionada em layout limpo e formatado.
