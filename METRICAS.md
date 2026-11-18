# Métricas do Sistema Fila RU

Documento de referência de **todas as métricas calculadas ao final de cada coleta e durante o monitoramento em tempo real**. Cada métrica possui um ID estável (`M-xx`), usado como contrato de especificação no código (`shared/metricas.js`, `shared/estado.js`) e na suíte de testes automatizados (`teste/testes.js`). Este documento é a fonte de verdade do projeto: qualquer métrica nova ou alterada deve ser formalmente registrada aqui.

**Versão do documento:** 2.0 (17/11/2026)  
**Principais novidades da v2.0:**
* Modelagem da capacidade e dinâmica das **Mesas do RU (216 cadeiras)** com métricas em tempo real e consolidadas de sessão.
* Nova lógica da **Fila 3 / Saída**: fluxo contínuo sem formação de fila de espera estática acumulada no corredor.
* Métricas de **trânsito em encadeamentos parciais e totais** (F1 → F2, F2 → F3 e F1 → F2 → F3) com resumos executivos (`transitoMesas`, `transitoSaida`).

---

## 1. Convenções e Terminologia

| Termo | Definição |
|---|---|
| **Sessão** | Uma coleta de dados, delimitada do início (`sessao_iniciada`) ao fim (`sessao_encerrada`). |
| **Fila 1** | Entrada → Catraca (vermelha). Mede a espera dos alunos para acesso à catraca. |
| **Fila 2** | Catraca → Mesas, contornando a caixa de Atendimento (verde). Mede a espera para pegar a bandeja e se servir. |
| **Salão & Mesas** | Área de refeição entre a Fila 2 e a Saída. Capacidade nominal de **216 cadeiras**, distribuídas em **4 fileiras com 9 mesas cada (36 mesas no total)**, sendo **6 cadeiras por mesa**. |
| **Fila 3 / Saída** | Mesas → Saída física do restaurante (rosa). Quando encadeada com a Fila 2, **não forma fila de espera estática acumulada no corredor**; representa o fluxo dinâmico e contínuo de alunos que concluíram a refeição e se deslocam até a porta de saída. |
| **Cadeiras Ocupadas / Livres** | Quantidade instantânea e média de assentos ocupados por alunos comendo e disponíveis no salão. |
| **Status de Ocupação** | Classificação qualitativa da lotação do salão: *Tranquilo* (< 50%), *Moderado* (50% a 74%), *Quase Cheio* (75% a 89%) e *Lotado* (≥ 90%). |
| **Entrada / Saída** | Evento que insere a pessoa na fila / evento que a retira da fila (confirmado pelo operador via celular). |
| **Encadeamento Atômico** | A saída de uma fila gera automaticamente a entrada na fila seguinte (`1>2` na catraca, `2>3` ao sentar nas mesas), mantendo a mesma numeração da pessoa e o mesmo timestamp. |
| **Evento Efetivo** | Evento não anulado, não revertido e que não seja classificado como ajuste de fila. |
| **T** | Duração observada da fila: do início da sessão (ou ativação da fila) até o fim da sessão (ou desativação da fila). |
| **n_e, n_s** | Número de entradas e saídas efetivas da respectiva fila. |
| **c** | Número de servidores da fila (catracas ou postos de atendimento), configurado na sessão (padrão 1). |
| **Bloco** | Janela temporal discreta para gráficos de série histórica e tabelas analíticas (padrão 5 min, configurável). |
| **Limiar de Pausa (P)** | Intervalo consecutivo sem saídas a partir do qual se diagnostica "pausa longa" (padrão 60 s, configurável). |
| **Tempo de Refeição Padrão** | Duração estimada da refeição (padrão 20 min), utilizada para liberação assíncrona de cadeiras quando a Fila 3 não é monitorada. |

**Unidades padrão:** tempos em segundos (`s`, exibidos como `mm:ss` ou `hh:mm:ss`); taxas em pessoas por minuto (`pessoas/min`). Desvio padrão amostral ($n - 1$). Percentis calculados por interpolação linear ponderada.

Todas as métricas da Seção 2 são calculadas **por fila ativa**. Uma fila ativa que não registrou eventos é reportada com a flag **"sem dados"**, sem zerar artificialmente suas taxas.

---

## 2. Métricas por Fila

### 2.1 Contagens e tempos de referência

| ID | Métrica | Definição | Unidade |
|---|---|---|---|
| M-01 | Entradas ($n_e$) | Pessoas que entraram na fila (efetivas). | pessoas |
| M-02 | Saídas ($n_s$) | Pessoas que saíram da fila (efetivas). | pessoas |
| M-03 | Anuladas | Pessoas removidas da fila por anulação de toque pelo operador. | pessoas |
| M-04 | Revertidas | Atendimentos desfeitos por reversão de toque pelo operador. | eventos |
| M-05 | Ajustes | Entradas e saídas geradas pela ferramenta "Ajustar fila". Reportadas separadamente e excluídas do cálculo de tempos e vazões. | eventos |
| M-06 | Pessoas na fila ao encerrar | Pessoas presentes na fila no instante de encerramento da coleta. | pessoas |
| M-07 | Duração observada ($T$) | Tempo total em que a fila permaneceu ativa durante a sessão. | s |
| M-08 | Tempo até a primeira saída | $t_{\text{primeira\_saída}} - t_{\text{início}}$. | s |
| M-09 | Tempo após a última saída | $t_{\text{fim}} - t_{\text{última\_saída}}$. | s |

### 2.2 Taxas e vazão

| ID | Métrica | Fórmula / Definição | Unidade |
|---|---|---|---|
| M-10 | Taxa de entrada ($\lambda$) | $n_e / T$ | pessoas/min |
| M-11 | Vazão global | $n_s / T$ | pessoas/min |
| M-12 | Vazão em operação | $(n_s - 1) / (t_{\text{última\_saída}} - t_{\text{primeira\_saída}})$ | pessoas/min |
| M-13 | Taxa de serviço efetiva ($\mu$ agregada) | $1 / \text{média dos intervalos entre saídas (M-30)}$. Inclui períodos de ociosidade. | pessoas/min |
| M-14 | Taxa de serviço em ocupação ($\mu$ ocupada) | $1 / \text{média dos intervalos entre saídas em que a fila esteve não vazia}$. Mede a capacidade técnica do posto de atendimento. | pessoas/min |
| M-15 | Taxa de serviço por servidor ($\mu_c$) | $\mu_{\text{ocupada}} / c$ (recorre a M-13 se não houver intervalos não vazios). | pessoas/min |
| M-16 | Fator de utilização ($\rho$) | $\lambda / (c \cdot \mu_c)$ | — |
| M-17 | Saídas por bloco | Série temporal com o número de saídas em cada janela de tempo. | pessoas |
| M-18 | Entradas por bloco | Série temporal com o número de entradas em cada janela de tempo. | pessoas |
| M-19 | Resumo por bloco | Média, valor de pico (e índice do bloco correspondente) e mínimo da série M-17. | pessoas |

### 2.3 Tempo na fila (por pessoa)

Para cada pessoa atendida com entrada e saída efetivas: $\text{tempo\_na\_fila} = t_{\text{saída}} - t_{\text{entrada}}$.  
*Nas Filas 1 e 2:* tempo de espera físico no alinhamento da fila.  
*Na Fila 3:* tempo decorrido desde a chegada às mesas até a passagem pela saída. A média (M-20) é exata independentemente da ordem; as medidas de dispersão individuais presumem aproximação FIFO.

| ID | Métrica | Observação |
|---|---|---|
| M-20 | Média de espera ($W_q$) | Média aritmética exata dos tempos de espera. |
| M-21 | Mediana de espera | Valor central da amostra de tempos de espera. |
| M-22 | Desvio padrão | Dispersão amostral dos tempos de espera. |
| M-23 | Mínimo | Menor tempo individual de espera registrado. |
| M-24 | Máximo | Maior tempo individual de espera registrado. |
| M-25 | Percentil 90 (P90) | 90% dos alunos esperaram menos ou igual a este valor. |
| M-26 | Percentil 95 (P95) | 95% dos alunos esperaram menos ou igual a este valor. |
| M-27 | Pessoas sem saída ao final | Quantidade e tempo parcial acumulado até o término da coleta (informativo, não polui M-20 a M-26). |

### 2.4 Intervalos entre eventos

| ID | Métrica | Definição |
|---|---|---|
| M-30 | Intervalo entre saídas: média | Média de $t_{\text{saída}}(k+1) - t_{\text{saída}}(k)$. |
| M-31 | Intervalo entre saídas: mediana | Mediana dos intervalos consecutivos entre saídas. |
| M-32 | Intervalo entre saídas: desvio padrão | Dispersão dos intervalos entre saídas. |
| M-33 | Coeficiente de variação das saídas ($CV$) | $\text{desvio padrão} / \text{média}$. (Referência teórica: 1,0 em processo de Poisson). |
| M-34 | Intervalo entre saídas: mínimo | Menor tempo registrado entre dois atendimentos seguidos. |
| M-35 | Intervalo entre saídas: máximo | Maior tempo registrado entre dois atendimentos seguidos (maior pausa entre clientes). |
| M-36 | Intervalo entre saídas: P90 | 90% dos intervalos entre saídas foram inferiores a este valor. |
| M-37 | Intervalo entre saídas: P95 | 95% dos intervalos entre saídas foram inferiores a este valor. |
| M-38 | Intervalos entre entradas | Conjunto idêntico de estatísticas (média, mediana, desvio padrão, CV, mín, máx, P90, P95) aplicado aos intervalos entre chegadas. |

### 2.5 Comprimento da fila

| ID | Métrica | Fórmula / Definição | Unidade |
|---|---|---|---|
| M-40 | Comprimento médio ($L_q$) | $(1/T) \cdot \int_0^T n(t) \, dt$, sendo $n(t)$ o número de pessoas na fila no instante $t$ (média ponderada no tempo). | pessoas |
| M-41 | Comprimento máximo | Maior valor observado de $n(t)$ e o instante temporal exato do pico. | pessoas |
| M-42 | Tempo com a fila vazia | Tempo total e fração percentual de $T$ em que $n(t) = 0$. | s e % |
| M-43 | Série temporal do comprimento | Curva contínua de $n(t)$ ao longo da sessão para gráficos comparativos sincronizados. | pessoas |

*Nota sobre a Fila 3:* Com a modelagem contínua das mesas, a Fila 3 não acumula fila estática no corredor ($L_q \approx 0$ em fluxo regular), refletindo apenas blocos em trânsito instantâneo até a saída.

### 2.5.1 Ociosidade e demanda

Classificação temporal mutuamente exclusiva do tempo de operação em quatro regimes:

| ID | Métrica | Definição |
|---|---|---|
| M-50 | Pausas de serviço parado | Quantidade de pausas sem saída superiores ao limiar $P$ ocorridas **com a fila não vazia**. |
| M-51 | Tempo de serviço parado | Duração somada e fração percentual de $T$ em que o atendimento parou havendo alunos esperando. |
| M-52 | Maior pausa com fila não vazia | Duração e horário exato de início da maior pausa de atendimento com fila acumulada. |
| M-53 | Tempo sem demanda | Duração e percentual de $T$ com a fila vazia (M-42, descontando eventuais períodos sem cobertura). |
| M-54 | Tempo sem cobertura | Duração e percentual de $T$ em que nenhum coletor estava conectado e cobrindo a fila. |

### 2.6 Verificação teórica e Lei de Little

| ID | Métrica | Fórmula / Definição |
|---|---|---|
| M-60 | Verificação da Lei de Little | Confronta $L_q$ observado (M-40) com o produto $\lambda \cdot W_q$ (M-10 $\times$ M-20). Informa a divergência percentual $|\Delta \%|$. Valores $\le 20\%$ atestam consistência de regime estável. |
| M-61 | Modelo Teórico M/M/c (Erlang C) | Calculado para $\rho < 1$: Probabilidade de espera $P_{\text{espera}}$, $P_0$, $L_q$, $W_q$, $L$ e $W$ teóricos derivados da teoria de filas clássica para benchmarking com a operação real. |

---

## 3. Tabela Analítica por Bloco de Tempo

| ID | Coluna / Campo | Definição |
|---|---|---|
| M-70 | Início – Fim | Intervalo temporal da janela discreta (ex: 00:00 - 05:00). |
| M-71 | Entradas no bloco | Total de entradas efetivas na janela (corresponde a M-18). |
| M-72 | Saídas no bloco | Total de saídas efetivas na janela (corresponde a M-17). |
| M-73 | Comprimento médio | Média ponderada no tempo de $n(t)$ no intervalo do bloco. |
| M-74 | Cobertura do bloco (%) | Percentual da duração do bloco em que havia aparelho coletando a fila ativamente. |
| M-75 | Pausas longas no bloco | Quantidade de pausas com fila acumulada iniciadas dentro da janela. |

---

## 4. Métricas Combinadas e Encadeamentos Multi-Filas

Métricas calculadas dinamicamente quando as filas componentes encontram-se ativas e encadeadas atomicamente.

| ID | Métrica | Definição e Composição | Condição |
|---|---|---|---|
| M-80 | Tempo total até as mesas | Tempo individual acumulado desde a chegada na Fila 1 até o atendimento na Fila 2: $\text{espera}_{\text{F1}} + \text{espera}_{\text{F2}}$. Estatísticas completas: média, mediana, desvio padrão, mín, máx, P90 e P95. | Filas 1 e 2 ativas |
| M-81 | Tempo total no restaurante | Tempo integral de permanência no RU, desde a chegada na Fila 1 até a saída final na Fila 3: $\text{espera}_{\text{F1}} + \text{espera}_{\text{F2}} + \text{permanência}_{\text{mesas}}$. Média exata. | Filas 1, 2 e 3 ativas |
| M-82 | Participação de cada fila | Fração percentual de cada fila no tempo total médio: $(\text{tempo médio da fila} / \text{tempo total}) \times 100$. | 2 ou mais filas |
| M-83 | Ranking de gargalo | Identificação e destaque da etapa com maior tempo médio de retenção ou maior fila acumulada. | 2 ou mais filas |
| M-84 | Pessoas no sistema | Curva temporal e valor de pico da soma total de pessoas simultâneas em todas as filas ativas. | 2 ou mais filas |
| M-85 | Balanço de consistência | Validação de conservação de fluxo: $\text{entradas} - \text{saídas} - \text{anuladas} = \text{presentes}$. Aponta divergências na coleta. | Todas as filas |
| M-86 | Tempo Mesas até a Saída | Tempo decorrido entre a chegada na Fila 2 (após catraca) e a saída final na Fila 3 (`tempoMesasAteSaida`). Média, mediana, desvio padrão, mín, máx, P90 e P95. | Filas 2 e 3 ativas |
| M-87 | Resumo de Trânsito até as Mesas | Objeto executivo `transitoMesas`: `{ count, mediaSeg, medianaSeg, p90Seg }` para cards de visão rápida no painel e histórico. | Filas 1 e 2 ativas |
| M-88 | Resumo de Trânsito até a Saída | Objeto executivo `transitoSaida`: `{ count, mediaSeg, medianaSeg, p90Seg }` sintetizando a permanência completa no RU. | Filas 1, 2 e 3 ativas |

---

## 5. Métricas de Ocupação do Salão e Mesas (216 cadeiras)

Modelagem física detalhada do salão de refeições do RU, preenchido quando os alunos passam pelo atendimento da Fila 2 e liberado dinamicamente no término da refeição rumo à saída.

### 5.1 Parâmetros estruturais físicos

* **Capacidade nominal total ($C_{\text{mesas}}$):** 216 cadeiras.
* **Layout arquitetural:** 4 fileiras paralelas com 9 mesas cada = **36 mesas**.
* **Capacidade por mesa:** 6 cadeiras por mesa.

### 5.2 Catálogo de métricas de ocupação das mesas

| ID | Métrica | Fórmula / Definição | Unidade |
|---|---|---|---|
| M-110 | Capacidade total de assentos | Parâmetro nominal físico constante: $4 \times 9 \times 6 = 216$. | cadeiras |
| M-111 | Cadeiras ocupadas em tempo real | Quantidade instantânea de alunos sentados no salão no instante $t$: $n_{\text{mesas}}(t)$. | cadeiras |
| M-112 | Cadeiras livres em tempo real | Lugares vagos imediatos: $\max(0, 216 - n_{\text{mesas}}(t))$. | cadeiras |
| M-113 | Taxa de ocupação instantânea | $(n_{\text{mesas}}(t) / 216) \times 100$. | % |
| M-114 | Mesas ocupadas estimadas | $\min(36, \lceil n_{\text{mesas}}(t) / 6 \rceil)$. Estimativa de mesas com ao menos 1 pessoa sentada. | mesas |
| M-115 | Status de ocupação instantâneo | Rótulo qualitativo em tempo real: *Tranquilo* (< 50%), *Moderado* (50-74%), *Quase Cheio* (75-89%) ou *Lotado* (≥ 90%). | rótulo |
| M-116 | Pico de cadeiras ocupadas | Maior número simultâneo de cadeiras ocupadas na sessão: $\max_t n_{\text{mesas}}(t)$ e o instante do pico. | cadeiras e horário |
| M-117 | Taxa de ocupação no pico | $(\text{pico} / 216) \times 100$. | % |
| M-118 | Cadeiras livres no pico | $216 - \text{pico}$. Assentos remanescentes no momento de maior lotação. | cadeiras |
| M-119 | Status no pico | Classificação qualitativa da lotação máxima alcançada na sessão. | rótulo |
| M-120 | Média de cadeiras ocupadas | Média ponderada pelo tempo: $(1/T) \cdot \int_0^T n_{\text{mesas}}(t) \, dt$. | cadeiras |
| M-121 | Taxa média de ocupação | $(\text{média ponderada} / 216) \times 100$. | % |
| M-122 | Total de entradas nas mesas | Quantidade de alunos que sentaram às mesas durante toda a coleta (saídas da Fila 2). | pessoas |

---

## 6. Cobertura e Qualidade dos Dados

| ID | Métrica | Definição |
|---|---|---|
| M-90 | Cobertura por fila (%) | Fração percentual de $T$ com ao menos um aparelho conectado e associado à fila. |
| M-91 | Lacunas de cobertura | Lista discriminada de intervalos sem nenhum operador ativo (início, fim e duração). |
| M-92 | Pessoas afetadas por lacuna | Pessoas cujo trânsito na fila coincidiu com uma lacuna. Excluídas do cômputo de espera quando selecionada a opção "Excluir períodos sem cobertura". |
| M-93 | Eventos tardios | Eventos sincronizados após período de desconexão móvel (flag `tardio: true`). |
| M-94 | Comandos rejeitados | Totalização e classificação de rejeições (`FILA_VAZIA`, `CABECA_MUDOU`, `JA_ATENDIDO`, `FILA_INATIVA`, etc.). |
| M-95 | Auditoria de anulações, reversões e ajustes | Quantitativo consolidado por aparelho e operador para controle de integridade. |
| M-96 | Desconexões por aparelho | Frequência, horários e duração de interrupções de conexão de cada celular. |
| M-97 | Eventos por aparelho | Contagem de toques e registros processados por cada dispositivo da sessão. |
| M-98 | Histórico de aparelhos por fila | Rastreamento de trocas de área de atuação e ativações em modo apoio ao longo da sessão. |

---

## 7. Comparação Entre Sessões

| ID | Métrica | Definição |
|---|---|---|
| M-100 | Comparação lado a lado | Painel comparativo consolidando as métricas centrais (M-01, M-02, M-10, M-11, M-16, M-20, M-30, M-40, M-41, M-80, M-81, M-86, M-90, M-116, M-120) entre duas ou mais sessões selecionadas, alinhando as filas correspondentes. |

---

## 8. Onde Cada Métrica Aparece

| Grupo de Métricas | Painel ao Vivo | Tela de Histórico & Análise | Mapa Animado / SVG | Exportação CSV | Relatório Imprimível |
|---|---|---|---|---|---|
| **Contagens e Tempos (M-01 a M-09)** | Cards das filas | Aba de cada fila | Badges dos blocos e caixas | `resumo.csv` | Seção de tabelas |
| **Taxas e Vazão (M-10 a M-19)** | Cards de taxa | Gráficos e cards de vazão | — | `resumo.csv`, `blocos.csv` | Gráficos de barras |
| **Tempos de Espera (M-20 a M-27)** | Média em tempo real | Tabela de dispersão (P90, P95) | Tooltip do bloco | `pessoas.csv` | Tabela detalhada |
| **Intervalos (M-30 a M-38)** | — | Estatísticas da fila | — | `resumo.csv` | Seção estatística |
| **Comprimento (M-40 a M-43)** | Comprimento atual | Gráfico temporal comparativo | Blocos posicionados | `resumo.csv`, `blocos.csv` | Gráfico $n(t)$ |
| **Ociosidade (M-50 a M-54)** | — | Painel de perdas e pausas | — | `resumo.csv` | Tabela de ociosidade |
| **Little e Teórico (M-60, M-61)** | — | Card de validação teórica | — | `resumo.csv` | Diagnóstico Little |
| **Blocos de Tempo (M-70 a M-75)** | — | Tabela analítica por blocos | — | `blocos.csv` | Tabela impressa |
| **Encadeamento Multi-Filas (M-80 a M-88)** | Indicadores de trânsito | Cards de Percurso (Mesas e Saída) | Fluxo contínuo das rotas | `resumo.csv`, `pessoas.csv` | Seção de percurso total |
| **Salão & Mesas (M-110 a M-122)** | Card monitor Salão & Mesas | Card Ocupação do Salão (pico, média, status) | Indicador `X/216 cadeiras` + barra | `resumo.csv` | Seção Salão e Capacidade |
| **Qualidade e Cobertura (M-90 a M-98)** | Alerta de cobertura | Tabela de cobertura e auditoria | Status de conexão | `resumo.csv`, `blocos.csv` | Auditoria de rede |
| **Comparação (M-100)** | — | Tela comparativa multi-sessão | — | — | Comparativo impresso |

---

## 9. Premissas, Hipóteses e Limitações

1. **Dinâmica do Salão de Mesas:** A ocupação das mesas é computada a partir da saída da Fila 2 (ou Fila 1 caso a Fila 2 esteja inativa). Os alunos permanecem sentados nas 216 cadeiras durante a refeição. A liberação ocorre no instante em que o aluno avança para a saída na Fila 3. Caso a Fila 3 não seja coletada na sessão, a cadeira é liberada automaticamente após o tempo de permanência padrão (`tempoRefeicaoMin`, configurável, padrão 20 min).
2. **Fluxo Livre na Fila 3:** Na Fila 3, os blocos não acumulam fila de retenção estática no corredor das mesas; cada bloco desloca-se de modo individual ou sequencial suave até a caixa Saída, sumindo no instante do contato, com 100% de opacidade e sem sobreposições.
3. **Disciplina FIFO:** O pareamento de entrada e saída nas Filas 1 e 2 pressupõe disciplina primeiro a entrar, primeiro a sair. Ultrapassagens pontuais alteram os tempos individuais de espera, mas preservam com rigor exato as contagens, vazões, médias e comprimentos ponderados.
4. **Precisão Temporal dos Registros:** Os eventos registram o instante exato do toque do operador no celular (latência média de rede local < 100 ms). Eventos emitidos em modo offline registram `tardio: true` e são reintegrados mantendo a linha do tempo cronológica fiel.
5. **Ajustes Manuais de Fila:** O comando "Ajustar fila" recalibra o número físico de pessoas presentes no instante do ajuste, mas tais eventos artificiais são formalmente isolados dos cálculos de tempo de espera e vazão para não distorcer as métricas operacionais.
6. **M/M/c Indicativo:** O modelo Erlang C assume taxa de chegada puramente poissoniana e tempos exponenciais em regime permanente ($\rho < 1$). No ambiente universitário, chegadas em blocos de turmas e variações de cardápio podem afastar o comportamento empírico do modelo matemático de referência.

---

## 10. Manutenção deste Documento

* Qualquer nova métrica criada no backend (`server/sessao.js`), no módulo analítico compartilhado (`shared/metricas.js`) ou no motor de estado derivado (`shared/estado.js`) deve receber um ID estável subsequente e ser adicionada à tabela correspondente.
* As versões do documento seguem o Versionamento Semântico documentado no [CHANGELOG.md](file:///c:/Users/ghost/Documents/outubro/fila-ru/CHANGELOG.md).
