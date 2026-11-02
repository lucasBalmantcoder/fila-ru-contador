# Sistema Colaborativo de Coleta da Fila do RU (Multi-Zonas)

Sistema web para coleta e análise em tempo real do percurso completo dos alunos no Restaurante Universitário (RU), dividido em **zonas configuráveis** com múltiplos **pontos de verificação**.

O notebook atua como servidor local via Hotspot Móvel do Windows, e múltiplos smartphones conectam-se via navegador sem necessidade de instalar aplicativos ou acesso à internet.

> 📖 **Documentação Completa**: Consulte o arquivo [LEIA-ME.md](file:///c:/Users/ghost/Documents/outubro/fila-ru/LEIA-ME.md) para o guia aprofundado sobre configuração de zonas, presets, papéis, compensação de inversão temporal e roteiro de ensaio prévio.

---

## 📋 Pré-requisitos

1. **Notebook** com Windows 10 ou 11 e adaptador Wi-Fi compatível com Hotspot Móvel.
2. **Node.js**: Versão LTS 18 ou superior instalada ([nodejs.org](https://nodejs.org)).
3. **Smartphones**: Qualquer aparelho com navegador moderno (Google Chrome no Android, Safari no iOS). Não é necessário instalar nenhum aplicativo nos celulares.

---

## 🚀 Instalação e Testes

1. Abra o terminal (PowerShell ou Prompt de Comando) na pasta do projeto:
    ```bash
    cd fila-ru
    ```
2. Instale as dependências locais (`ws` e `qrcode`):
    ```bash
    npm install
    ```
3. Execute a suíte de testes automatizados com 100% de cobertura (20 suítes):
    ```bash
    node teste/testes.js
    ```
    _(Todos os 102 testes devem ser aprovados com sucesso)._

---

## 📡 Configuração do Ponto de Acesso (Hotspot do Windows)

1. No Windows, abra **Configurações** (`Win + I`) > **Rede e Internet** > **Hotspot móvel**.
2. Configure o nome da rede (SSID) e defina uma senha simples (ex.: `filaderu123`).
3. Ative a chave **"Compartilhar minha conexão de Internet"** (endereço padrão: `192.168.137.1`).
4. **Firewall do Windows**:
   - Caso solicitado na primeira execução do Node.js, marque a caixa **"Redes privadas"** e clique em **Permitir acesso**.

---

## ▶️ Iniciando o Servidor

1. Dê um duplo clique no arquivo **`iniciar.bat`** (ou execute `node server/server.js`).
2. O terminal exibirá:
   - O endereço IP detectado (ex: `http://192.168.137.1:3000`).
   - O **PIN de acesso de 4 dígitos** gerado para a sessão.
   - A URL do Painel do Notebook: `http://localhost:3000/painel.html`.
   - A página de cartões QR por ponto: `http://localhost:3000/pontos.html`.
   - Um **QR Code ASCII** desenhado diretamente no terminal.

---

## 🏷️ Cartões de Ponto e Autoatribuição (`/pontos.html`)

1. Acesse `http://localhost:3000/pontos.html` no notebook e imprima a folha de cartões em formato A4.
2. Fixe os cartões impressos em cada ponto físico:
   - **P0: Chegada** (porta de entrada).
   - **P1: Catraca** (passagem para o balcão).
   - **P2: Saída do atendimento** (término do balcão de servir).
   - **P3: Saída das mesas** (saída do refeitório).
3. Cada avaliador aponta a câmera do celular para o QR Code do seu posto, insere o PIN e seu nome.
4. O celular é automaticamente atribuído àquele ponto (`autoatribuição`), adaptando sua interface de toque.

---

## 👥 Delegação de Aparelhos e Papéis

No painel do notebook (`/painel.html`), a aba **"Delegação"** permite gerenciar quem opera em cada ponto:
- **Matriz de Aparelhos x Pontos**: ajuste dinâmico em tempo real com sincronização imediata via WebSocket.
- **Distribuição Automática**: distribui os pontos contiguamente entre os aparelhos conectados (ex.: 4 aparelhos = 1 por ponto; 2 aparelhos = P0+P1 e P2+P3).
- **Operador Único**: atribui todos os pontos ao mesmo aparelho (ideal para ensaios ou coletas individuais).
- **Papéis**:
  - `avaliador`: restrito aos pontos atribuídos (tentativa fora do ponto gera `PONTO_NAO_ATRIBUIDO`).
  - `supervisor`: controle irrestrito sobre todos os pontos.
  - `observador`: modo somente visualização e acompanhamento da animação em tempo real.

---

## ⏱️ Conduzindo a Coleta

1. **No Notebook**:
   - Na aba **Zonas**, selecione o modelo desejado (*Completo*, *Fila + Atendimento*, *Somente Fila* ou personalizado).
   - Clique em **▶ Iniciar Nova Sessão** (a estrutura de zonas é travada no início).
2. **Nos Celulares**:
   - O avaliador visualiza o botão de registro correspondente ao seu ponto (ex.: **CHEGADA** em P0; **REGISTRAR PASSAGEM** com indicação da próxima pessoa FIFO em P1 e P2; **SAIU +1** com ocupação atual em P3).
   - Multiplicador de lote (`x1`, `x2`, `x3`, `x5`) para grupos de alunos.
   - Compensação automática de inversão temporal: se um avaliador a jusante registrar frações de segundo antes do anterior, o comando fica pendente até a chegada do registro a montante, corrigindo o timestamp efetivo ($t_{efetivo} = \min(t_{montante}, t_{jusante})$).
   - Ações de correção: **Desfazer** (reversão com bloqueio caso a pessoa já tenha avançado) e **Anulação** (`×`).
3. **Ao Término**:
   - Clique em **⏹ Encerrar Sessão** no painel do notebook.

---

## 📊 Exportação de Dados e Histórico (`/historico.html`)

Acesse `http://localhost:3000/historico.html`:
- **Reprodução Fiel com Animação**: assista à reprodução temporal em 1x a 60x com as mesmas funções puras do tempo real (`derivarEstado`).
- **Gráficos Integrados**: área empilhada da ocupação por zona ao longo do tempo, curvas acumuladas por ponto e histograma de duração.
- **Tabela Analítica por Zona**: comparativo de $L$, $\lambda$, $\mu$, tempo médio, percentis e Lei de Little ($L = \lambda W$).
- **CSV Pessoas**: histórico completo por aluno com entrada e saída em cada zona, tempo de sistema e dispositivo responsável.
- **CSV Métricas e CSV Resumo de Zonas**: relatórios tabulados com separador `;` e codificação UTF-8 com BOM para Excel.
- **Comparação entre Sessões**: evolução histórica do tempo médio por zona entre múltiplos dias de coleta.
