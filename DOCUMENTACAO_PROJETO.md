# Documentação do Projeto: Fila RU

**Sistema Colaborativo em Tempo Real para Coleta, Monitoramento e Análise de Desempenho de Filas em Restaurantes Universitários**

---

## 1. Visão Geral e Propósito

O **Fila RU** é uma solução computacional de engenharia desenvolvida para resolver um problema clássico de Pesquisa Operacional e Engenharia de Produção: **a coleta, monitoramento em tempo real e análise estocástica do fluxo de pessoas e tempos de espera no Restaurante Universitário (RU)**.

### 1.1 O Desafio Real

Em restaurantes universitários com alto volume de atendimento:

- As filas oscilam bruscamente em horários de pico, gerando gargalos na entrada, no atendimento/serviço das refeições ou na ocupação das mesas.
- Medições tradicionais com pranchetas, cronômetros ou contadores manuais são sujeitas a erros humanos graves, dessincronização entre operadores e perda de dados.
- Ambientes de campo frequentemente possuem sinal de internet móvel (4G/5G) instável ou inexistente dentro dos refeitórios.

### 1.2 A Solução

O Fila RU transforma um notebook comum em uma **central de coleta e processamento autônoma**, que emite um ponto de acesso Wi-Fi local (Hotspot móvel do Windows). Múltiplos pesquisadores/operadores posicionados em pontos estratégicos (porta de entrada, catracas, balcão de refeições e mesas) utilizam seus próprios smartphones para registrar chegadas e atendimentos via navegador web, **sem necessidade de instalar aplicativos e sem consumir internet externa**.

Todos os dados são transmitidos em frações de segundo via WebSockets locais, sincronizando um painel de controle em tempo real e gravando um histórico contínuo para geração imediata de relatórios científicos, indicadores da Teoria das Filas e animações de replay.

---

## 2. Arquitetura do Sistema e Engenharia de Software

O projeto adota uma arquitetura orientada a eventos (_Event Sourcing_), minimalista e focada em máxima confiabilidade em campo (_offline-first_).

```
 ┌──────────────────────────────────────────────────────────────┐
 │                       NOTEBOOK (Servidor)                    │
 │                                                              │
 │   ┌──────────────────────────────────────────────────────┐   │
 │   │ Hotspot Wi-Fi Local (ex: 192.168.137.1:3000)         │   │
 │   └──────────────────────────────────────────────────────┘   │
 │                              │                               │
 │   ┌───────────────────────┐  │  ┌────────────────────────┐   │
 │   │ Node.js Nativo (HTTP) │◄─┴─►│  WebSocket Server (ws) │   │
 │   └───────────────────────┘     └────────────────────────┘   │
 │               │                              │               │
 │               ▼                              ▼               │
 │   ┌───────────────────────┐     ┌────────────────────────┐   │
 │   │  Log Append-Only      │     │  Painel do Coordenador │   │
 │   │  (eventos.jsonl)      │     │  (painel.html)         │   │
 │   └───────────────────────┘     └────────────────────────┘   │
 └───────────────────────────────▲──────────────────────────────┘
                                 │ Wi-Fi Local (WebSockets)
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
 ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
 │ Operador 1   │         │ Operador 2   │         │ Operador 3   │
 │ (Entrada F1) │         │ (Catraca F2) │         │ (Mesas/Saída)│
 │ Smartphone   │         │ Smartphone   │         │ Smartphone   │
 └──────────────┘         └──────────────┘         └──────────────┘
```

### 2.1 Princípios de Design

1. **Zero Dependências Pesadas (_Vanilla Stack_)**:
    - Desenvolvido em **Node.js nativo (ES Modules)**, utilizando apenas duas bibliotecas externas em produção: `ws` (WebSockets) e `qrcode` (geração de QR Code no terminal).
    - Sem frameworks de backend pesados (sem Express) e sem etapas de compilação/build complexas no frontend (sem React, Vue ou bundlers). O código abre e roda instantaneamente em qualquer máquina.

2. **Isomorfismo de Código (`shared/`)**:
    - Os módulos `shared/estado.js`, `shared/metricas.js` e `shared/movimento.js` são puramente funcionais e isomórficos: o mesmíssimo arquivo executa no servidor Node.js e no navegador dos clientes, garantindo que o cálculo de métricas e estados seja idêntico em todas as pontas.

3. **Arquitetura Baseada em Event Sourcing**:
    - O sistema não guarda apenas o "estado final" da fila. Ele armazena um fluxo estrito e imutável de eventos ordenados no arquivo `eventos.jsonl`:
        - `sessao_iniciada`
        - `entrada`
        - `saida`
        - `anulacao` (remover pessoa da fila por engano)
        - `reversao` (desfazer atendimento incorreto)
        - `ajuste_fila` (correção em lote)
        - `anotacao` (registro de anomalias operacionais, ex: "reposição de travessas")
        - `sessao_encerrada`
    - O estado do sistema em qualquer instante de tempo $t$ é derivado através da função pura `derivarEstado(eventos, t)`. Isso possibilita **reprodução temporal (replay)** com precisão de milissegundos e auditoria completa.

4. **Resiliência a Quedas de Rede (_Fila Offline no Dispositivo_)**:
    - Se um operador se afastar do alcance do Wi-Fi do notebook, o script do smartphone (`celular.js`) armazena as marcações em uma fila de envio persistida no `localStorage`.
    - Ao restabelecer a conexão, o cliente descarrega a fila pendente em ordem estrita de timestamps para o servidor sem perda de dados.

5. **Proteção de Concorrência e PIN de Segurança**:
    - Ao iniciar a sessão, o servidor gera um **PIN aleatório de 4 dígitos** exibido no terminal e em QR Code. Somente operadores autenticados podem enviar comandos.
    - Proteção contra duplo clique ou operadores simultâneos: se dois operadores tentarem atender a mesma pessoa simultaneamente na catraca, o servidor valida o primeiro e rejeita o segundo com mensagem atômica (`JA_ATENDIDO`).

---

## 3. Modelagem Física do Fluxo (As 3 Filas e Salão)

O sistema modela o restaurante através de até três filas sequenciais com **encadeamento atômico** de dados:

```
[Chegada dos Alunos]
        │
        ▼
┌──────────────────┐
│      FILA 1      │  Cor: Vermelha
│  (Entrada RU)    │  Fila de espera externa até a catraca de identificação/pagamento
└────────┬─────────┘
         │ Encadeamento Atômico (1 > 2)
         ▼
┌──────────────────┐
│      FILA 2      │  Cor: Verde
│ (Atendimento RU) │  Fila interna para pegar bandejas, talheres e servir a refeição
└────────┬─────────┘
         │ Encadeamento Atômico (2 > 3)
         ▼
┌──────────────────┐
│  SALÃO DE MESAS  │  Capacidade Nominal: 216 cadeiras (36 mesas x 6 cadeiras)
│  (Refeição)      │  Acompanhamento dinâmico de taxa de ocupação e lotação
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  FILA 3 / SAÍDA  │  Cor: Rosa
│ (Fluxo Contínuo) │  Efluxo contínuo de alunos que terminaram e deixam o salão
└──────────────────┘
```

### 3.1 Detalhamento das Zonas

- **Fila 1 (Entrada → Catraca)**: Modela a fila externa de alunos aguardando validação na catraca. O tempo nesta fila reflete a restrição de capacidade dos guichês/catracas de entrada.
- **Fila 2 (Catraca → Atendimento/Bandejas)**: Ao passar pela catraca, a pessoa entra de forma atômica na Fila 2, preservando o mesmo número de identificador e timestamp. Mede o tempo gasto na linha de servir.
- **Salão & Mesas (216 Assentos)**: Modela a permanência dos alunos durante a refeição. São 4 fileiras com 9 mesas de 6 lugares cada. O sistema calcula a ocupação instantânea e o nível de estresse do salão (_Tranquilo_ < 50%, _Moderado_ 50-74%, _Quase Cheio_ 75-89%, _Lotado_ ≥ 90%).
- **Fila 3 / Saída (Mesas → Saída)**: Fluxo contínuo dos alunos em direção ao descarte de bandejas e porta de saída.

### 3.2 Modos de Monitoramento (Presets)

A plataforma permite adaptar a coleta aos recursos humanos disponíveis no dia:

1. **Somente Fila (`somente_fila`)**: Apenas 1 ou 2 operadores monitorando a Fila 1 (Entrada e Catraca).
2. **Fila + Atendimento (`fila_atendimento`)**: Monitora a entrada, catraca e linha de servir.
3. **Fluxo Completo (`completo`)**: Monitora da calçada de entrada até a saída final após as mesas.

---

## 4. Fundamentação Matemática e Catálogo de Métricas

O Fila RU implementa formalmente os postulados da **Teoria das Filas** (sistemas $M/M/c$, $M/G/c$ ou $G/G/c$). O catálogo de métricas conta com mais de 100 indicadores estáveis (especificados no `METRICAS.md` de `M-01` a `M-122`).

### 4.1 Principais Métricas Calculadas

| Indicador                        |         Símbolo / Código          | Significado Operacional                                                                                                                  |
| :------------------------------- | :-------------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **Taxa Média de Chegadas**       |        $\lambda$ (`M-10`)         | Quantidade média de pessoas que chegam por minuto ($n_e / T$).                                                                           |
| **Taxa Média de Serviço**        |      $\mu$ (`M-13`, `M-14`)       | Capacidade de atendimento por minuto ($1 / \bar{t}_{\text{serviço}}$). Diferencia capacidade global de capacidade em ocupação.           |
| **Fator de Utilização**          |          $\rho$ (`M-16`)          | Razão de uso do sistema: $\rho = \frac{\lambda}{c \cdot \mu}$, onde $c$ é o número de servidores/postos.                                 |
| **Tempo de Espera na Fila**      |      $W_q$ (`M-20` a `M-26`)      | Tempo que o estudante passa na fila. Reporta média, mediana, desvio padrão, mínimo, máximo, **P90** e **P95**.                           |
| **Tamanho Médio da Fila**        |          $L_q$ (`M-40`)           | Número médio de pessoas aguardando ao longo do tempo, calculado como média ponderada no tempo.                                           |
| **Validação da Lei de Little**   | $L = \lambda W$ (`M-50` a `M-53`) | Confirmação experimental do teorema fundamental da teoria das filas: desvio percentual entre $L_{\text{observado}}$ e $\lambda \cdot W$. |
| **Variabilidade dos Intervalos** |       $CV$ (`M-33`, `M-39`)       | Coeficiente de variação dos intervalos entre saídas e chegadas ($DP / Média$). Serve de teste de Poisson (onde $CV \approx 1$).          |
| **Ociosidade Estruturada**       |          `M-60` a `M-66`          | Decomposição do tempo sem atendimento em: (a) falta de alunos, (b) paradas operacionais/reposições, ou (c) falta de operador.            |
| **Tempos de Trânsito Total**     |          `M-86` a `M-88`          | Tempo total decorrido do instante em que o aluno pisa na fila externa até sentar na mesa ou deixar o RU.                                 |

---

## 5. Estrutura dos Módulos do Sistema

```
fila-ru/
├── server/               # Backend em Node.js puro
│   ├── server.js         # Servidor HTTP nativo e orquestrador WebSocket
│   ├── sessao.js         # Gerenciamento de ciclo de vida e persistência (JSONL)
│   └── rede.js           # Descoberta de IP local, QR Code e validação de PIN
│
├── public/               # Aplicações Web Frontend (HTML5, CSS3, JS Vanilla)
│   ├── celular.html/.js  # Interface tátil do operador de campo (mobile-first)
│   ├── painel.html/.js   # Dashboard do coordenador em tempo real (desktop/tablet)
│   ├── historico.html/.js# Central de replay temporal, gráficos e exportação
│   ├── animacao.js       # Renderização visual dos blocos de pessoas no mapa
│   ├── replay.js         # Controle da timeline temporal interativa
│   └── estilo.css        # Sistema de design responsivo com suporte a Dark Mode
│
├── shared/               # Núcleo Isomórfico (roda no Node e no Navegador)
│   ├── estado.js         # Funções puras de derivação de estado a partir de eventos
│   ├── metricas.js       # Implementação matemática de todas as métricas M-01 a M-122
│   ├── simulador.js      # Motor de simulação por eventos discretos (DES)
│   └── movimento.js      # Geometria do restaurante, rotas em polilinha e animações
│
├── teste/                # Garantia de Qualidade
│   └── testes.js         # Bateria com 203 testes unitários e de integração
│
├── dados/                # Diretório de persistência das coletas realizadas
│   └── presets.json      # Configuração dos modelos de fila (somente fila, mesas, etc.)
│
├── iniciar.bat           # Script de inicialização rápida com um clique no Windows
├── README.md             # Manual operacional de campo e checklist pré-coleta
├── METRICAS.md           # Dicionário e fonte de verdade de todas as métricas
└── package.json          # Metadados e dependências do projeto
```

---

## 6. Telas e Modos de Operação

### 6.1 Coletor Mobile (`celular.html`)

- **Foco Ergonômico**: Botões gigantes projetados para operação rápida com uma das mãos, sem desviar o olhar da fila.
- **Perfis de Operador**:
    - _Completo_: Exibe botões de Chegada e Atendimento.
    - _Somente Chegadas_: Exibe apenas "CHEGADA" (ideal para quem fica na entrada).
    - _Somente Atendimentos_: Exibe apenas "ATENDIDO" com o número da próxima pessoa (ideal para quem opera na catraca/balcão).
    - _Apoio/Observador_: Acompanha os números sem interferir na contagem.
- **Tolerância a Erros Operacionais**:
    - Botão **"Reverter Último"**: Desfaz o atendimento acidental de uma pessoa e a devolve à frente da fila.
    - Botão **"×"**: Permite cancelar/anular uma desistência da fila sem corromper as estatísticas.
    - Botão **"Anotação"**: Registra pausas de reposição ou eventos externos com carimbo de tempo.

### 6.2 Painel do Coordenador (`painel.html`)

- Opera na tela do notebook durante a coleta.
- Mostra em tempo real:
    - Lista de celulares conectados, IP, bateria estimada e papel de cada operador.
    - Gráficos instantâneos de tamanho de fila e tempo estimado de espera.
    - Alerta de ociosidade anômala (quando uma fila fica parada mais de 60 segundos com pessoas aguardando).
    - Botões para Iniciar Sessão, Ajustar Fila em caso de discrepância física e Encerrar Coleta.

### 6.3 Central de Histórico e Análise (`historico.html`)

- Acessada após a coleta para exploração científica dos dados:
    - **Reprodutor Temporal (Replay)**: Barra de tempo interativa que permite voltar ou avançar a qualquer minuto da coleta em 1x, 5x, 10x ou 60x, visualizando o mapa dinâmico do restaurante em SVG.
    - **Gráficos Analíticos (Chart.js)**: Séries temporais de chegadas e saídas por bloco de 5 minutos, evolução da ocupação do salão e curvas de tempo de espera.
    - **Exportação para Excel Brasileiro**: Geração de arquivos CSV formatados com codificação UTF-8 com BOM, separador `;` e decimais com vírgula `,`.
    - **Backup JSON**: Exportação integral do log de eventos e metadados para auditoria ou processamento em scripts Python/R externos.
    - **Relatório para Impressão**: Layout estilizado para emissão instantânea de relatórios executivos em PDF via `Ctrl + P`.

---

## 7. Como Executar o Projeto

1. **Pré-requisitos**:
    - Ter o [Node.js](https://nodejs.org) (v18 ou superior) instalado no computador.
2. **Instalação das dependências** (apenas na primeira vez):
    ```bash
    npm install
    ```
3. **Execução dos Testes Automatizados**:
    ```bash
    node teste/testes.js
    ```
4. **Inicialização do Sistema**:
    - Dê um duplo clique no arquivo `iniciar.bat` ou digite no terminal:
    ```bash
    npm start
    ```
5. **Acesso**:
    - No notebook: `http://localhost:3000/painel.html` ou `http://localhost:3000/historico.html`
    - Nos celulares: Conectar ao Wi-Fi do notebook e acessar o endereço IP informado no terminal (ou escanear o QR Code).

---

## 8. Resumo das Vantagens Competitivas

- **Zero Custo de Nuvem / Sem Servidores Externos**: Executa integralmente no hardware local.
- **Zero Atrito para Operadores**: Abre diretamente no navegador de qualquer smartphone Android ou iPhone.
- **Rigor Científico**: Métricas auditáveis com validação formal da Lei de Little e estatística inferencial completa.
- **Reproducibilidade**: Gravação baseada em log de eventos que possibilita reproduzir exatamente cada segundo da operação.

## 9. Estado Atual (Baseline) e Diretrizes para Planejamento Futuro

### 9.1 O que já está Concluído e Validado (Não Reconstruir)

- **Núcleo do Sistema (Backend e Frontend Local):** Servidor HTTP/WebSocket em Node.js nativo (`server/`), interfaces de coleta mobile (`celular.html`), painel em tempo real (`painel.html`) e central de análise/replay (`historico.html`) 100% operacionais.
- **Motor Matemático e Isomorfismo:** Biblioteca `shared/` implementada com cálculo de mais de 100 métricas da Teoria das Filas (`M-01` a `M-122`), validação da Lei de Little e derivação de estado por _Event Sourcing_ (`eventos.jsonl`).
- **Garantia de Qualidade:** Bateria de 203 testes unitários e de integração (`teste/testes.js`) validando concorrência, reversão de eventos, motor de simulação por eventos discretos e consistência matemática.

### 9.2 Frentes de Planejamento e Próximos Passos (Escopo para a IA)

A partir desta linha de base, o apoio da Inteligência Artificial deve focar exclusivamente no planejamento e execução das seguintes entregas:

1. **Extensão / Projeto Web Complementar:**
    - **Objetivo:** [Preencher: ex. Criar um portal web institucional/portfólio para apresentar o projeto, ou uma interface web online para upload e visualização pública dos relatórios JSON/CSV gerados em campo].
    - **Requisitos:** Manter alinhamento visual com o sistema original, baixo custo de hospedagem (ex.: GitHub Pages, Vercel ou renderização estática) e clareza na exposição dos dados.

2. **Planejamento da Apresentação:**
    - **Público-Alvo:** [Preencher: ex. Banca avaliadora acadêmica / Gestores do Restaurante Universitário / Evento científico].
    - **Duração Estimada:** [Preencher: ex. 15 a 20 minutos].
    - **Eixo Narrativo:** Conectar o problema real das filas no RU com a solução de engenharia _offline-first_, demonstrar o rigor matemático (Teoria das Filas) e exibir resultados práticos (replay e métricas).

3. **Roadmap de Evolução e Melhorias Contínuas:**
    - Coleta de dados reais em campo para calibração e geração de estudos de caso.
    - Refinamentos de usabilidade (UX) baseados no feedback dos operadores em campo.
    - Documentação final e empacotamento para entrega/publicação.
