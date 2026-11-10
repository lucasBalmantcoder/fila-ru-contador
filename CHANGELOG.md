# Changelog
Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]
### Adicionado
- Adicionado arquivo de documentação e referência formal de métricas (`METRICAS.md`), contendo convenções, fórmulas teóricas e catálogo com mais de 100 métricas do sistema (M-01 a M-100).
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
