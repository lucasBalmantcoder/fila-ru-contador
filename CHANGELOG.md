# Changelog
Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [4.6.0] - 2026-11-19
### Adicionado
- Implementado motor de simulação por eventos discretos guiado por traço histórico (`shared/simulador.js`), suportando cenários "What-If" para dimensionamento de catracas ($c_1$), postos de buffet ($c_2$), velocidade de serviço e retenção por bloqueio nas mesas (*service blocking*).
- Criada interface completa de simulações com gráficos sobrepostos, tabela comparativa lado a lado e diagnóstico de gargalos (`public/simulacoes.html`, `public/simulacoes.js`).
- Adicionado menu de navegação global "Simulações" no cabeçalho das interfaces (`painel.html`, `historico.html`, `simulacoes.html`).
- Adicionada rota `/simulacoes` e validação estrita por regex contra path traversal nos identificadores de sessão em `server/server.js`.
- Atualizado documento de referência de métricas (`METRICAS.md`) para a versão 2.0, integrando o catálogo completo de métricas de ocupação e preenchimento das Mesas (216 cadeiras, M-110 a M-122), a nova dinâmica de fluxo contínuo na Fila 3 / Saída e as métricas de trânsito em encadeamentos multi-filas (M-86 a M-88).
- Adicionada funcionalidade de edição de metadados da sessão (nome da observação, local/campus e observações descritivas) por meio de modal interativo na interface de histórico.
- Adicionados endpoints `POST /api/sessoes/:id/editar` e suporte aos métodos `PUT`/`PATCH` no servidor para persistência e atualização dinâmica das informações da sessão.
- Adicionadas métricas de encadeamento completo entre filas (tempo da chegada até as mesas e tempo total até a saída do restaurante) e exibição do card de percurso no histórico.

## [4.5.3] - 2026-11-08
### Corrigido
- Corrigido bug visual na renderização do mapa animado no modo escuro (dark mode), aplicando fundo claro forçado e bordas arredondadas nos contêineres e elementos SVG para garantir visibilidade e contraste adequado em todas as telas e em tela cheia.
- Corrigidos bugs visuais e dimensionamento responsivo dos gráficos de histórico, implementando contêiner `.chart-wrapper` com controle de altura para dispositivos móveis e otimização da formatação e escala dos eixos X e Y.
- Corrigida duplicidade de blocos estruturais do card de percurso completo no arquivo `public/historico.html`.
- Corrigida falha no acionamento do botão de edição de informações da sessão na interface de histórico e análise.
- Corrigido gerenciamento de conexões WebSocket no servidor com limitação de taxa (rate limit) de logs na substituição de sockets para prevenir sobrecarga no terminal durante reconexões sucessivas.
