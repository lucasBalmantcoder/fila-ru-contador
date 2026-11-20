# PROMPT DE ESPECIFICAÇÃO TÉCNICA: AJUSTE DO SIMULADOR PARA EFICIÊNCIA OPERACIONAL E FIDELIDADE AO TRAÇO REAL

**Papel:** Você é um Engenheiro de Software Sênior especialista em Teoria das Filas, Simulação de Eventos Discretos (DES) e Arquiteturas baseadas em Event Sourcing.  
**Objetivo:** Corrigir a modelagem e a extração de dados em `shared/simulador.js`, garantindo que o simulador guiado por traço histórico (Trace-Driven DES):
1. **No Cenário Padrão / Baseline ($c_1 = 1, c_2 = 1, \Delta_{\text{taxa}} = 0\%$):** Reproduza com fidelidade matemática a sessão real coletada, atendendo **exatamente o mesmo número total de alunos** (ex: $n_s^{\text{sim}} = n_s^{\text{real}} = 192$ alunos, variação de $0{,}0\%$), sem descartar chegadas iniciais ou truncar a sessão.
2. **Nos Cenários de Melhoria / "What-If" ($c_1 > 1$, $c_2 > 1$, aceleração de atendimento):** Processe a **mesma demanda original integral de 192 alunos**, simulando o atendimento em paralelo multisservidor ($c_1$ catracas, $c_2$ buffets) para demonstrar com precisão os **ganhos reais de eficiência** (redução no tempo de espera $W_q$, redução da fila $L_q$, escoamento do lote inicial e eliminação de gargalos).

---

## 1. DIAGNÓSTICO DO PROBLEMA ATUAL

Ao executar a simulação da sessão real `Almoço RU - quarta (essa)` (192 atendimentos reais na Catraca) com os parâmetros padrão ($c_1=1, c_2=1$, sem alteração de velocidade), o sistema reportou:
- **Cenário Real:** $192$ alunos atendidos, $02:11$ de espera média na Fila 1, $12{,}65$ na fila média ($L_{q1}$).
- **Cenário Simulado:** $167$ alunos atendidos ($-13{,}0\%$), $00:27$ de espera média ($-79{,}0\%$), $0{,}84$ na fila média ($-93{,}4\%$).

### Causas Raízes Identificadas:
1. **Exclusão de Chegadas de Ajuste Inicial:**
   Em `shared/simulador.js` (linha 66):
   ```javascript
   const chegadasF1Reais = eventosReais
     .filter(e => e.tipo === 'chegada' && Number(e.fila || 1) === 1 && !e.ajuste)
   ```
   O filtro `!e.ajuste` descartou 35 alunos reais que já estavam na fila no momento da abertura do RU (registrados pelo coletor como `chegada` com `ajuste: true` e atendidos normalmente ao longo da sessão). Ao descartar essas 35 pessoas:
   - A simulação iniciou com a fila vazia (0 pessoas) em vez de 35 pessoas acumuladas na porta.
   - O tempo de espera caiu artificialmente de 2m11s para 27 segundos, pois os primeiros alunos não tiveram que esperar o escoamento da fila inicial.
   - Alunos foram subtraídos da contagem final.

2. **Divergência entre Eventos Brutos e Estado Consolidado:**
   Em sessões de campo, o arquivo `eventos.jsonl` pode conter eventos operacionais de anulação, reversão e correções manuais. Em vez de filtrar arrays soltos de eventos brutos, o estado final consolidado da sessão é determinado deterministicamente por `derivarEstado(eventosReais)`.
   Em `derivarEstado(eventosReais).pessoas`:
   - A Fila 1 possui exatamente **192 alunos com status `atendida`**.
   - Cada aluno possui `chegadaMs` e `atendimentoMs` consolidados.

3. **Corte Prematuro por Encerramento de Sessão:**
   A inclusão ou manipulação de múltiplos eventos `sessao_encerrada` fazia com que `derivarEstado` / `calcularMetricas` interrompesse a apuração no timestamp do primeiro encerramento, deixando alunos que ainda estavam em atendimento como "não atendidos".

---

## 2. REQUISITOS TÉCNICOS DA CORREÇÃO

### R1. Extração Fiel da População de Alunos a partir de `derivarEstado`
Em `shared/simulador.js`, a extração da demanda histórica de alunos a serem simulados deve utilizar o estado consolidado da sessão original:
```javascript
import { derivarEstado } from './estado.js';

const estadoOriginal = derivarEstado(eventosReais);
```
1. **Coorte Efetiva de Alunos da Fila 1:**
   - Selecionar todos os alunos atendidos na Fila 1:
     ```javascript
     const alunosF1Originais = (estadoOriginal.pessoas || [])
       .filter(p => (p.fila || 1) === 1 && p.status === 'atendida')
       .sort((a, b) => a.chegadaMs - b.chegadaMs || a.pessoa - b.pessoa);
     ```
   - Isso garante que **todos os 192 alunos atendidos na realidade** estejam presentes na simulação, independentemente de terem entrado por ajuste de início de sessão ou por chegada avulsa.
   - Pessoas que foram anuladas na sessão real (`p.status === 'anulada'`) não devem ser computadas no serviço das catracas.

2. **Tempos de Serviço Empíricos Puros ($s_1$, $s_2$, $s_{\text{mesas}}$):**
   - Para cada aluno $i$ atendido em F1:
     - O tempo de serviço empírico $s_{1,i}$ deve ser extraído do intervalo de atendimento observado (`p.intervaloAtendimentoMs`). Caso ausente ou quando houver pausa operacional prolongada da catraca (> 45s), aplicar a mediana de serviço da sessão ($\sim 7{,}8\text{s}$).
     - Garantir piso mínimo físico de serviço de catraca: $\ge 2{,}0$ segundos ($2000\text{ ms}$).
   - Para a Fila 2 (Buffet):
     - Para alunos que foram atendidos na F2 original (`p.fila === 2 && p.status === 'atendida'`), utilizar seu tempo de preparo observado. Para os demais, utilizar a mediana observada da F2 ($\sim 7{,}0\text{s}$ a $8{,}0\text{s}$, mínimo $3{,}0\text{s}$).
   - Para o Salão de Mesas:
     - Para alunos com permanência registrada na F3 original, utilizar sua duração de mesa. Para os demais, utilizar a mediana observada da sessão ($\sim 15$ a $20$ minutos, mínimo $1$ minuto).

### R2. Calibração do Cenário Baseline ($c_1=1, c_2=1, \text{fatores}=0\%$)
Quando os parâmetros forem os originais da sessão:
1. O simulador deve reproduzir os 192 atendimentos da Catraca:
   $$n_s^{\text{sim}} = n_s^{\text{real}} = 192 \quad (\Delta n_s = 0{,}0\%)$$
2. O tempo de espera simulado no baseline deve refletir o acúmulo da fila real na abertura (os 35 alunos iniciais aguardando atendimento), mantendo o desvio em relação ao $W_{q1}$ real dentro da tolerância de calibração ($\le 5\%$).
3. O log gerado para a simulação deve ter os eventos canônicos:
   - `sessao_iniciada` no instante $t_{\text{inicio}}$.
   - Para cada aluno: `chegada` (F1), `atendimento` (F1), `chegada` encadeada (F2), `atendimento` (F2), `chegada` encadeada (F3) e `atendimento` (F3).
   - O evento `sessao_encerrada` DEVE ser único e posicionado em $t_{\text{fimSim}} = \max(t_{\text{fimReal}}, t_{\text{ultimoEvento}} + 1000)$, garantindo que todos os 192 alunos concluam o circuito sem truncamento.

### R3. Modelagem de Eficiência "What-If" ($c_1 > 1$, $c_2 > 1$)
O objetivo central do módulo é permitir ao gestor do RU testar melhorias operacionais:
1. **Adição de Catracas ($c_1 \ge 2$):**
   - Os 192 alunos chegam aos mesmos instantes $t_{\text{cheg}, i}$ registrados na coleta.
   - Disciplina de Fila: Fila única FIFO compartilhada por $c_1$ catracas em paralelo.
   - Cada catraca $k \in \{1, \dots, c_1\}$ mantém seu timestamp de liberação `servidoresF1[k]`.
   - Ao chegar a vez do aluno, ele é despachado para a catraca que ficar livre primeiro:
     $$t_{\text{ini}, i} = \max(t_{\text{cheg}, i}, \min_k(\text{servidoresF1}[k]))$$
     $$t_{\text{atend}, i} = t_{\text{ini}, i} + s_{1, i}^{\text{sim}}$$
   - **Resultado Esperado:** Com $c_1 = 2$, a fila acumulada no início de 35 alunos é absorvida no dobro da velocidade! O tempo médio de espera $W_{q1}$ deve cair significativamente em relação a $c_1 = 1$, provando a eficiência do investimento na segunda catraca. O total atendido permanece $192$ alunos.

2. **Adição de Linhas de Buffet ($c_2 \ge 2$):**
   - Cada aluno liberado da catraca no instante $t_{\text{atend}, 1, i}$ entra imediatamente na Fila 2 ($t_{\text{cheg}, 2, i} = t_{\text{atend}, 1, i}$).
   - As $c_2$ linhas de buffet atendem em paralelo com fila única FIFO.
   - Se $c_1 = 2$ e $c_2 = 1$, o simulador deve demonstrar realisticamente o **efeito gargalo**: a entrada escoa rápido, mas a fila do buffet cresce.
   - Se $c_2 = 2$, o buffet escoa fluidamente em direção às mesas.

3. **Bloqueio por Falta de Assentos no Salão ($C_{\text{mesas}} = 216$):**
   - Quando o aluno termina de montar a bandeja no buffet ($t_{\text{fimPreparo2}}$), verifica se $\text{mesasOcupadas} < C_{\text{mesas}}$.
   - Se houver assento: ocupa a cadeira, libera o servidor do buffet e agenda a desocupação para $t_{\text{fimPreparo2}} + s_{\text{mesas}, i}$.
   - Se o salão estiver lotado ($= 216$ cadeiras ocupadas): o aluno fica bloqueado em pé com a bandeja na saída do buffet, retendo a linha de atendimento até que uma mesa seja liberada (Service Blocking).

---

## 3. ARQUIVOS A MODIFICAR

1. `shared/simulador.js`:
   - Atualizar a função `simularSessao()` para extrair a coorte de alunos a partir de `derivarEstado(eventosReais).pessoas`, garantindo todos os alunos atendidos na sessão real ($192$ no caso da sessão de teste).
   - Ajustar o despacho multisservidor paralelo $c_1$ e $c_2$ para operar sobre a coorte completa.
   - Assegurar que o evento `sessao_encerrada` só ocorra após a conclusão de todos os eventos gerados.
2. `teste/testes.js`:
   - Adicionar casos de teste automatizados específicos:
     - **Teste 1:** Simulação baseline da sessão real de almoço (`azuq2`) preserva $n_s = 192$ atendimentos ($0{,}0\%$ de perda de alunos).
     - **Teste 2:** Simulação com $c_1 = 2$ atende os mesmos $192$ alunos, com $W_{q1}(c_1=2) < W_{q1}(c_1=1)$ e pico de fila menor.
     - **Teste 3:** Todos os 197 testes anteriores devem continuar passando com status verde.

---

## 4. CRITÉRIOS DE ACEITAÇÃO

1. **Conservação da População:**
   No baseline de qualquer sessão válida, a contagem de atendidos na Fila 1 simulada deve ser rigorosamente igual à da sessão real:
   $$n_s^{\text{sim}} = n_s^{\text{real}}$$
2. **Avaliação Fiel de Eficiência:**
   Ao simular $c_1 = 2$, a tabela comparativa deve exibir:
   - Alunos Atendidos: $192$ Real vs. $192$ Simulado ($\Delta = 0{,}0\%$).
   - Tempo Médio de Espera na Catraca: redução expressiva em relação ao cenário real (exibido em verde com $\Delta\%$ negativo).
   - Fila Média e Pico de Fila: redução proporcional demonstrando o ganho de eficiência da 2ª catraca.
3. **Sem Regressões:**
   A execução de `npm test` deve passar com 100% de sucesso.
