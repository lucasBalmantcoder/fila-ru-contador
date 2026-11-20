# PROMPT DE ESPECIFICAÇÃO: MÓDULO DE SIMULAÇÕES "WHAT-IF" BASEADO EM DADOS REAIS

Você é o engenheiro especialista responsável pelo desenvolvimento do sistema **Fila RU** (Node.js nativo, Vanilla JS, Event Sourcing e Teoria das Filas).
Sua tarefa é projetar e implementar o novo módulo/menu **"Simulações"**, permitindo que pesquisadores e gestores do RU realizem simulações de cenários hipotéticos (*What-If Scenarios*) utilizando os dados reais de sessões já coletadas para prever os impactos de mudanças físicas e operacionais no atendimento.

---

## 1. OBJETIVO DO MÓDULO

Permitir que o usuário selecione uma sessão real gravada no histórico (`dados/<sessao>/eventos.jsonl`) e execute uma **Simulação Guiada por Traço Histórico (*Trace-Driven Discrete-Event Simulation*)**, alterando parâmetros operacionais para responder perguntas como:
- *"E se adicionássemos uma segunda catraca na entrada?"*
- *"E se duplicássemos a linha de distribuição de bandejas/comida ou acelerássemos o serviço em 20%?"*
- *"E se o tempo médio de permanência dos alunos nas mesas diminuísse ou aumentasse em 5 minutos?"*
- *"Ao acelerar a entrada, as mesas vão lotar e virar o novo gargalo?"*

Ao final da simulação, o sistema deve processar o log de eventos simulados através do motor existente `shared/metricas.js`, gerando uma **comparação lado a lado (Cenário Real vs. Cenário Simulado)** com todas as métricas oficiais do sistema (`M-01` a `M-122`).

---

## 2. ARQUITETURA E METODOLOGIA CIENTÍFICA

### 2.1 Simulação Guiada por Traço (Trace-Driven)
Em vez de gerar chegadas aleatórias puramente teóricas (ex: Poisson puro), a simulação utiliza o **vetor exato de timestamps empíricos de chegada dos alunos** registrados na coleta real. Apenas os tempos de passagem pelos servidores, atendimento e permanência nas mesas são recalculados de acordo com os parâmetros configurados pelo usuário.

### 2.2 Preservação do Isomorfismo e Reaproveitamento de Código
- O motor de simulação deve ser implementado no arquivo isomórfico `shared/simulador.js` (executável tanto no navegador quanto no Node.js).
- O resultado da simulação deve ser um array de eventos no formato idêntico ao do sistema real (`eventos.jsonl`).
- O cálculo dos indicadores finais deve reutilizar diretamente a função pura `calcularMetricas()` de `shared/metricas.js`.

---

## 3. PARÂMETROS DE CONTROLE DA SIMULAÇÃO (WHAT-IF)

A interface de simulação deve fornecer controles intuitivos (sliders numéricos e inputs) organizados por setor:

### Setor 1: Fila 1 (Entrada / Catraca)
- **Número de Catracas ($c_1$):** Seleção de 1 a 4 catracas (padrão: valor da sessão original, normalmente 1).
- **Aceleração da Taxa de Validação na Catraca:** Ajuste percentual ($-50\%$ a $+100\%$) ou tempo de passagem fixo em segundos.

### Setor 2: Fila 2 (Atendimento / Buffet / Bandejas)
- **Número de Postos/Linhas de Serviço ($c_2$):** Seleção de 1 a 3 linhas de distribuição de comida.
- **Eficiência/Velocidade de Serviço ($\mu_2$):** Fator de aceleração (ex: $+15\%$ com cardápio simplificado ou $-20\%$ em dia de prato complexo).

### Setor 3: Salão e Mesas (Capacidade: 216 cadeiras)
- **Capacidade de Assentos:** Ajustável (padrão 216, permitindo simular adição ou remoção de mesas).
- **Tempo Médio de Permanência na Mesa:** Ajuste relativo (ex: $-3$ minutos via campanhas de conscientização ou $+5$ minutos em dias de chuva).

---

## 4. INTERFACES E NAVEGAÇÃO

### 4.1 Menu de Navegação Global
- Adicionar o link/botão **"Simulações"** no cabeçalho/barra de navegação de:
  - `public/painel.html`
  - `public/historico.html`
- Criar a página principal do módulo: `public/simulacoes.html` com seu script dedicado `public/simulacoes.js`.

### 4.2 Telas e Componentes em `simulacoes.html`
1. **Seletor de Sessão Base:** Dropdown listando todas as sessões finalizadas com data, nome e volume de alunos atendidos.
2. **Painel de Parâmetros de Intervenção:** Cartões estilizados com controles deslizantes e valores numéricos dos parâmetros descritos na Seção 3.
3. **Botão de Ação:** `▶ Executar Simulação` (com processamento instantâneo no cliente ou via endpoint).
4. **Dashboard Comparativo Lado a Lado (Real vs. Simulado):**
   - **Tabela de Impacto Resumido:**
     - Tempo Médio de Espera na Fila 1 ($W_{q1}$): *Ex: de 14m30s para 03m15s (-77%)*.
     - Tempo Médio de Espera na Fila 2 ($W_{q2}$): *Ex: de 02m10s para 02m05s*.
     - Tempo Total da Chegada às Mesas ($T_{\text{trânsito}}$): *Ex: de 16m40s para 05m20s*.
     - Percentil 95 (P95): Pior tempo de espera enfrentado por 95% dos alunos.
     - Utilização dos Servidores ($\rho_1$, $\rho_2$).
     - Ocupação de Pico das Mesas: Alerta visual se a aceleração da entrada gerar sobrecarga no salão (ex: "Atenção: Mesas atingiram 98% de ocupação aos 35 min").
   - **Gráficos Comparativos Sobrepostos (Chart.js):**
     - Curva temporal do tamanho da fila (Linha Azul: Real vs. Linha Verde: Simulada).
     - Curva de ocupação das mesas ao longo do tempo.
5. **Ações de Exportação:**
   - Botão para exportar o relatório comparativo em PDF.
   - Botão para exportar os dados simulados em CSV compatível com Excel.

---

## 5. ROTEIRO DE ARQUIVOS A CRIAR E MODIFICAR

1. **`shared/simulador.js` (NOVO):**
   - Exportar a função pura:
     `simularSessao(eventosReais, parametrosConfig)`
   - Implementar fila de eventos ordenados por tempo com múltiplos canais de atendimento ($c_1, c_2$) e alocação dinâmica das cadeiras do salão.
2. **`public/simulacoes.html` (NOVO):**
   - Estrutura semântica HTML5, paleta de cores consistente com `estilo.css` e suporte a tema escuro.
3. **`public/simulacoes.js` (NOVO):**
   - Lógica de carregamento de sessões via `GET /api/sessoes`, integração com `simularSessao()`, renderização do dashboard comparativo e gráficos.
4. **`server/server.js`:**
   - Garantir rotas HTTP para `/simulacoes` e servir o novo arquivo `simulacoes.html`.
5. **`teste/testes.js`:**
   - Adicionar suíte de testes automatizados para validar que a simulação com parâmetros idênticos aos reais reproduz resultados equivalentes e que acréscimos de servidores reduzem monotonicamente os tempos médios de espera.

---

## 6. CRITÉRIOS DE ACEITE E VERIFICAÇÃO

- [ ] A simulação com parâmetros 100% idênticos à sessão real deve gerar métricas estatisticamente aderentes ao cenário baseline.
- [ ] O aumento de 1 para 2 catracas deve reduzir expressivamente o $W_{q1}$ sem corromper a ordem FIFO de cada catraca.
- [ ] O relatório comparativo deve exibir claramente a diferença percentual $(\Delta\%)$ em verde (melhoria) ou vermelho (piora).
- [ ] O cálculo deve ser instantâneo e não travar a interface do usuário.
- [ ] Todos os testes automatizados existentes no projeto continuam passando com 100% de sucesso.
