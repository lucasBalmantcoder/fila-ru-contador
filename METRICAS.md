# Métricas do Sistema Fila RU

Documento de referência de **todas as métricas calculadas ao final de cada coleta**. Cada métrica possui um ID estável (`M-xx`), usado também no código (`shared/metricas.js`, registro `METRICAS`) e nos testes. Este documento é a fonte de verdade: qualquer métrica nova ou alterada deve ser atualizada aqui.

Versão do documento: 1.0 (03/11/2026)

---

## 1. Convenções

| Termo | Definição |
|---|---|
| **Sessão** | Uma coleta, do início (`sessao_iniciada`) ao fim (`sessao_encerrada`). |
| **Fila 1** | Entrada → catraca (vermelha). |
| **Fila 2** | Catraca → mesas, passando pelo Atendimento (verde). |
| **Fila 3** | Mesas → saída do restaurante (rosa). Mede a permanência desde a chegada às mesas. |
| **Entrada / Saída** | Evento que coloca a pessoa na fila / evento que a retira da fila (confirmado por um celular). |
| **Encadeamento** | A saída de uma fila cria a entrada da seguinte (`1>2`, `2>3`), com a mesma pessoa e o mesmo horário. |
| **Evento efetivo** | Evento não anulado, não revertido e que não seja de ajuste de fila. |
| **T** | Duração observada da fila: do início da sessão (ou da ativação da fila) até o fim da sessão (ou da desativação da fila). |
| **n_e, n_s** | Número de entradas e de saídas efetivas da fila. |
| **c** | Número de servidores da fila (catracas ou pontos de serviço), configurado na sessão (padrão 1). |
| **Bloco** | Janela de tempo para séries e tabelas (padrão 5 min, configurável). |
| **Limiar de pausa (P)** | Intervalo sem saídas a partir do qual há "pausa longa" (padrão 60 s, configurável). |

Unidades: tempos em segundos (exibidos como `mm:ss` ou `hh:mm:ss`); taxas em pessoas por minuto. Desvio padrão amostral (n − 1). Percentis por interpolação linear.

Todas as métricas desta seção 2 são calculadas **por fila ativa**. Uma fila ativa sem nenhum evento é marcada como **"sem dados"**, sem métricas zeradas.

---

## 2. Métricas por fila

### 2.1 Contagens e tempos de referência

| ID | Métrica | Definição | Unidade |
|---|---|---|---|
| M-01 | Entradas (n_e) | Pessoas que entraram na fila (efetivas). | pessoas |
| M-02 | Saídas (n_s) | Pessoas que saíram da fila (efetivas). | pessoas |
| M-03 | Anuladas | Pessoas removidas da fila por anulação. | pessoas |
| M-04 | Revertidas | Atendimentos desfeitos por reversão. | eventos |
| M-05 | Ajustes | Entradas e saídas geradas por "Ajustar fila". Reportadas à parte e excluídas de M-10 a M-38. | eventos |
| M-06 | Pessoas na fila ao encerrar | Pessoas presentes na fila no fim da coleta (considera anulações e ajustes). | pessoas |
| M-07 | Duração observada (T) | Tempo em que a fila esteve ativa na sessão. | s |
| M-08 | Tempo até a primeira saída | `t_primeira_saída − início`. | s |
| M-09 | Tempo após a última saída | `fim − t_última_saída`. | s |

### 2.2 Taxas e vazão

| ID | Métrica | Fórmula / definição | Unidade |
|---|---|---|---|
| M-10 | Taxa de entrada (λ) | `n_e / T` | pessoas/min |
| M-11 | Vazão global | `n_s / T` | pessoas/min |
| M-12 | Vazão em operação | `(n_s − 1) / (t_última_saída − t_primeira_saída)` | pessoas/min |
| M-13 | Taxa de serviço efetiva (μ agregada) | `1 / média dos intervalos entre saídas (M-30)`. Inclui períodos ociosos. | pessoas/min |
| M-14 | Taxa de serviço em ocupação (μ ocupada) | `1 / média dos intervalos entre saídas consecutivas em que a fila esteve não vazia entre as duas`. Mede a capacidade real do serviço. | pessoas/min |
| M-15 | Taxa de serviço por servidor (μ_c) | `μ ocupada / c` (usa M-13 se não houver intervalos em ocupação). | pessoas/min |
| M-16 | Utilização (ρ) | `λ / (c · μ_c)` | — |
| M-17 | Saídas por bloco | Série: número de saídas em cada bloco. | pessoas |
| M-18 | Entradas por bloco | Série: número de entradas em cada bloco. | pessoas |
| M-19 | Resumo por bloco | Média, valor de pico (e o bloco em que ocorreu) e mínimo de M-17. | pessoas |

### 2.3 Tempo na fila (por pessoa)

Para cada pessoa com entrada e saída efetivas: `tempo_na_fila = t_saída − t_entrada`. Na fila 2 e na fila 3 é o tempo na respectiva fila. **Fila 3:** é a permanência desde a chegada às mesas até a saída do restaurante; os valores individuais são **estimados (ordem FIFO assumida)**, exceto a média (M-20), que é exata.

| ID | Métrica | Observação |
|---|---|---|
| M-20 | Média | Exata em qualquer fila. |
| M-21 | Mediana | Fila 3: estimada. |
| M-22 | Desvio padrão | Fila 3: estimado. |
| M-23 | Mínimo | Fila 3: estimado. |
| M-24 | Máximo | Fila 3: estimado. |
| M-25 | Percentil 90 | Fila 3: estimado. |
| M-26 | Percentil 95 | Fila 3: estimado. |
| M-27 | Pessoas sem saída ao final | Quantidade e tempo parcial médio até o fim da coleta (informativo, não entra em M-20 a M-26). |

### 2.4 Intervalos

| ID | Métrica | Definição |
|---|---|---|
| M-30 | Intervalo entre saídas: média | Média de `t_saída(k+1) − t_saída(k)`. |
| M-31 | Intervalo entre saídas: mediana | |
| M-32 | Intervalo entre saídas: desvio padrão | |
| M-33 | Intervalo entre saídas: coeficiente de variação | `desvio padrão / média`. Referência: 1 em processo de Poisson. |
| M-34 | Intervalo entre saídas: mínimo | |
| M-35 | Intervalo entre saídas: máximo | Maior pausa entre saídas. |
| M-36 | Intervalo entre saídas: percentil 90 | |
| M-37 | Intervalo entre saídas: percentil 95 | |
| M-38 | Intervalo entre entradas | Mesmo conjunto de estatísticas (média, mediana, desvio padrão, CV, mínimo, máximo, P90, P95), aplicado às entradas. |

### 2.5 Comprimento da fila

| ID | Métrica | Fórmula / definição | Unidade |
|---|---|---|---|
| M-40 | Comprimento médio (L) | `(1/T) · ∫ n(t) dt`, em que `n(t)` é o número de pessoas na fila em cada instante (média ponderada pelo tempo). | pessoas |
| M-41 | Comprimento máximo | Maior valor de `n(t)` e o instante em que ocorreu. | pessoas |
| M-42 | Tempo com a fila vazia | Tempo e percentual de T com `n(t) = 0`. | s e % |
| M-43 | Série do comprimento | `n(t)` ao longo do tempo (gráfico, com as três filas na mesma escala). | pessoas |

### 2.5.1 Ociosidade e demanda

Classificação do tempo da fila em quatro categorias que não se sobrepõem: **serviço em operação**, **serviço parado**, **sem demanda** e **sem cobertura**.

| ID | Métrica | Definição |
|---|---|---|
| M-50 | Pausas de serviço parado | Número de intervalos sem saída maiores que P **com a fila não vazia**. |
| M-51 | Tempo de serviço parado | Tempo total e percentual de T nessas pausas. |
| M-52 | Maior pausa com fila não vazia | Duração e horário. |
| M-53 | Tempo sem demanda | Tempo e percentual de T com a fila vazia (M-42, excluindo períodos sem cobertura). |
| M-54 | Tempo sem cobertura | Tempo e percentual de T em que nenhum aparelho coletava a fila (ver M-90). Nunca entra em M-50 a M-53. |

### 2.6 Lei de Little e modelo teórico

| ID | Métrica | Fórmula / definição |
|---|---|---|
| M-60 | Verificação da Lei de Little | Compara `L` (M-40) com `λ · W` (M-10 × M-20) e informa a diferença percentual. Diferenças grandes indicam regime não estável, truncamento ou lacunas de coleta. |
| M-61 | Modelo teórico M/M/c (referência) | Calculado somente se `ρ < 1`: probabilidade de espera (Erlang C), `Lq`, `Wq`, `W` e `L` teóricos, comparados aos observados. Premissas: chegadas de Poisson, serviço exponencial, `c` servidores idênticos, disciplina FIFO. Apenas indicativo. |

---

## 3. Tabela por bloco de tempo

Para cada fila ativa e cada bloco, cobrindo toda a duração em que a fila esteve ativa (inclusive blocos sem passagem, destacados).

| ID | Coluna | Definição |
|---|---|---|
| M-70 | Início–fim | Limites do bloco (o último pode ser parcial). |
| M-71 | Entradas | Entradas efetivas no bloco (igual a M-18). |
| M-72 | Saídas | Saídas efetivas no bloco (igual a M-17). |
| M-73 | Comprimento médio | Média ponderada pelo tempo de `n(t)` dentro do bloco. |
| M-74 | Cobertura (%) | Percentual do bloco com ao menos um aparelho coletando a fila. |
| M-75 | Pausas longas no bloco | Número de pausas de serviço parado (M-50) iniciadas no bloco. |

---

## 4. Métricas combinadas (filas encadeadas)

Disponíveis somente quando as filas envolvidas estão ativas e encadeadas na sessão.

| ID | Métrica | Definição | Condição |
|---|---|---|---|
| M-80 | Tempo total até as mesas | Por pessoa, `tempo na fila 1 + tempo na fila 2`. Média, mediana, desvio padrão, mínimo, máximo, P90 e P95. | Filas 1 e 2 |
| M-81 | Tempo total no restaurante | Por pessoa, da entrada na fila 1 à saída da fila 3. Média exata; demais estatísticas estimadas (ordem FIFO na fila 3). | Filas 1, 2 e 3 |
| M-82 | Participação de cada fila no tempo total | `tempo médio da fila / soma dos tempos médios`, em %. | Duas ou mais filas |
| M-83 | Ranking de gargalo | Filas ordenadas por tempo médio (M-20) e por comprimento médio (M-40), com a fila de maior valor destacada. Indicativo. | Duas ou mais filas |
| M-84 | Pessoas no sistema | Série e máximo da soma das pessoas presentes nas filas ao longo do tempo. | Duas ou mais filas |
| M-85 | Balanço de consistência | Verifica `entradas − saídas − anuladas = presentes` em cada fila e no encadeamento. Divergência é sinalizada como alerta de qualidade. | Todas |

---

## 5. Cobertura e qualidade dos dados

| ID | Métrica | Definição |
|---|---|---|
| M-90 | Cobertura por fila | Percentual de T em que havia ao menos um aparelho conectado e atribuído à fila. |
| M-91 | Lacunas de cobertura | Lista de períodos sem cobertura (início, fim, duração). |
| M-92 | Pessoas afetadas por lacuna | Pessoas cujo intervalo entre entrada e saída atravessa uma lacuna. Excluídas das estatísticas de tempo quando a opção "Excluir períodos sem cobertura" estiver ligada; nesse caso, as taxas (M-10 a M-12) usam apenas o tempo coberto. |
| M-93 | Eventos tardios | Eventos enviados após reconexão (com `tardio: true`). |
| M-94 | Comandos rejeitados | Contagem por código (`FILA_VAZIA`, `CABECA_MUDOU`, `JA_ATENDIDO`, `FILA_INATIVA` etc.), fila e aparelho. |
| M-95 | Anulações, reversões e ajustes | Quantidade por fila e por aparelho. |
| M-96 | Desconexões por aparelho | Número, horário e duração. |
| M-97 | Eventos por aparelho | Quantidade de eventos registrados por cada aparelho e por fila. |
| M-98 | Aparelhos por fila | Aparelhos atribuídos a cada fila ao longo da sessão (trocas de área e modo apoio). |

---

## 6. Comparação entre sessões

| ID | Métrica | Definição |
|---|---|---|
| M-100 | Comparação lado a lado | Principais métricas (M-01, M-02, M-10, M-11, M-16, M-20, M-30, M-40, M-41, M-80, M-81, M-90) de duas ou mais sessões, somente nas filas em comum. Métricas que não se aplicam a alguma sessão são indicadas como "não disponível". |

---

## 7. Onde cada métrica aparece

| Grupo | Tela (relatório) | CSV de resumo | CSV por bloco | CSV de pessoas | Relatório imprimível |
|---|---|---|---|---|---|
| 2.1 a 2.4 | Aba da fila | Sim | — | M-20 a M-26 por pessoa | Sim |
| 2.5 e 2.5.1 | Aba da fila e gráfico | Sim | M-73, M-75 | — | Sim |
| 2.6 | Aba da fila | Sim | — | — | Sim |
| 3 | Tabela por bloco | — | Sim | — | Sim |
| 4 | Visão geral | Sim | — | Tempo por fila e total | Sim |
| 5 | Visão geral e painel | Sim | M-74 | — | Sim |
| 6 | Tela de comparação | — | — | — | — |

---

## 8. Premissas e limitações

1. **Ordem FIFO.** O pareamento entre entrada e saída assume que as pessoas saem na ordem em que entraram. Na fila 3 isso não vale (as pessoas deixam as mesas em ordem diferente da de chegada), portanto os valores individuais e as estatísticas de dispersão são estimados. A **média** é exata, pois a soma dos tempos independe da ordem de pareamento.
2. **Tempo de cada pessoa na fila 1 e na fila 2** também pressupõe FIFO; ultrapassagens ocasionais afetam os valores individuais, mas não as contagens, as vazões nem as médias.
3. **Horário de registro.** Os horários refletem o toque do operador, com atraso típico inferior a 1 s. Eventos enviados após reconexão são marcados como tardios.
4. **Cobertura.** A ausência de eventos não significa ausência de pessoas: pode ser falta de coleta. Por isso a cobertura (M-90) e as lacunas (M-91) acompanham todas as métricas de taxa e de ociosidade.
5. **Ajustes de fila** corrigem o estado e o comprimento da fila, mas são excluídos das métricas de tempo, de intervalo e de vazão.
6. **Pessoas sem saída ao final** não entram nas estatísticas de tempo (M-20 a M-26); são informadas em M-27. Com muitas pessoas nessa condição, as médias tendem a subestimar o tempo real.
7. **Taxa de serviço.** A taxa agregada (M-13) subestima a capacidade quando a fila fica vazia; a taxa em ocupação (M-14) é a mais adequada para ρ e para o modelo M/M/c.
8. **M/M/c** é apenas uma referência: a chegada em grupos, a variação do tempo de serviço e a coleta de 1 hora podem afastar o comportamento real do modelo.
9. **Amostras pequenas** (poucas saídas) geram estatísticas instáveis, em especial os percentis P90 e P95 e o coeficiente de variação.
10. **Tempo sentado nas mesas** é medido apenas como parte da fila 3 (permanência desde a chegada às mesas até a saída do restaurante).
11. Sessões gravadas antes do encadeamento `2>3` mantêm a fila 3 independente (numeração própria), e as métricas M-81 e M-82 não se aplicam a elas. Sessões antigas não têm registro de cobertura (M-90 a M-92 indicam "não disponível").

---

## 9. Manutenção deste documento

- Cada ID do documento deve existir no registro `METRICAS` de `shared/metricas.js`, e vice-versa. Um teste automatizado verifica essa correspondência.
- Ao incluir, alterar ou remover uma métrica, atualizar este arquivo e a versão do documento no cabeçalho.
