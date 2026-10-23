# Sistema Colaborativo de Coleta da Fila do RU

Sistema web para coleta e análise em tempo real do desempenho da fila do Restaurante Universitário (RU). O notebook atua como servidor local via hotspot móvel do Windows, e múltiplos celulares se conectam via navegador para registro colaborativo e sincronizado das chegadas e atendimentos.

---

## 📋 Pré-requisitos

1. **Notebook** com Windows 10 ou 11 e adaptador Wi-Fi compatível com Hotspot Móvel.
2. **Node.js**: Versão LTS 18 ou superior instalada ([nodejs.org](https://nodejs.org)).
3. **Smartphones**: Qualquer aparelho com navegador moderno (Google Chrome no Android, Safari no iOS). Não é necessário instalar nenhum aplicativo nos celulares.

---

## 🚀 Instalação e Preparação Inicial (com Internet)

1. Abra o terminal (PowerShell ou Prompt de Comando) na pasta do projeto `fila-ru`:
    ```bash
    cd fila-ru
    ```
2. Instale as duas únicas dependências de produção (`ws` e `qrcode`):
    ```bash
    npm install
    ```
3. Execute a suíte de testes automatizados para verificar a integridade matemática do sistema:
    ```bash
    node teste/testes.js
    ```
    _(Todos os 47 testes devem ser aprovados com sucesso)._

---

## 📡 Configuração do Ponto de Acesso (Hotspot do Windows)

1. No Windows, abra **Configurações** (`Win + I`) > **Rede e Internet** > **Hotspot móvel** (Mobile Hotspot).
2. Configure o nome da rede (SSID) e defina uma senha simples (ex.: `filaderu123`).
3. Ative a chave **"Compartilhar minha conexão de Internet"** (ou ative o ponto de acesso).
    - O endereço IPv4 padrão atribuído pelo Windows ao adaptador de hotspot é **`192.168.137.1`**.
4. **Firewall do Windows**:
    - Na primeira execução do Node.js, uma janela do Firewall do Windows pode solicitar permissão. Marque a caixa **"Redes privadas"** (Private Networks) e clique em **Permitir acesso**.

---

## ▶️ Iniciando o Servidor

1. Dê um duplo clique no arquivo **`iniciar.bat`** (ou execute no terminal `node server/server.js`).
2. O terminal exibirá:
    - O endereço IP detectado (ex: `192.168.137.1:3000`).
    - O **PIN de acesso de 4 dígitos** gerado para a sessão (ex: `>>> 5832 <<<`).
    - A URL do Painel do Notebook: `http://localhost:3000/painel.html`.
    - Um **QR Code ASCII** desenhado diretamente no terminal.

---

## 📱 Conectando os Celulares dos Operadores

1. No celular de cada operador, conecte-se à rede Wi-Fi do hotspot do notebook.
2. Abra a câmera ou o navegador do celular e aponte para o QR Code (ou digite no navegador: `http://192.168.137.1:3000/celular.html`).
3. O celular solicitará o **PIN de 4 dígitos** e o **Nome do Aparelho** (ex: _Celular 1 - Entrada_, _Celular 2 - Catraca_).
4. Opcionalmente, selecione o papel do aparelho:
    - **Completo**: exibe os botões de CHEGADA e ATENDIDO.
    - **Somente Chegadas**: exibe apenas o botão de CHEGADA (ideal para quem fica na porta).
    - **Somente Atendimentos**: exibe apenas o botão ATENDIDO (ideal para quem fica junto à catraca).
5. O painel do notebook confirmará a conexão de cada celular em tempo real.

---

## ⏱️ Conduzindo uma Coleta em Campo

1. **No Notebook**:
    - Abra o painel no navegador: `http://localhost:3000/painel.html`.
    - Preencha o nome da observação (ex.: _Almoço RU - Quinta-feira_), número de servidores/catracas (padrão 1), duração prevista (padrão 60 min) e clique em **▶ Iniciar Nova Sessão**.
2. **Nos Celulares**:
    - O botão **CHEGADA** (verde escuro) adiciona uma pessoa à fila.
    - O botão **ATENDIDO** (azul) exibe a pessoa na catraca (ex: _Confirmar Pessoa 12_). Ao ser pressionado, a pessoa passa para atendida e o próximo avança.
    - O botão fica desabilitado se a fila estiver vazia.
    - Concorrência protegida: se dois operadores tocarem em "ATENDIDO" simultaneamente, o servidor valida o primeiro e avisa o segundo (`JA_ATENDIDO`).
    - Desistências/Anulações: use o botão `×` na tag da pessoa para anulá-la da fila com confirmação.
    - Erros operacionais: use **"Reverter Último"** para devolver a última pessoa atendida à catraca.
    - Anotações: use o botão **📝 Anotação** para registrar paradas operacionais (_catraca travou_, _reposição de bandejas_).
3. **Ao Término**:
    - No painel do notebook, clique em **⏹ Encerrar Sessão** e confirme. Todos os celulares são notificados e os relatórios ficam disponíveis.

---

## 📊 Exportação de Dados e Análise

Acesse a página **`http://localhost:3000/historico.html`**:

- **Reprodução Fiel**: Assista à animação acelerada em 1x, 5x, 10x ou 60x, ou deslize a barra de tempo para qualquer minuto (o estado é recalculado instantaneamente via `derivarEstado`).
- **CSV Pessoas**: Arquivo com separador `;`, formato UTF-8 com BOM e decimais com vírgula para abertura direta no Microsoft Excel brasileiro.
- **CSV Métricas**: Relatório consolidado com Taxa de Chegada ($\lambda$), Taxa de Serviço ($\mu$), Utilização ($\rho$), Fila Média Ponderada ($L$), Tempos de Espera (Média, Mediana, P90, P95) e teste da Lei de Little ($L = \lambda W$).
- **JSON Backup**: Backup integral da sessão e eventos para importação em outros computadores.
- **Imprimir**: Relatório formatado em layout limpo para PDF via `window.print()`.

---

## 🛠️ Solução de Problemas em Campo

| Problema                                            | Causa Provável                                                           | Solução                                                                                                                                                                                                                                             |
| :-------------------------------------------------- | :----------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hotspot do Windows não liga sem internet**        | O Windows às vezes recusa ativar o hotspot sem conexão externa ativa.    | **Solução rápida**: Conecte o notebook momentaneamente aos dados móveis 4G do celular apenas para ativar o hotspot; depois de ligado, a rede local funcionará sem gastar dados. Como alternativa, use um mini roteador Wi-Fi portátil sem internet. |
| **Celular troca sozinho para dados móveis (4G/5G)** | O Android/iOS detecta que o Wi-Fi não tem internet e desativa a conexão. | **Ação obrigatória**: Nas configurações do Wi-Fi do celular, ao conectar na rede do notebook, escolha **"Manter conexão Wi-Fi mesmo sem internet"** e desative temporariamente os Dados Móveis do celular durante a coleta.                         |
| **A tela do celular bloqueia/apaga**                | HTTP local bloqueia a API Screen Wake Lock por não ser HTTPS.            | Desative o bloqueio automático de tela nas configurações do celular (definir tempo limite de tela para 30 minutos ou "Nunca") durante a hora de coleta.                                                                                             |
| **Queda temporária de Wi-Fi no celular**            | Operador se afastou muito do notebook.                                   | O aplicativo possui **fila de saída offline**: os botões continuam funcionando, os eventos ficam salvos no `localStorage` do celular e são sincronizados e descarregados automaticamente em ordem assim que o sinal for restabelecido.              |
| **Celular não abre o endereço IP**                  | Firewall do Windows bloqueando a porta 3000 em redes públicas.           | No Windows, configure a rede do hotspot como "Rede Privada" ou adicione uma regra no Firewall do Windows liberando a porta `3000` (TCP).                                                                                                            |

---

## 🧪 Roteiro de Teste Prévio no Local (Checklist)

Realize este ensaio de 5 minutos antes do início do horário de pico do RU:

1. [x] Notebook ligado à tomada com Hotspot do Windows ativado.
2. [x] Servidor iniciado via `iniciar.bat`. PIN visível no terminal e no painel.
3. [x] Todos os celulares dos operadores conectados ao Wi-Fi do notebook e com Dados Móveis desligados.
4. [x] Cada celular abre a página pelo QR Code, insere o PIN e aparece listado no painel do notebook.
5. [x] No painel, clique em **"Simular Coleta de Teste"** e observe a animação da fila no notebook e nos celulares.
6. [x] No celular 1, pressione "CHEGADA" e verifique se a Pessoa 1 surge na tela de todos os aparelhos em menos de 1 segundo.
7. [x] No celular 2, pressione "ATENDIDO" e verifique a confirmação e avanço da fila.
8. [x] Encerre a sessão de teste no painel e inicie a sessão oficial da coleta!
