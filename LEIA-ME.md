# Sistema Colaborativo de Coleta e Análise de Percurso - Fila do RU

Sistema web para coleta colaborativa e análise estatística em tempo real de todo o fluxo de alunos no Restaurante Universitário (RU), dividido em **zonas configuráveis** com múltiplos **pontos de verificação**.

O notebook funciona como servidor central via Hotspot Móvel do Windows, e smartphones conectados via navegador atuam como clientes dedicados para os avaliadores posicionados em cada ponto físico do restaurante.

---

## 🗺️ Modelo do Percurso e Zonas

```
Pessoas novas (origem, não medida)
  → [P0 Chegada]              → Z1 Fila inicial (vermelho)
  → [P1 Catraca]              → Z2 Atendimento (verde)
  → [P2 Saída do atendimento] → Z3 Mesas (rosa)
  → [P3 Saída das mesas]      → Saída (sumidouro, laranja)
```

| Zona | Cor | Começa em | Termina em | Modo | Descrição |
|---|---|---|---|---|---|
| **Z1 Fila inicial** | Vermelho (`#dc2626`) | P0: Aluno entra na fila | P1: Passa pela catraca | `fifo` | Fila com ordem estrita de atendimento. |
| **Z2 Atendimento** | Verde (`#16a34a`) | P1: Catraca | P2: Sai do balcão de servir | `fifo` | Deslocamento e montagem da bandeja. |
| **Z3 Mesas** | Rosa (`#db2777`) | P2: Senta às mesas | P3: Se dirige à saída | `contagem` | Permanência no refeitório para consumo da refeição. |

- **Pontos de verificação**: São as transições entre a Origem, as zonas habilitadas e a Saída (`k` zonas habilitadas geram `k+1` pontos).
- **Fusão de pontos**: Se uma zona for desabilitada na configuração, os pontos vizinhos se fundem automaticamente (ex.: desativando Mesas, P2 e P3 viram um único ponto `z2->saida`, denominado "Saída do atendimento").

---

## ⚙️ 1. Configuração das Zonas (Painel do Notebook)

Na aba **"Zonas"** do painel do notebook (`/painel.html`):

1. **Modelos Pré-definidos (Presets)**:
   - **Completo (Fila, Atendimento, Mesas)**: 3 zonas habilitadas, 4 pontos de verificação (P0 Chegada, P1 Catraca, P2 Saída Atendimento, P3 Saída Mesas).
   - **Fila + Atendimento**: 2 zonas habilitadas, 3 pontos (P0 Chegada, P1 Catraca, P2 Saída Atendimento para Saída).
   - **Somente fila**: 1 zona habilitada, 2 pontos (P0 Chegada, P1 Catraca para Saída).
   - **Modelos personalizados**: É possível criar sua própria combinação e clicar em **💾 Salvar Preset** para reutilizá-la em dias futuros. Os presets ficam salvos no disco em `dados/presets.json`.

2. **Adição e Remoção de Zonas Personalizadas**:
   - É possível incluir novas zonas em qualquer posição da cadeia (ex.: "Caixa", "Bebedouro", "Devolução de Bandejas").
   - Cada zona possui: Nome, Cor representativa, Modo (`fifo` ou `contagem`), Capacidade opcional (ex.: número de assentos nas mesas) e Quantidade de servidores/atendentes.
   - Zonas podem ser removidas ou reordenadas antes do início da sessão.

3. **Bloqueio Rígido ao Iniciar a Sessão**:
   - Ao clicar em **▶ Iniciar Nova Sessão**, a topologia das zonas e pontos é **travada** e gravada no evento `sessao_iniciada`.
   - **Durante a coleta**: Não é permitido habilitar, desabilitar ou acrescentar zonas (para resguardar a integridade estatística). Apenas cores, nomes cosméticos de pontos, capacidades nominais e a delegação de aparelhos podem ser ajustados.
   - A pré-visualização gráfica da cadeia e a tabela de pontos resultantes são atualizadas em tempo real antes do início.

---

## 👥 2. Delegação de Aparelhos por Ponto

Na aba **"Aparelhos e Pontos"** do painel do notebook:

1. **Matriz de Delegação**:
   - Matriz interativa com os aparelhos conectados nas linhas e os pontos de verificação nas colunas.
   - Permite marcação múltipla: um aparelho pode cobrir vários pontos, e um ponto pode ter um ou mais aparelhos.
   - A alteração passa a valer **imediatamente** no celular do operador sem recarregar a página, sendo auditada no log da sessão como evento `atribuicao` (com timestamp e autor), sem interferir nas métricas dos alunos.

2. **Ações Rápidas de Distribuição**:
   - **Distribuição Automática**: Divide os pontos contiguamente entre os aparelhos conectados (ex.: com 4 aparelhos, cada um recebe 1 ponto; com 2 aparelhos, P0+P1 para o primeiro e P2+P3 para o segundo; com 1 aparelho, todos os pontos).
   - **Operador Único**: Atribui todos os pontos ao mesmo aparelho selecionado.
   - **Atribuição em 1 Clique**: Pontos sem operador exibem um aviso amarelo no painel com botão de atribuição rápida ao aparelho disponível mais próximo.

3. **Papéis de Segurança e Validação no Servidor**:
   - `avaliador`: Pode registrar, anular e reverter eventos **apenas nos pontos que lhe foram atribuídos**. Comandos enviados para outros pontos são rejeitados pelo servidor com o código `PONTO_NAO_ATRIBUIDO`.
   - `supervisor`: Possui permissão irrestrita para registrar e reverter em qualquer ponto.
   - `observador`: Aparelho em modo somente visualização (exibe a animação e indicadores, com botões de ação desabilitados).

4. **Alertas e Indicadores de Cobertura**:
   - Alerta visual para ponto habilitado sem aparelho conectado.
   - Alerta de risco para pontos em modo `contagem` com múltiplos aparelhos atribuídos simultaneamente (risco de contagem duplicada).
   - Indicador de **cobertura por ponto**: percentual do tempo total da sessão em que o ponto esteve ativamente monitorado por ao menos um aparelho.

---

## 🏷️ 3. Cartões Impressos e Autoatribuição via QR Code (`/pontos.html`)

O sistema disponibiliza a página dedicada **`http://localhost:3000/pontos.html`**, pronta para impressão:

1. **Estrutura dos Cartões**:
   - Cada ponto de verificação possui um cartão individual emoldurado com cabeçalho colorido, ícone da zona correspondente, identificador técnico (`de -> para`) e orientações de operação.
   - Contém um **QR Code individual de alta precisão** com link direto pré-configurado: `/celular.html?ponto=<pontoId>`.
   - Lembrete visual do PIN de segurança de 4 dígitos da sessão.
   - Layout com regras `@media print` para quebra de página limpa e visual nítido em folhas A4.

2. **Fluxo de Autoatribuição**:
   - Os cartões podem ser impressos previamente e afixados nos respectivos locais do RU (porta de entrada, catraca, saída do balcão, porta de saída).
   - Ao chegar no posto, o avaliador aponta a câmera do smartphone para o QR Code da folha e digita o PIN.
   - O celular abre diretamente configurado com a interface do ponto escaneado, e o servidor atribui aquele ponto ao aparelho no mesmo instante, sem necessidade de tocar no notebook.

---

## 📋 4. Guia de Distribuição Conforme o Número de Avaliadores

O número de avaliadores disponíveis costuma variar a cada dia de coleta. Utilize o guia abaixo para obter a maior precisão possível:

| Avaliadores | P0: Chegada (`origem->z1`) | P1: Catraca (`z1->z2`) | P2: Saída Atend. (`z2->z3`) | P3: Saída Mesas (`z3->saida`) | Observações |
|:---:|:---:|:---:|:---:|:---:|---|
| **1 Avaliador** | Aparelho 1 | Aparelho 1 | Aparelho 1 | Aparelho 1 | Modo **Operador Único**. O avaliador deve ficar em local com visão ampla (ou utilizar a simulação/registro no notebook). Recomendado focar em *Fila + Atendimento* ou *Somente Fila* se o fluxo for muito intenso. |
| **2 Avaliadores** | Aparelho 1 | Aparelho 1 | Aparelho 2 | Aparelho 2 | **Distribuição Contígua**: Aparelho 1 fica próximo à entrada/catraca cobrindo a fila inicial; Aparelho 2 cobre o final do atendimento e a saída do refeitório. |
| **3 Avaliadores** | Aparelho 1 | Aparelho 2 | Aparelho 3 | Aparelho 3 | Aparelho 1 dedicado na porta de entrada; Aparelho 2 focado exclusivamente na catraca; Aparelho 3 cobre a saída do atendimento e a saída das mesas. |
| **4 Avaliadores** | Aparelho 1 | Aparelho 2 | Aparelho 3 | Aparelho 4 | **Configuração Ideal**: Um avaliador dedicado por ponto de verificação, garantindo 100% de precisão e sem sobrecarga cognitiva. |
| **5+ Avaliadores** | Aparelho 1 | Aparelho 2 | Aparelho 3 | Aparelho 4 | Avaliadores adicionais atuam como `supervisor` volante, apoio em anotações de campo ou observadores com acompanhamento da animação em tablets. |

---

## 🧪 5. Roteiro de Ensaio Prévio no Local (Checklist Pré-Coleta)

Realize este ensaio de **5 a 10 minutos** antes do início do fluxo de alunos:

1. [ ] **Infraestrutura**:
   - Notebook conectado à tomada.
   - Ponto de acesso Hotspot Móvel do Windows ligado no notebook (`192.168.137.1`).
   - Servidor iniciado via `iniciar.bat`. PIN de 4 dígitos anotado e visível.
2. [ ] **Posicionamento Físico**:
   - Cartões impressos de `/pontos.html` fixados com fita nos postos físicos correspondentes (Entrada, Catraca, Balcão, Saída).
3. [ ] **Smartphones dos Avaliadores**:
   - Todos os celulares conectados à rede Wi-Fi do notebook.
   - **Importante**: Desativar os Dados Móveis (4G/5G) nos celulares para evitar que o sistema operacional mude de rede por falta de internet.
   - Bloqueio automático de tela desativado ou configurado para 30 minutos nas opções do celular.
4. [ ] **Autoatribuição**:
   - Cada avaliador escaneia o QR Code do seu posto com a câmera do celular, digita o PIN e o seu nome.
   - No painel do notebook (`/painel.html`), confirme na aba **"Delegação"** se todos os pontos estão verdes e com os celulares corretos atribuídos.
5. [ ] **Teste de Circulação Real**:
   - Crie uma sessão de teste com o nome `Ensaio`.
   - Simule o percurso de 2 pessoas voluntárias (ou clique em "Simular Coleta de Teste" no painel):
     - Operador da Entrada registra 2 chegadas (`P0`).
     - Operador da Catraca registra a passagem das 2 pessoas (`P1`).
     - Operador do Atendimento registra a saída do balcão (`P2`).
     - Operador das Mesas registra a saída do salão (`P3`).
   - Verifique se a animação do painel acompanhou com fluidez a transição dos alunos por todas as cores: Roxo $\to$ Vermelho $\to$ Verde $\to$ Rosa $\to$ Laranja $\to$ Sumidouro.
   - Teste um comando de anulação (`×`) e o botão de anotação (`📝`).
6. [ ] **Início Oficial**:
   - Encerre a sessão de ensaio.
   - Crie a sessão oficial da coleta com o nome da refeição (ex.: *Almoço RU - Quarta-feira*), selecione o modelo de zonas e clique em **▶ Iniciar Nova Sessão**.

---

## 🔬 6. Pressupostos Adotados e Divergências do Comportamento Ideal

1. **Estimativa de Identidade em Zonas de Contagem (`contagem`)**:
   - Na zona de mesas, os alunos não se sentam nem se levantam em ordem estritamente FIFO (alguns comem mais rápido, outros conversam em grupo).
   - O servidor registra os horários de entrada e saída de forma rigorosa. A duração média de permanência ($\sum t_{saida} - \sum t_{entrada}$) é **matematicamente exata**, independente da ordem de saída.
   - No entanto, a associação individual de qual aluno saiu em cada momento é **estimada** (adotando o aluno mais antigo presente). Todas as tabelas, gráficos de dispersão e percentis (P50, P90, P95) relativos a zonas de contagem exibem a legenda e aviso: `estimado (ordem FIFO assumida)`.

2. **Compensação de Inversão Temporal (`janelaInversaoS = 20s`)**:
   - Em momentos de fluxo rápido, o avaliador da catraca (P1) ou do balcão (P2) pode registrar uma passagem frações de segundo antes do avaliador anterior (P0) registrar a chegada (devido a latência de toque ou ligeiro atraso humano).
   - Quando um comando a jusante chega com a zona de montante vazia, o servidor não rejeita o comando imediatamente; ele retém o evento em uma fila de inversão pendente por uma janela tolerante (padrão de 20 segundos) e informa o celular: *"Aguardando registro no ponto anterior..."*.
   - Assim que o registro a montante chega dentro do prazo:
     - O servidor reconcilia os dois eventos.
     - Corrige o timestamp efetivo: $t_{efetivo} = \min(t_{montante}, t_{jusante})$.
     - Marca ambos os eventos com `inversaoCorrigida: true` no log de auditoria.
   - Se o prazo de 20s expirar sem o evento a montante, o comando é descartado, gravado em `rejeitados.jsonl` com o código `EXPIRADO`, e o dispositivo é notificado.

3. **Garantia de Idempotência por `clientEventId`**:
   - Cada comando gerado no celular recebe um identificador único universal (`clientEventId`).
   - Se houver oscilação de sinal Wi-Fi e o navegador reenviar a mensagem, o servidor reconhece o identificador duplicado e responde com o mesmo resultado original, impedindo duplicidade de pessoas ou registros.

4. **Balanço Estrito de Conservação de Fluxo**:
   - Todas as métricas e relatórios auditam a equação de conservação:
     $$\text{Chegadas} - \text{Saídas} - \text{Anuladas} = \text{Presentes no Sistema}$$
   - Caso haja qualquer discrepância numérica, o sistema alerta o operador no relatório de auditoria e na exportação CSV.

5. **Proteção de Reversão (`PESSOA_JA_AVANCOU`)**:
   - A reversão de uma passagem só é autorizada se o aluno ainda estiver presente na cabeça da zona para a qual acabou de passar.
   - Se o aluno já tiver avançado para um ponto subsequente, a reversão do ponto anterior é sumariamente bloqueada com o código `PESSOA_JA_AVANCOU` para evitar corrupção na linha do tempo das zonas.

6. **Independência de Internet e Infraestrutura Local**:
   - O sistema opera 100% isolado (offline), utilizando apenas as bibliotecas `ws` e `qrcode` instaladas localmente no Node.js.
   - Todos os arquivos estáticos (HTML, JS, CSS, SVG) são servidos pelo próprio servidor local sem requisições a CDNs externas.
   - As exportações CSV utilizam codificação `UTF-8 com BOM`, delimitador ponto e vírgula (`;`) e vírgula como separador decimal para compatibilidade imediata com o Microsoft Excel e LibreOffice Calc.

