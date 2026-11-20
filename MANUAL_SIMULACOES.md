# Manual de Operação: Módulo de Simulações What-If
**Sistema Fila RU — Simulação de Eventos Discretos Guiada por Traço Histórico (*Trace-Driven DES*)**

---

## 1. Introdução e Objetivo

O **Módulo de Simulações What-If** do Fila RU é uma ferramenta analítica de tomada de decisão projetada para gestores do Restaurante Universitário, pesquisadores e engenheiros de produção.

Ele permite responder com precisão científica a perguntas do tipo **"O que aconteceria se...?"**:
- *"E se adicionássemos uma segunda catraca na entrada nos dias de pico?"*
- *"E se duplicássemos a linha de buffet de distribuição de comida ou acelerássemos a entrega das bandejas em 20%?"*
- *"E se uma campanha de conscientização reduzisse o tempo médio de permanência dos alunos nas mesas em 3 minutos?"*
- *"Ao acelerar a entrada e o atendimento, as mesas do refeitório vão lotar e virar o novo gargalo, fazendo alunos ficarem esperando em pé com a bandeja na mão?"*

Diferente de simuladores teóricos tradicionais que usam números aleatórios abstratos, o Fila RU utiliza uma **Simulação Guiada por Traço Histórico (*Trace-Driven Simulation*)**: ele aproveita os **dados reais exatos de chegadas e atendimentos coletados em campo** para projetar cenários operacionais realistas e fundamentados na Teoria das Filas.

---

## 2. Como Funciona a Tecnologia

```
 ┌─────────────────────────────────────────────────────────────┐
 │                COLETA REAL DE CAMPO (HISTÓRICO)             │
 │  Horários exatos de chegada dos estudantes na Fila 1        │
 └──────────────────────────────┬──────────────────────────────┘
                                │ Traço Empírico
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │               MOTOR DE SIMULAÇÃO (shared/simulador.js)       │
 │                                                             │
 │   Catracas (Fila 1)         Buffets (Fila 2)        Mesas   │
 │   c1 = 1 a 4 catracas       c2 = 1 a 3 linhas      Capac.   │
 │   Modo Taxa / Tempo Fixo    Fator de Velocidade    Refeição │
 └──────────────────────────────┬──────────────────────────────┘
                                │ Eventos Simulados (em memória)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │             DASHBOARD COMPARATIVO (simulacoes.html)         │
 │  • Tabela comparativa (Real vs. Simulado com deltas Δ%)     │
 │  • Gráficos sobrepostos de filas e ocupação do salão        │
 │  • Alerta de Service Blocking (retenção por falta de mesa)  │
 └─────────────────────────────────────────────────────────────┘
```

1. **Traço de Chegadas Inalterado:** O número de alunos, o ritmo das chegadas e os picos de demanda da data observada são mantidos de forma 100% fiel.
2. **Desacoplamento de Serviço Puro:** O simulador deduz o tempo que a catraca e o buffet levaram exclusivamente para atender cada pessoa (descontando o tempo que ela esperou na fila), evitando duplicidade matemática.
3. **Fila Única Compartilhada ($M/G/c$):** Havendo 2 ou mais catracas ou linhas de buffet, os alunos aguardam em fila única e avançam para o primeiro posto que se desocupar.
4. **Bloqueio de Serviço (*Service Blocking*):** Se o salão atingir a capacidade máxima configurada (padrão: 216 assentos), os alunos que acabaram de pegar a bandeja não conseguem entrar no salão e retêm o posto do buffet até que uma cadeira fique livre, reproduzindo com exatidão a física real do restaurante.
5. **Zero Modificação no Banco de Dados:** A simulação roda inteiramente na memória do navegador. As coletas reais salvas em `dados/` permanecem intocadas e imutáveis.

---

## 3. Como Acessar

1. Inicie o servidor localmente executando o arquivo `iniciar.bat` (ou execute `npm start` no terminal).
2. No navegador, acesse:
   👉 **`http://localhost:3000/simulacoes.html`**
3. Você também pode acessar clicando no botão **"Simulações"** presente no menu superior do **Painel ao Vivo** ou do **Histórico**.

---

## 4. Guia Passo a Passo de Uso

### Passo 1: Selecionar a Sessão Base
No canto superior direito do painel de parâmetros, abra o menu suspenso **Sessão Base** e escolha a coleta real finalizada que deseja utilizar como base da análise.

> [!NOTE]
> Para garantir representatividade estatística, são exibidas apenas sessões com status **"Finalizada"** que possuam ao menos 5 atendimentos registrados.

---

### Passo 2: Configurar os Parâmetros por Setor

A interface divide o restaurante em três zonas independentes:

#### 🔴 Fila 1: Entrada / Catraca
- **Quantidade de Catracas ($c_1$):** Selecione de 1 a 4 catracas em paralelo (o padrão herda o número de catracas ativas da sessão original).
- **Modo de Ajuste da Velocidade:**
  - **Fator de Taxa (Padrão):** Slider de $-50\%$ a $+100\%$. 
    - $+20\%$: acelera a validação em 20%.
    - $+100\%$: duplica a capacidade de atendimento da catraca (reduz o tempo pela metade).
    - Preserva a variabilidade natural de tempo entre diferentes alunos.
  - **Tempo Fixo:** Define uma duração determinística idêntica para todos os alunos (ex: 4 segundos/pessoa), eliminando variações individuais.

#### 🟢 Fila 2: Atendimento / Buffet (Bandejas e Refeição)
- **Linhas de Distribuição ($c_2$):** Selecione de 1 a 3 linhas de buffet paralelas.
- **Velocidade do Buffet:** Slider percentual de $-50\%$ a $+100\%$ para simular agilidade na entrega de pratos (ex: $+20\%$ em cardápios de montagem rápida ou $-20\%$ em dias de sobremesa fracionada).

#### 🌸 Salão & Mesas (Área de Refeição)
- **Capacidade do Salão ($C_{\text{mesas}}$):** Quantidade nominal de assentos disponíveis (padrão: 216 cadeiras). Permite simular redução de mesas para reformas ou adição de novos conjuntos de mesas.
- **Tempo de Permanência:** Slider de variação aditiva em minutos (de $-10\text{ min}$ a $+15\text{ min}$). Um ajuste de $-3\text{ min}$, por exemplo, simula alunos comendo e liberando as cadeiras 3 minutos mais rápido.

> [!TIP]
> Caso queira retornar à configuração idêntica à da sessão original a qualquer momento, clique no botão **"Restaurar Padrões"**.

---

### Passo 3: Executar a Simulação
Clique no botão azul **`▶ Executar Simulação`**. Em menos de 1 segundo, o motor de eventos discretos processará todo o fluxo e abrirá o painel comparativo.

---

## 5. Como Interpretar os Resultados

### 5.1 Banner de Calibração do Baseline
Logo no topo dos resultados, um banner indica a acurácia do modelo:
- **Verde (Calibração Aderente $\le 5\%$):** O tempo de espera do modelo sob parâmetros originais é quase idêntico ao observado em campo, comprovando que a sessão seguiu fluxo contínuo.
- **Amarelo (Calibração com Variação $> 5\%$):** Indica que a coleta empírica de campo conteve pausas operacionais manuais ou pequenas ultrapassagens/não-FIFO humanas na fila real.

---

### 5.2 Diagnóstico Operacional de Gargalos
Um cartão de destaque exibe a conclusão executiva imediata:
- 🟢 **Verde (Fluxo Equilibrado):** A capacidade atende à demanda e nenhum aluno ficou retido de pé no salão.
- 🟡 **Amarelo (Atenção no Buffet):** Acelerar a entrada na catraca gerou sobrecarga e acúmulo na Fila do Buffet.
- 🔴 **Vermelho (Alerta de Bloqueio / *Service Blocking*):** As mesas atingiram 100% de ocupação! O cartão informa exatamente **quantos alunos ficaram retidos em pé com a bandeja** e por quantos minutos o salão permaneceu saturado.

---

### 5.3 Tabela Comparativa (Real vs. Simulado)

Apresenta o impacto lado a lado com cálculo automático de $\Delta\%$ colorido:
- **Verde:** Representa melhoria operacional (redução de tempo de espera, diminuição do tamanho da fila ou aumento de atendimentos).
- **Vermelho:** Representa piora ou sobrecarga.

| Indicador | O que mede | Impacto Típico ao Adicionar Catraca |
| :--- | :--- | :---: |
| **Alunos Atendidos ($n_s$)** | Volume total de pessoas atendidas na janela de tempo. | Igual ou maior (fluxo escoado). |
| **Tempo Médio de Espera Fila 1 ($W_{q1}$)** | Tempo médio que o aluno passa na fila externa. | Redução expressiva (ex: $-70\%$). |
| **Percentil 95 (P95) Fila 1** | Pior tempo enfrentado por 95% dos alunos. | Redução crítica nos casos extremos. |
| **Fila Média ($L_{q1}$)** | Número médio de pessoas visíveis na fila externa. | Fila física muito menor. |
| **Utilização da Catraca ($\rho_1$)** | Porcentagem de tempo em que as catracas operam ocupadas. | Diminui ao dividir a carga entre 2 postos. |
| **Tempo Médio Fila 2 ($W_{q2}$)** | Espera interna para pegar a bandeja e a comida. | Pode subir se o buffet não acompanhar a entrada! |
| **Tempo de Trânsito até as Mesas** | Tempo total desde que o aluno pisa na calçada até sentar. | Indicador-chave da experiência do estudante. |
| **Alunos Bloqueados por Mesas** | Pessoas que terminaram de se servir mas não acharam cadeira. | Revela se o salão é o gargalo definitivo. |

---

### 5.4 Gráficos Analíticos Sobrepostos (Chart.js)

1. **Evolução do Tamanho da Fila (Fila 1):**
   - **Linha Azul:** Quantidade de pessoas na fila real minuto a minuto.
   - **Linha Verde:** Comportamento da fila no cenário simulado.
   - Permite visualizar claramente a dissipação de ondas de pico.
2. **Ocupação do Salão de Mesas:**
   - **Área Rosa:** Quantidade de cadeiras ocupadas ao longo do tempo no cenário simulado.
   - **Linha Tracejada Vermelha:** Capacidade limite do salão (ex: 216 cadeiras).
   - Quando a área rosa encosta na linha vermelha, o salão atingiu a saturação máxima.

---

## 6. Três Cenários Práticos de Tomada de Decisão

### Cenário 1: "Vale a pena instalar uma 2ª catraca no RU?"
- **Configuração:**
  - Fila 1: Mudar de 1 para **2 Catracas**.
  - Fila 2 e Mesas: Manter valores padrão.
- **Resultado Esperado:** O tempo médio de espera na Fila 1 cai drasticamente. Se a Fila 2 (buffet) mantiver tempo aceitável e não houver bloqueio de mesas, a 2ª catraca é uma intervenção recomendada com alto retorno.

### Cenário 2: "Se acelerarmos a entrada, as mesas vão aguentar?"
- **Configuração:**
  - Fila 1: 2 Catracas e $+20\%$ na velocidade.
  - Fila 2: 2 Linhas de Buffet.
  - Mesas: Capacidade nominal de 216 cadeiras e tempo padrão.
- **Resultado Esperado:** Permite testar o efeito cascata. Se o card de diagnóstico apontar *Alerta de Bloqueio*, fica comprovado que apenas adicionar catracas não resolve o problema do RU: os alunos apenas transferem a espera da calçada para o corredor das mesas.

### Cenário 3: "E se incentivarmos os alunos a liberarem as mesas mais rápido?"
- **Configuração:**
  - Manter postos de atendimento atuais.
  - Mesas: Ajustar tempo de permanência para **$-4\text{ min}$**.
- **Resultado Esperado:** Observa-se a liberação acelerada de assentos, aumentando a rotatividade das mesas e eliminando eventuais bloqueios na linha de buffet.

---

## 7. Exportação e Impressão de Relatórios

Para apresentar os dados em reuniões de planejamento ou anexar a relatórios técnicos:
1. No canto superior da tabela de comparação, clique em **`🖨️ Imprimir Relatório`** (ou utilize o atalho de teclado `Ctrl + P`).
2. O sistema ativa automaticamente uma folha de estilo de alta resolução (`@media print`) que:
   - Oculta menus, botões e controles interativos.
   - Converte o fundo para branco com alto contraste.
   - Formata a tabela comparativa e os gráficos sobrepostos para ajuste ideal em folhas A4 ou exportação direta em PDF.

---

## 8. Perguntas Frequentes (FAQ)

### 1. A simulação altera os dados gravados nas coletas reais?
**Não.** Os dados simulados são gerados de forma puramente volátil na memória RAM do navegador. Nenhum arquivo dentro da pasta `dados/` é sobrescrito ou modificado.

### 2. Por que o desvio da calibração não é exatamente 0%?
No mundo real, pessoas conversam, hesitam ao passar o cartão na catraca, ou amigos deixam outros passarem na frente (pequenas infrações da ordem estritamente FIFO). O modelo matemático simula a ordem de atendimento ideal; desvios de até 5% são considerados perfeitamente aderentes pelo padrão de calibração.

### 3. O módulo funciona sem internet?
**Sim.** Todo o processamento matemático é executado no motor local `shared/simulador.js` e os gráficos utilizam a biblioteca Chart.js já armazenada no próprio projeto (`public/lib/chart.umd.min.js`). Nenhuma conexão externa à internet é necessária.

---

Para detalhes sobre a fundamentação matemática e o catálogo de métricas formais, consulte também:
- [DOCUMENTACAO_PROJETO.md](file:///c:/Users/ghost/Documents/outubro/fila-ru/DOCUMENTACAO_PROJETO.md)
- [METRICAS.md](file:///c:/Users/ghost/Documents/outubro/fila-ru/METRICAS.md)
- [PROMPT_SIMULACOES.md](file:///c:/Users/ghost/Documents/outubro/fila-ru/PROMPT_SIMULACOES.md)
