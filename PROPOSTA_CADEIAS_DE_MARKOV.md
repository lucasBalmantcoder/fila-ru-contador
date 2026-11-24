# Proposta de Modelagem e Implementação: Cadeias de Markov no Fila RU

Documento de alinhamento técnico e acadêmico para apresentação em seminário da disciplina de **Pesquisa Operacional / Processos Estocásticos**.

---

## 1. Visão Geral e Motivação

Atualmente, o sistema **Fila RU** monitora e analisa o restaurante universitário utilizando métricas estáticas e consolidadas da Teoria das Filas tradicional (médias de espera, vazão global, percentis P90/P95 e aproximação $M/M/c$).

Embora essas métricas descrevam com fidelidade o que ocorreu em uma coleta, **uma média esconde a dinâmica temporal e os momentos de pico**. Dizer que *"a fila média foi de 12 pessoas e o tempo médio foi de 2 minutos"* não informa se o sistema oscilou bruscamente, se operou à beira do colapso durante o pico ou quão rápido ele consegue se recuperar de uma saturação.

### A Proposta
Incorporar uma **camada probabilística baseada em Cadeias de Markov** que transforme o histórico coletado em um **modelo preditivo e dinâmico**, permitindo prever a evolução da fila e antecipar gargalos antes que eles aconteçam.

---

## 2. Objetivos Principais

```
      DADOS DO RU                        MODELO MARKOVIANO                     DECISÃO OPERACIONAL
┌──────────────────────┐              ┌──────────────────────┐              ┌────────────────────────┐
│ Coleta em tempo real │  ─────────►  │ Matriz de Transição  │  ─────────►  │ Alerta preventivo para │
│ no Fila RU           │              │ e Probabilidades     │              │ abertura de 2ª catraca │
└──────────────────────┘              └──────────────────────┘              └────────────────────────┘
```

1. **Sair da Reatividade e Ir para a Proatividade**:
   - *Hoje (Reativo):* A administração do RU só reage quando a fila já dobrou a esquina ou as mesas lotaram.
   - *Com Markov (Proativo):* O sistema calcula a probabilidade da fila atingir um nível crítico nos próximos 10 ou 15 minutos, permitindo abrir uma segunda catraca **antes** do colapso.

2. **Superar a "Ilusão das Médias"**:
   - Modelar a **inércia estocástica** da fila: quando ela enche, qual a probabilidade de continuar cheia? Quando esvazia, quão rápido volta a crescer?
   - Calcular com precisão a fração de tempo que o restaurante opera em regime seguro vs. regime saturado através da **distribuição estacionária**.

3. **Apoio e Transparência para o Aluno**:
   - Informar na entrada ou em telas: *"Fila atual: Moderada. Probabilidade de esvaziar nos próximos 10 min: 82%"*. Isso distribui naturalmente a demanda no horário de pico.

4. **Relevância Acadêmica para o Seminário**:
   - Conectar a teoria de **Processos Estocásticos** com dados reais coletados em campo, demonstrando aplicação prática direta das equações e matrizes estudadas em sala.

---

## 3. Opções de Implementação Avaliadas

| Opção | Complexidade | Apelo Visual no Seminário | Descrição Resumida |
| :--- | :---: | :---: | :--- |
| **1. Macrostados Operacionais** *(Recomendada)* | **Baixa** | **Altíssimo** | Discretiza a fila em 3 estados (*Tranquilo*, *Moderado*, *Crítico*) e calcula matriz $3 \times 3$. |
| **2. Processo de Nascimento e Morte** | Média | Alto | Modela cada tamanho de fila $n$ com taxas contínuas $\lambda$ (chegadas) e $\mu$ (atendimentos). |
| **3. Tempo até Primeira Superlotação** | Média | Médio | Calcula o tempo médio até a fila atingir o primeiro colapso (*First Hitting Time*). |
| **4. Cadeia com Absorção (Desistências)** | Média/Alta | Médio | Modela o comportamento de alunos que desistem da fila quando o tempo excede um limite. |

---

## 4. Implementação Recomendada: Macrostados Operacionais

Esta é a opção mais didática, elegante e viável para implementação no projeto e defesa no seminário.

### 4.1 Definição dos Estados
A quantidade instantânea de pessoas na fila ($L_q$) é mapeada a cada minuto em três estados operacionais:

* **$E_1$ — Tranquilo (Verde):** $0 \le L_q \le 10$ pessoas (atendimento rápido, fluxo livre).
* **$E_2$ — Moderado (Amarelo):** $11 \le L_q \le 25$ pessoas (tempo de espera perceptível, atenção recomendada).
* **$E_3$ — Crítico / Saturado (Vermelho):** $L_q > 25$ pessoas ou retenção por mesas cheias (formação de gargalo severo).

### 4.2 Matriz de Transição Empírica ($P$)
A partir do histórico real segundo a segundo já gravado no Fila RU, amostra-se o estado a cada minuto ($t, t+1, t+2, \dots$) e contabilizam-se as transições observadas:

$$P = \begin{bmatrix} 
P_{11} & P_{12} & P_{13} \\
P_{21} & P_{22} & P_{23} \\
P_{31} & P_{32} & P_{33}
\end{bmatrix}$$

Onde cada elemento $P_{ij}$ representa:
$$P_{ij} = \mathbb{P}(X_{t+1} = E_j \mid X_t = E_i) = \frac{\text{número de transições de } E_i \text{ para } E_j}{\text{total de vezes que o sistema esteve em } E_i}$$

#### Exemplo Numérico Ilustrativo (para slides):
$$P = \begin{bmatrix} 
0{,}80 & 0{,}18 & 0{,}02 \\
0{,}15 & 0{,}70 & 0{,}15 \\
0{,}05 & 0{,}25 & 0{,}70
\end{bmatrix}$$

*Interpretação:*
* Se o RU está **Tranquilo ($E_1$)**, há **80%** de chance de permanecer Tranquilo no próximo minuto.
* Se está **Moderado ($E_2$)**, há **15%** de chance de saltar para **Crítico ($E_3$)** e **70%** de persistir no estado Moderado.
* Se atingiu **Crítico ($E_3$)**, há **70%** de probabilidade de continuar saturado no minuto seguinte (alta inércia do gargalo).

### 4.3 Diagrama de Transição de Estados
Para exibição visual na apresentação:

```
          ┌─────────────┐
   0.80 ↺ │ E1: Tranquilo│ ⇄ [0.18 / 0.15]
          └──────┬──────┘
                 │ 0.02 / 0.05
                 ▼
          ┌─────────────┐
   0.70 ↺ │ E2: Moderado │ ⇄ [0.15 / 0.25] ⇄ ┌────────────┐ ↻ 0.70
          └─────────────┘                    │ E3: Crítico│
                                             └────────────┘
```

### 4.4 Aplicações Matemáticas Imediatas

#### A. Previsão a $k$-passos ($P^k$)
Dado o vetor de estado atual $v_0 = [1, 0, 0]$ (fila vazia na abertura às 11:15), a previsão da probabilidade de lotação após $k$ minutos é dada diretamente por:
$$v_k = v_0 \cdot P^k$$
Isso permite projetar o cenário para daqui a 5, 10 ou 15 minutos sem recalcular simulações complexas.

#### B. Distribuição Estacionária ($\pi = \pi P$)
Resolvendo o sistema linear:
$$\begin{cases} 
\pi \cdot P = \pi \\ 
\sum_{i} \pi_i = 1 
\end{cases}$$
Encontra-se a proporção de longo prazo em cada estado:
- $\pi_1 = 35\%$ do tempo em operação *Tranquila*.
- $\pi_2 = 45\%$ do tempo em operação *Moderada*.
- $\pi_3 = 20\%$ do tempo em operação *Crítica*.

---

## 5. Roteiro Sugerido para Apresentação no Seminário

1. **Slide 1 — O Problema Real no RU**:
   - Oscilações de demanda durante o almoço.
   - Limitações de se avaliar filas apenas por médias aritméticas consolidadas.
2. **Slide 2 — A Proposta: Modelagem Estocástica com Cadeias de Markov**:
   - Definição dos 3 macrostados (*Tranquilo*, *Moderado*, *Crítico*).
   - Apresentação do diagrama de transição com setas e probabilidades.
3. **Slide 3 — A Matriz de Transição Empírica ($P$)**:
   - Exibição da matriz calculada diretamente a partir dos dados do projeto.
   - Destaque para a inércia do estado crítico.
4. **Slide 4 — Previsão Operacional e Distribuição Estacionária**:
   - Demonstração de cálculo de $P^k$ (previsão para os próximos 10 minutos).
   - Percentual de tempo que o RU permanece em cada regime.
5. **Slide 5 — Impacto Prático na Gestão do Restaurante**:
   - Alerta antecipado para abertura da 2ª catraca antes do colapso.
   - Conclusão: integração entre teoria acadêmica de Pesquisa Operacional e aplicação prática de engenharia.

---

## 6. Facilidade Técnica de Implementação no Projeto

O projeto **Fila RU** já possui toda a base de dados necessária:
- As sessões já gravam eventos com carimbo de tempo em milissegundos (`chegadaMs` e `atendimentoMs`).
- A função pura `derivarEstado(eventos, t)` já reconstrói o tamanho exato da fila em qualquer instante $t$.
- Um script simples de menos de 100 linhas em JavaScript é capaz de percorrer o período da coleta minuto a minuto, classificar os estados e gerar a matriz $P$ e o vetor $\pi$ instantaneamente.

---

*Documento gerado para a equipe do projeto Fila RU — Seminário de Pesquisa Operacional.*
