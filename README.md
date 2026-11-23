# Sistema Colaborativo de Coleta, Análise e Simulação da Fila do RU

[![Versão](https://img.shields.io/badge/versão-4.6.1-blue.svg)](file:///c:/Users/ghost/Documents/outubro/fila-ru/package.json)
[![Testes](https://img.shields.io/badge/testes-203%20aprovados-brightgreen.svg)](file:///c:/Users/ghost/Documents/outubro/fila-ru/teste/testes.js)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org)
[![Licença](https://img.shields.io/badge/licença-MIT-informational.svg)](file:///c:/Users/ghost/Documents/outubro/fila-ru/LICENSE)

Sistema web completo para coleta, monitoramento em tempo real, análise estocástica e **simulação de cenários operacionais ("What-If")** das filas do Restaurante Universitário (RU). 

O notebook do pesquisador/coordenador atua como servidor autônomo através do Hotspot Móvel do Windows, permitindo que múltiplos operadores utilizem seus próprios smartphones para registrar chegadas e atendimentos de forma sincronizada e colaborativa — **100% offline, sem necessidade de internet externa e sem instalar aplicativos**.

---

## 🌟 Principais Funcionalidades

- **Coleta Colaborativa em Tempo Real**: Conexão de múltiplos smartphones simultâneos via WebSockets locais de baixa latência (< 50 ms).
- **Modelagem das 3 Filas e do Salão de Mesas**:
  - **Fila 1 (Entrada → Catraca)**: Fila externa de alunos aguardando validação na catraca/guichê.
  - **Fila 2 (Atendimento → Buffet)**: Linhas de distribuição para retirada de bandejas, pratos e refeição com encadeamento atômico ($F_1 \to F_2$).
  - **Salão de Mesas (Refeição)**: Monitoramento da capacidade nominal de **216 cadeiras** (36 mesas $\times$ 6 cadeiras), com cálculo dinâmico de ocupação instantânea e níveis de estresse (_Tranquilo_, _Moderado_, _Quase Cheio_ e _Lotado_).
  - **Fila 3 / Saída (Mesas → Saída)**: Fluxo contínuo de alunos após a refeição em direção ao descarte de bandejas e saída.
- **Motor de Simulação de Eventos Discretos Guiado por Traço (Trace-Driven DES)**:
  - Avaliação de cenários hipotéticos ("What-If") utilizando dados empíricos de sessões reais.
  - Dimensionamento de catracas paralelas ($c_1 \ge 1$) e linhas de buffet ($c_2 \ge 1$).
  - Ajustes de velocidade de atendimento ($-50\%$ a $+100\%$) ou tempos fixos em segundos.
  - Simulação de **Retenção por Bloqueio de Mesas (*Service Blocking*)**: quando o salão de 216 lugares lota, alunos aguardam de pé com bandeja, retendo o buffet.
  - Calibração de alta fidelidade matemática no baseline ($\le 0{,}3\%$ de desvio) e conservação integral da coorte coletada.
- **Menu de Aferições por Abas**: Navegação analítica idêntica no Histórico e nas Simulações (Visão Geral, Fila 1, Fila 2, Fila 3, Grid de 8 KPIs, Lei de Little, Erlang C $M/M/c$, Agregação por Blocos de 5 min, Gráficos Acumulados, Ociosidade e Bloqueio).
- **Reprodutor Temporal Interativo (Replay)**: Barra de tempo para rever cada segundo da coleta em 1x, 5x, 10x ou 60x com animação dinâmica do mapa do RU.
- **Resiliência de Rede (*Offline-First*)**: Fila de envio local no `localStorage` do celular para tolerar oscilações temporárias de sinal Wi-Fi sem perda de eventos.
- **Exportação Científica Completa**: CSV formatado para Microsoft Excel brasileiro (UTF-8 com BOM, separador `;`, decimais com vírgula), backup integral em JSON e relatórios executivos para impressão em PDF.

---

## 📋 Pré-requisitos

1. **Notebook** com Windows 10 ou 11 e adaptador Wi-Fi compatível com Hotspot Móvel.
2. **Node.js**: Versão LTS 18 ou superior instalada ([nodejs.org](https://nodejs.org)).
3. **Smartphones**: Qualquer aparelho moderno (Android com Chrome, iOS com Safari). Não é necessário instalar nenhum aplicativo.

---

## 🚀 Instalação Rápida

1. Clone o repositório ou baixe a pasta do projeto:
   ```bash
   cd fila-ru
   ```
2. Instale as dependências de produção (`ws` e `qrcode`):
   ```bash
   npm install
   ```
3. Execute a suíte de testes automatizados para validar a consistência matemática e operacional:
   ```bash
   npm test
   ```
   *(Todos os 203 testes automatizados devem ser aprovados com 100% de sucesso).*

---

## 📡 Configuração do Ponto de Acesso (Hotspot do Windows)

1. No Windows, abra **Configurações** (`Win + I`) > **Rede e Internet** > **Hotspot móvel**.
2. Configure o nome da rede (SSID) e defina uma senha simples (ex.: `filaderu123`).
3. Ative a chave **"Compartilhar minha conexão de Internet"** (ou ligue o ponto de acesso).
   - O endereço IPv4 padrão atribuído pelo Windows ao adaptador de hotspot é **`192.168.137.1`**.
4. **Firewall do Windows**: Na primeira execução, se surgir uma solicitação de permissão do Firewall, marque a opção **"Redes privadas"** e clique em **Permitir acesso**.

---

## ▶️ Inicialização do Servidor

1. Dê um duplo clique no arquivo **`iniciar.bat`** (ou execute no terminal `npm start`).
2. O terminal exibirá:
   - O endereço IP detectado (ex: `http://192.168.137.1:3000`).
   - O **PIN de acesso de 4 dígitos** gerado para a sessão (ex: `>>> 5832 <<<`).
   - A URL do Painel do Notebook: `http://localhost:3000/painel.html`.
   - Um **QR Code ASCII** desenhado diretamente no terminal para leitura imediata pela câmera dos celulares.

---

## 📱 Conectando os Celulares dos Operadores

1. No smartphone de cada operador, conecte-se à rede Wi-Fi do hotspot do notebook.
2. Aponte a câmera para o QR Code do terminal (ou acesse `http://192.168.137.1:3000/celular.html`).
3. Informe o **PIN de 4 dígitos** e o **Nome do Aparelho** (ex: *Celular 1 - Entrada*, *Celular 2 - Catraca*).
4. Selecione o papel do aparelho:
   - **Completo**: botões de CHEGADA e ATENDIDO.
   - **Somente Chegadas**: botão de CHEGADA exclusivo (ideal para o operador na porta externa).
   - **Somente Atendimentos**: botão ATENDIDO exclusivo (ideal para quem fica junto à catraca/buffet).
   - **Apoio/Observador**: acompanha os indicadores em tempo real sem botões de registro.
5. O painel do notebook confirmará a conexão de cada celular em tempo real.

---

## ⏱️ Conduzindo uma Coleta em Campo

1. **No Notebook**:
   - Acesse o painel: `http://localhost:3000/painel.html`.
   - Preencha o nome da observação (ex.: *Almoço RU - Quinta-feira*), selecione o modelo de monitoramento (Somente Fila 1, Fila + Atendimento ou Fluxo Completo) e clique em **▶ Iniciar Nova Sessão**.
2. **Nos Celulares**:
   - O botão **CHEGADA** (verde escuro) registra a entrada de um aluno.
   - O botão **ATENDIDO** (azul) exibe a pessoa na cabeça da fila (ex: *Confirmar Pessoa 12*). Ao ser pressionado, a pessoa passa para atendida e avança no fluxo.
   - **Concorrência Segura**: Se dois operadores tocarem em "ATENDIDO" simultaneamente, o servidor valida o primeiro e notifica o segundo (`JA_ATENDIDO`).
   - **Tolerância a Falhas**:
     - Botão `×`: Anula desistências da fila sem corromper as métricas.
     - Botão **Reverter Último**: Devolve a última pessoa atendida por engano à cabeça da fila.
     - Botão **📝 Anotação**: Registra eventos operacionais com carimbo de tempo (*catraca travou*, *reposição de bandejas*).
3. **Ao Término**:
   - No painel do notebook, clique em **⏹ Encerrar Sessão**. Todos os celulares são sincronizados e a sessão é salva com segurança.

---

## 🔬 Módulos do Sistema

| Interface | URL Local | Descrição |
| :--- | :--- | :--- |
| **Painel em Tempo Real** | `http://localhost:3000/painel.html` | Monitoramento ao vivo de filas, operadores conectados, tempos médios, alerta de pausas e mapa animado. |
| **Coleta Mobile** | `http://192.168.137.1:3000/celular.html` | Interface tátil simplificada para registro de chegadas e atendimentos pelos operadores de campo. |
| **Histórico & Análises** | `http://localhost:3000/historico.html` | Replay temporal da fila, navegação por abas de aferições (Visão Geral, F1, F2, F3), gráficos Chart.js e exportação CSV/JSON. |
| **Simulações ("What-If")** | `http://localhost:3000/simulacoes.html` | Motor de simulação por eventos discretos guiada por traço, avaliação de gargalos, calibração e dimensionamento de catracas e mesas. |

---

## 📊 Fundamentação Teórica e Métricas Calculadas

O sistema implementa formalmente os postulados da **Teoria das Filas** (modelos $M/M/c$, $M/G/c$ e $G/G/c$), com catálogo de mais de 100 métricas auditáveis especificadas em [`METRICAS.md`](file:///c:/Users/ghost/Documents/outubro/fila-ru/METRICAS.md) (`M-01` a `M-122`):

- **Taxas de Fluxo**: Taxa média de chegada $\lambda$ (`M-10`), taxa de serviço $\mu$ (`M-13`, `M-14`), vazão global e operacional.
- **Fator de Utilização**: $\rho = \frac{\lambda}{c \cdot \mu}$ (`M-16`), onde $c$ é o número de postos/catracas ativas.
- **Tempos de Espera ($W_q$)**: Média, mediana, desvio padrão, mínimo, máximo, **P90** e **P95** (`M-20` a `M-26`).
- **Comprimento de Fila ($L_q$)**: Fila média ponderada no tempo (`M-40`) e pico máximo de pessoas na fila (`M-41`).
- **Validação da Lei de Little**: Teste empírico $L = \lambda \cdot W$ com relatório de erro percentual (`M-50` a `M-53`).
- **Variabilidade dos Intervalos**: Coeficiente de variação ($CV = DP / Média$) entre chegadas e atendimentos (`M-33`, `M-39`).
- **Ociosidade e Pausas**: Decomposição em tempo ocioso por ausência de alunos, pausas manuais do operador ou interrupções operacionais (`M-60` a `M-66`).
- **Ocupação do Salão de Mesas**: Ocupação média, pico de assentos utilizados e percentual de lotação em relação às 216 cadeiras (`M-110` a `M-122`).
- **Percurso Completo**: Tempo total de trânsito da calçada de entrada até as mesas ($F_1 + F_2$, `M-86`) e tempo total até a saída do restaurante ($F_1 + F_2 + F_3$, `M-87`).

---

## 🧮 Motor de Simulação "What-If" (`shared/simulador.js`)

O motor de simulação por eventos discretos guiado por traço histórico (*Trace-Driven DES*) permite testar intervenções operacionais sem impacto no dia a dia do restaurante:

1. **Fidelidade Integral ao Baseline**:
   Ao selecionar uma sessão real coletada sem alterações de parâmetros ($c_1 = 1$, $c_2 = 1$, variação de taxa $0\%$), o simulador preserva 100% da coorte observada ($n_s^{\text{sim}} = n_s^{\text{real}}$, $\Delta = 0{,}0\%$) e atinge desvio $\le 0{,}3\%$ em relação ao tempo médio de espera real.
2. **Avaliação de Eficiência com Múltiplas Catracas ($c_1 \ge 2$)**:
   Simula a absorção da demanda real através de fila única compartilhada FIFO entre múltiplas catracas. Permite quantificar a redução no tempo médio de espera ($W_{q1}$), a redução no pico da fila e a aceleração no escoamento do lote inicial de alunos.
3. **Detecção de Deslocamento de Gargalos**:
   Demonstra se o aumento de capacidade na entrada ($c_1 = 2$) sobrecarrega a linha de distribuição de refeições (Buffet, Fila 2) ou o salão de mesas.
4. **Service Blocking por Lotação de Assentos**:
   Monitora as 216 cadeiras do salão. Se todas estiverem ocupadas, os alunos que terminam de montar a bandeja no buffet permanecem retidos em pé, bloqueando a liberação do buffet até que uma mesa seja desocupada.

---

## 🛠️ Solução de Problemas em Campo

| Problema | Causa Provável | Solução |
| :--- | :--- | :--- |
| **Hotspot do Windows não liga sem internet** | O Windows pode exigir conexão externa para ativar o hotspot móvel. | Conecte o notebook momentaneamente aos dados móveis 4G do celular apenas para ativar o hotspot. Uma vez ligado, a rede local funcionará sem gastar dados. Como alternativa, utilize um mini roteador Wi-Fi portátil sem internet. |
| **Celular troca sozinho para dados móveis (4G/5G)** | O Android/iOS detecta que a rede Wi-Fi não possui internet e tenta desativá-la. | **Ação recomendada**: Ao conectar na rede do notebook, selecione **"Manter conexão Wi-Fi mesmo sem internet"** e desative temporariamente os Dados Móveis do smartphone durante a coleta. |
| **Tela do celular bloqueia ou apaga** | A API Screen Wake Lock exige contexto HTTPS seguro em alguns navegadores. | Defina o tempo limite de bloqueio de tela do celular para 30 minutos ou "Nunca" durante a hora de coleta. |
| **Queda temporária de Wi-Fi no celular** | Operador se afastou além do alcance do sinal do notebook. | O aplicativo possui **fila de saída offline**: os registros continuam funcionando e são armazenados no `localStorage` do celular, sendo transmitidos em ordem cronológica estrita assim que a conexão for restabelecida. |
| **Celular não abre o endereço IP informado** | Firewall do Windows bloqueando a porta 3000 em redes públicas. | No Windows, configure a rede do hotspot como "Rede Privada" ou crie uma regra de entrada no Firewall do Windows liberando a porta `3000` (TCP). |

---

## 🧪 Checklist Pré-Coleta (Ensaio de 5 Minutos)

Antes do início do horário de refeição no RU, execute este checklist:

1. [x] Notebook ligado à tomada com Hotspot Móvel do Windows ativado.
2. [x] Servidor iniciado via `iniciar.bat`. PIN visível no terminal e no painel.
3. [x] Celulares dos operadores conectados ao Wi-Fi do notebook (dados móveis desligados).
4. [x] Cada operador abre a aplicação via QR Code, insere o PIN e o nome do aparelho.
5. [x] Coordenador confirma todos os aparelhos conectados na lista do painel.
6. [x] Clique em **"Simular Coleta de Teste"** no painel para conferir a animação nos celulares e no notebook.
7. [x] Operador 1 registra uma "CHEGADA" e confirma o surgimento da Pessoa 1 no painel em < 1 segundo.
8. [x] Operador 2 registra "ATENDIDO" e confirma o avanço da fila.
9. [x] Encerre a sessão de teste no painel e clique em **▶ Iniciar Nova Sessão** para a coleta oficial!

---

## 📁 Estrutura de Diretórios do Projeto

```
fila-ru/
├── server/                     # Servidor HTTP nativo e orquestrador WebSocket
│   ├── server.js               # Rotas da API, servidor WebSocket e validações
│   ├── sessao.js               # Ciclo de vida da sessão e persistência (eventos.jsonl)
│   └── rede.js                 # Detecção de IP local, geração de QR Code e PIN
│
├── public/                     # Aplicações Web Frontend (HTML5, CSS3, Vanilla JS)
│   ├── celular.html / .js      # Interface de coleta mobile dos operadores
│   ├── painel.html / .js       # Dashboard em tempo real do coordenador
│   ├── historico.html / .js    # Central de replay temporal, gráficos e relatórios
│   ├── simulacoes.html / .js   # Interface analítica de simulações "What-If"
│   ├── animacao.js             # Renderização dinâmica do mapa do RU em canvas/SVG
│   ├── replay.js               # Controle e sincronização da timeline de replay
│   └── estilo.css              # Sistema de design responsivo com suporte a Dark Mode
│
├── shared/                     # Núcleo Isomórfico (executa no Node.js e no Navegador)
│   ├── estado.js               # Derivação determinística de estado via Event Sourcing
│   ├── metricas.js             # Implementação matemática do catálogo M-01 a M-122
│   ├── simulador.js            # Motor de simulação por eventos discretos (DES)
│   └── movimento.js            # Geometria do restaurante, rotas e nós de animação
│
├── teste/                      # Garantia de Qualidade
│   └── testes.js               # Bateria automatizada com 203 testes unitários e de integração
│
├── dados/                      # Diretório de persistência das sessões coletadas
│   └── presets.json            # Modelos predefinidos de filas e parâmetros
│
├── iniciar.bat                 # Inicialização com um clique no Windows
├── README.md                   # Manual operacional de campo e guia do sistema
├── MANUAL_SIMULACOES.md        # Manual detalhado da funcionalidade de simulações
├── METRICAS.md                 # Dicionário formal de todas as métricas calculadas
├── DOCUMENTACAO_PROJETO.md     # Documentação técnica e arquitetural de referência
└── package.json                # Metadados e dependências do projeto (v4.6.1)
```

---

## 📄 Licença

Este projeto está licenciado sob os termos da licença [MIT](file:///c:/Users/ghost/Documents/outubro/fila-ru/LICENSE).
