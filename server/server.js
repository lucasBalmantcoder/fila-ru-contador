/**
 * server/server.js
 * Servidor HTTP nativo e WebSocket para coordenação colaborativa em tempo real.
 * Suporta até três filas ativas, encadeamento, reconexão transparente, cobertura por fila e auditoria.
 * Dependências de produção estritamente: 'ws' e 'qrcode'. Sem Express, sem etapa de build.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { detectarEnderecosRede, obterOuGerarPin, obterStatusPin, salvarPinConfig, ehOrigemLocal, gerarQrCode } from './rede.js';
import { GerenciadorSessoes } from './sessao.js';
import { calcularMetricas, formatarNumero, formatarDuracao, formatarHoraLocal } from '../shared/metricas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR_RAIZ = path.resolve(__dirname, '..');
const DIR_PUBLIC = path.resolve(DIR_RAIZ, 'public');
const DIR_SHARED = path.resolve(DIR_RAIZ, 'shared');
const DIR_DADOS = path.resolve(DIR_RAIZ, 'dados');

const PORTA = process.env.PORT || 3000;
let PIN_ACESSO = obterOuGerarPin();
const gerenciadorSessoes = new GerenciadorSessoes();

// Rastreamento de tentativas incorretas de PIN por endereço IP
const tentativasPinPorIp = new Map(); // ip -> { contagem, bloqueadoAte }

// Dispositivos conectados via WebSocket: Map(ws -> Dispositivo)
const conexoesAtivas = new Map();

// Rastreamento de log de substituição por dispositivoId para evitar tempestade no terminal
const rateLimitSubstituicaoLog = new Map(); // dId -> { count: number, ultimoLogMs: number }

// Tabela MIME para o servidor de arquivos estáticos
const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/**
 * Servidor HTTP Nativo
 */
const servidorHttp = http.createServer((req, res) => {
  const urlParsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(urlParsed.pathname);

  // 1. Endpoints de API REST
  if (pathname.startsWith('/api/')) {
    tratarRequisicaoApi(req, res, pathname, urlParsed);
    return;
  }

  // 2. Roteamento de Páginas Principais
  let caminhoArquivoRelativo = pathname;
  if (pathname === '/' || pathname === '/celular') {
    caminhoArquivoRelativo = '/celular.html';
  } else if (pathname === '/painel') {
    caminhoArquivoRelativo = '/painel.html';
  } else if (pathname === '/historico') {
    caminhoArquivoRelativo = '/historico.html';
  }

  // 3. Servir arquivos estáticos de public/ ou shared/
  let caminhoFisico;
  if (caminhoArquivoRelativo.startsWith('/shared/')) {
    caminhoFisico = path.join(DIR_SHARED, caminhoArquivoRelativo.replace('/shared/', ''));
  } else {
    caminhoFisico = path.join(DIR_PUBLIC, caminhoArquivoRelativo);
  }

  // Prevenção contra Directory Traversal
  if (!caminhoFisico.startsWith(DIR_PUBLIC) && !caminhoFisico.startsWith(DIR_SHARED)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso proibido.');
    return;
  }

  fs.stat(caminhoFisico, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado.');
      return;
    }

    const ext = path.extname(caminhoFisico).toLowerCase();
    const contentType = TIPOS_MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(caminhoFisico);
    stream.pipe(res);
  });
});

/**
 * Trata requisições da API REST (Download de relatórios, CSV, listagem de sessões).
 */
async function tratarRequisicaoApi(req, res, pathname, urlParsed) {
  // CORS para a rede local
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/info - Retorna dados de rede, PIN e QR codes para o painel
  if (pathname === '/api/info' && req.method === 'GET') {
    const rede = detectarEnderecosRede();
    const urlCelularBase = `http://${rede.ipPreferido}:${PORTA}/celular.html`;

    try {
      const { qrDataUrl } = await gerarQrCode(urlCelularBase);
      const qrFila1 = (await gerarQrCode(`${urlCelularBase}?fila=1`)).qrDataUrl;
      const qrFila2 = (await gerarQrCode(`${urlCelularBase}?fila=2`)).qrDataUrl;
      const qrFila3 = (await gerarQrCode(`${urlCelularBase}?fila=3`)).qrDataUrl;

      const statusPin = obterStatusPin();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ipPreferido: rede.ipPreferido,
        todasInterfaces: rede.todasInterfaces,
        porta: PORTA,
        pin: PIN_ACESSO,
        pinFixoPorParametro: statusPin.fixoPorParametro,
        origemPin: statusPin.origem,
        urlCelular: urlCelularBase,
        qrDataUrl,
        qrFilas: {
          1: qrFila1,
          2: qrFila2,
          3: qrFila3
        },
        qrPorFila: {
          1: qrFila1,
          2: qrFila2,
          3: qrFila3
        },
        sessaoAtiva: gerenciadorSessoes.obterResumoSessaoAtiva()
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: err.message }));
    }
    return;
  }

  // GET /api/estado - Consulta e fallback quando WebSocket estiver fora
  if (pathname === '/api/estado' && req.method === 'GET') {
    const desdeSeq = parseInt(urlParsed.searchParams.get('desdeSeq'), 10) || 0;
    const sessaoAtiva = gerenciadorSessoes.sessaoAtiva;
    if (!sessaoAtiva) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sucesso: true,
        sessao: null,
        estado: null,
        eventosFaltantes: [],
        seqAtual: 0
      }));
      return;
    }

    const eventosFaltantes = sessaoAtiva.eventos.filter(e => e.seq > desdeSeq);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sucesso: true,
      sessao: gerenciadorSessoes.obterResumoSessaoAtiva(),
      estado: sessaoAtiva.estadoAtual,
      eventosFaltantes,
      seqAtual: sessaoAtiva.seq
    }));
    return;
  }

  // GET /api/config/pin - Retorna status e dados da senha de acesso (restrito ao notebook local)
  if (pathname === '/api/config/pin' && req.method === 'GET') {
    if (!ehOrigemLocal(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sucesso: false, erro: 'Acesso restrito ao computador local.' }));
      return;
    }

    const statusPin = obterStatusPin();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sucesso: true,
      pinMascarado: '•'.repeat(PIN_ACESSO.length),
      pinReal: PIN_ACESSO,
      fixoPorParametro: statusPin.fixoPorParametro,
      origem: statusPin.origem
    }));
    return;
  }

  // POST /api/config/pin - Altera a senha de acesso (restrito ao notebook local)
  if (pathname === '/api/config/pin' && req.method === 'POST') {
    if (!ehOrigemLocal(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sucesso: false, erro: 'A alteração de senha só é permitida a partir do notebook local.' }));
      return;
    }

    const statusPin = obterStatusPin();
    if (statusPin.fixoPorParametro) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sucesso: false, erro: 'senha definida por parâmetro de inicialização' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const dados = JSON.parse(body || '{}');
        const novoPin = String(dados.novoPin || '').trim();

        if (!/^\d{4,8}$/.test(novoPin)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sucesso: false, erro: 'A nova senha deve ser numérica e conter entre 4 e 8 dígitos.' }));
          return;
        }

        if (novoPin === PIN_ACESSO) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sucesso: false, erro: 'A nova senha deve ser diferente da senha atual.' }));
          return;
        }

        salvarPinConfig(novoPin);
        PIN_ACESSO = novoPin;

        // Auditoria
        fs.mkdirSync(DIR_DADOS, { recursive: true });
        const entradaAudit = {
          t: Date.now(),
          acao: 'pin_alterado',
          autorIp: req.socket.remoteAddress,
          desconectarTodos: !!dados.desconectarTodos
        };
        fs.appendFileSync(path.join(DIR_DADOS, 'pin_auditoria.jsonl'), JSON.stringify(entradaAudit) + '\n', 'utf-8');

        if (dados.desconectarTodos) {
          for (const [ws, disp] of conexoesAtivas.entries()) {
            if (disp.papel !== 'painel') {
              ws.close(4001, 'PIN alterado pelo administrador');
            }
          }
        } else {
          transmitirParaTodos({
            tipo: 'pinAtualizado',
            novoPin: novoPin
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, mensagem: 'Senha alterada com sucesso!', novoPin }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: false, erro: err.message }));
      }
    });
    return;
  }

  // GET /api/sessoes - Lista histórico de sessões
  if (pathname === '/api/sessoes' && req.method === 'GET') {
    const sessoes = gerenciadorSessoes.listarTodasSessoes();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessoes));
    return;
  }

  // Endpoints específicos para uma sessão: /api/sessoes/:id/...
  const matchSessao = pathname.match(/^\/api\/sessoes\/([^/]+)(\/(.*))?$/);
  if (matchSessao) {
    const sessaoId = matchSessao[1];
    const subAcao = matchSessao[3] || '';

    // POST /api/sessoes/:id/excluir
    if (subAcao === 'excluir' && req.method === 'POST') {
      try {
        gerenciadorSessoes.excluirSessao(sessaoId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: false, erro: err.message }));
      }
      return;
    }

    // POST /api/sessoes/:id/renomear
    if (subAcao === 'renomear' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const dados = JSON.parse(body);
          const meta = gerenciadorSessoes.renomearSessao(sessaoId, dados.novoNome);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sucesso: true, meta }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sucesso: false, erro: err.message }));
        }
      });
      return;
    }

    // POST /api/sessoes/:id/editar ou PUT/PATCH /api/sessoes/:id (editar metadados)
    if ((subAcao === 'editar' && req.method === 'POST') || (!subAcao && (req.method === 'PUT' || req.method === 'PATCH'))) {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const dados = JSON.parse(body || '{}');
          const meta = gerenciadorSessoes.atualizarMetadadosSessao(sessaoId, dados);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sucesso: true, meta }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sucesso: false, erro: err.message }));
        }
      });
      return;
    }

    // Obter dados completos da sessão
    const dadosSessao = gerenciadorSessoes.obterSessaoCompleta(sessaoId);
    if (!dadosSessao) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Sessão não encontrada.' }));
      return;
    }

    const conexoesSessao = gerenciadorSessoes.obterConexoes(sessaoId);

    // GET /api/sessoes/:id (detalhes e métricas)
    if (!subAcao && req.method === 'GET') {
      let metricas = null;
      try {
        metricas = calcularMetricas(
          dadosSessao.eventos,
          dadosSessao.meta.config || {},
          dadosSessao.meta.fimMs,
          conexoesSessao
        );
      } catch (err) {
        console.error(`[SERVER] Erro ao calcular métricas da sessão ${sessaoId}:`, err);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        meta: dadosSessao.meta,
        eventos: dadosSessao.eventos,
        rejeitados: dadosSessao.rejeitados,
        conexoes: conexoesSessao,
        metricas
      }));
      return;
    }

    // GET /api/sessoes/:id/json (backup)
    if (subAcao === 'json' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${dadosSessao.meta.nome.replace(/\s+/g, '_')}_${sessaoId}.json"`
      });
      res.end(JSON.stringify({ ...dadosSessao, conexoes: conexoesSessao }, null, 2));
      return;
    }

    // GET /api/sessoes/:id/csv-pessoas
    if (subAcao === 'csv-pessoas' && req.method === 'GET') {
      const metricas = calcularMetricas(dadosSessao.eventos, dadosSessao.meta.config, dadosSessao.meta.fimMs, conexoesSessao);
      let csv = '\uFEFFPessoa;Fila;Horario_Chegada;Horario_Atendimento;Tempo_Espera_Seg;Intervalo_Atendimento_Seg;Status;Ajuste;Encadeado;Disp_Chegada;Disp_Atendimento\r\n';

      for (const p of metricas.pessoas) {
        const chegadaStr = p.chegadaMs ? formatarHoraLocal(p.chegadaMs) : '';
        const atendStr = p.atendimentoMs ? formatarHoraLocal(p.atendimentoMs) : '';
        const esperaSeg = p.esperaMs !== null ? formatarNumero(p.esperaMs / 1000, 2) : '';
        const intSeg = p.intervaloAtendimentoMs !== null ? formatarNumero(p.intervaloAtendimentoMs / 1000, 2) : '';

        csv += `${p.pessoa};${p.fila || 1};${chegadaStr};${atendStr};${esperaSeg};${intSeg};${p.status};${p.ajuste ? 'SIM' : 'NAO'};${p.encadeado ? 'SIM' : 'NAO'};${p.dispositivoChegada || ''};${p.dispositivoAtendimento || ''}\r\n`;
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pessoas_${sessaoId}.csv"`
      });
      res.end(csv);
      return;
    }

    // GET /api/sessoes/:id/csv-eventos
    if (subAcao === 'csv-eventos' && req.method === 'GET') {
      let csv = '\uFEFFSeq;Horario;Tipo;Fila;Pessoa;Ajuste;Encadeado;Dispositivo;Tardio;Texto\r\n';
      for (const ev of dadosSessao.eventos) {
        csv += `${ev.seq};${formatarHoraLocal(ev.t)};${ev.tipo};${ev.fila || 1};${ev.pessoa || ''};${ev.ajuste ? 'SIM' : 'NAO'};${ev.encadeado ? 'SIM' : 'NAO'};${ev.dispositivoNome || ''};${ev.tardio ? 'SIM' : 'NAO'};${ev.texto ? `"${ev.texto.replace(/"/g, '""')}"` : ''}\r\n`;
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="eventos_${sessaoId}.csv"`
      });
      res.end(csv);
      return;
    }

    // GET /api/sessoes/:id/csv-resumo (uma linha por fila ativa, com cobertura)
    if (subAcao === 'csv-resumo' && req.method === 'GET') {
      const m = calcularMetricas(dadosSessao.eventos, dadosSessao.meta.config, dadosSessao.meta.fimMs, conexoesSessao);
      let csv = '\uFEFFFila;Nome_Fila;Status;Duracao_Min;Cobertura_Perc;Chegadas;Atendimentos;Anuladas;Revertidas;Na_Fila;Lambda_Por_Min;Mu_Por_Min;Utilizacao_Perc;Vazao_Global_Por_Min;Vazao_Operacional_Por_Min;Espera_Media_Seg;Espera_Mediana_Seg;Espera_P90_Seg;Espera_P95_Seg;Fila_Media_L;Pico_Fila;Little_Diff_Perc;Tempo_Servico_Parado_Seg;Tempo_Sem_Demanda_Seg;Tempo_Sem_Cobertura_Seg\r\n';

      const nomesFilas = { 1: 'Fila 1 (Entrada->Catraca)', 2: 'Fila 2 (Catraca->Mesas)', 3: 'Fila 3 (Mesas->Saída)' };

      for (const fNum of [1, 2, 3]) {
        const mf = m.filas[fNum];
        if (!mf || mf.semDados) continue; // Filas "sem dados" são omitidas do CSV de resumo

        const statusStr = mf.desativadaEm ? 'Desativada durante a sessao' : 'Ativa';
        const cobPerc = mf.cobertura?.disponivel ? formatarNumero(mf.cobertura.coberturaPerc, 1) : 'N/D';

        csv += `${fNum};${nomesFilas[fNum]};${statusStr};${formatarNumero(mf.duracaoFilaMin, 2)};${cobPerc};${mf.n_chegadas};${mf.n_atendimentos};${mf.n_anuladas};${mf.n_revertidas};${mf.n_na_fila};${formatarNumero(mf.lambda, 4)};${formatarNumero(mf.muPorServidor, 4)};${formatarNumero(mf.utilizacao * 100, 2)};${formatarNumero(mf.vazaoGlobalPorMin, 4)};${formatarNumero(mf.vazaoOperacionalPorMin, 4)};${formatarNumero(mf.statsEspera.media, 2)};${formatarNumero(mf.statsEspera.mediana, 2)};${formatarNumero(mf.statsEspera.p90, 2)};${formatarNumero(mf.statsEspera.p95, 2)};${formatarNumero(mf.filaTempo.mediaPonderada, 2)};${mf.filaTempo.max};${formatarNumero(mf.little.diffPerc, 2)};${formatarNumero(mf.ociosidade.tempoServicoParadoMs / 1000, 1)};${formatarNumero(mf.ociosidade.tempoSemDemandaMs / 1000, 1)};${formatarNumero(mf.ociosidade.tempoSemCoberturaMs / 1000, 1)}\r\n`;
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="resumo_${sessaoId}.csv"`
      });
      res.end(csv);
      return;
    }

    // GET /api/sessoes/:id/csv-blocos
    if (subAcao === 'csv-blocos' && req.method === 'GET') {
      const m = calcularMetricas(dadosSessao.eventos, dadosSessao.meta.config, dadosSessao.meta.fimMs, conexoesSessao);
      let csv = '\uFEFFFila;Bloco_Indice;Rotulo;Horario_Inicio;Horario_Fim;Chegadas;Atendimentos;Vazao_Por_Min;Cobertura_Perc;Sem_Passagem\r\n';

      for (const fNum of [1, 2, 3]) {
        const mf = m.filas[fNum];
        if (!mf || mf.semDados || !mf.vazaoBlocos) continue;

        for (const b of mf.vazaoBlocos.blocos) {
          csv += `${fNum};${b.indice};${b.rotulo};${formatarHoraLocal(b.tInicio)};${formatarHoraLocal(b.tFim)};${b.chegadas};${b.atendimentos};${formatarNumero(b.vazaoPorMin, 2)};${formatarNumero(b.coberturaPerc, 1)};${b.semPassagem ? 'SIM' : 'NAO'}\r\n`;
        }
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="blocos_${sessaoId}.csv"`
      });
      res.end(csv);
      return;
    }
  }

  // POST /api/sessoes/importar - Importa backup JSON
  if (pathname === '/api/sessoes/importar' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const dados = JSON.parse(body);
        let meta = dados.meta || dados.config || {};
        let eventos = dados.eventos || (Array.isArray(dados) ? dados : null);

        if (!Array.isArray(eventos)) {
          throw new Error('O arquivo JSON importado não contém uma lista válida de eventos.');
        }

        const agora = Date.now();
        const novoId = `sessao_importada_${agora}`;
        const dirPath = path.join(DIR_DADOS, novoId);
        fs.mkdirSync(dirPath, { recursive: true });

        meta.id = novoId;
        meta.nome = meta.nome ? `[Importado] ${meta.nome}` : `[Importado] Sessão ${new Date().toLocaleDateString('pt-BR')}`;
        meta.local = meta.local || 'Restaurante Universitário';
        meta.status = 'encerrada';
        meta.inicioMs = meta.inicioMs || (eventos[0]?.t || agora);
        meta.fimMs = meta.fimMs || (eventos[eventos.length - 1]?.t || agora);
        meta.config = meta.config || {};
        meta.filasAtivas = meta.filasAtivas || meta.config.filasAtivas || [1];

        fs.writeFileSync(path.join(dirPath, 'metadados.json'), JSON.stringify(meta, null, 2), 'utf-8');
        const linhasEventos = eventos.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.writeFileSync(path.join(dirPath, 'eventos.jsonl'), linhasEventos, 'utf-8');

        if (dados.rejeitados && Array.isArray(dados.rejeitados) && dados.rejeitados.length > 0) {
          const linhasRejeitados = dados.rejeitados.map(r => JSON.stringify(r)).join('\n') + '\n';
          fs.writeFileSync(path.join(dirPath, 'rejeitados.jsonl'), linhasRejeitados, 'utf-8');
        }

        if (dados.conexoes && Array.isArray(dados.conexoes) && dados.conexoes.length > 0) {
          const linhasConexoes = dados.conexoes.map(c => JSON.stringify(c)).join('\n') + '\n';
          fs.writeFileSync(path.join(dirPath, 'conexoes.jsonl'), linhasConexoes, 'utf-8');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, id: novoId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: false, erro: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ erro: 'Endpoint não encontrado.' }));
}

/**
 * Servidor WebSocket
 */
const wss = new WebSocketServer({ server: servidorHttp });

// Batimento de aplicação do servidor a cada 10s para encerrar conexões zumbis
const heartbeatInterval = setInterval(() => {
  for (const [ws, disp] of conexoesAtivas.entries()) {
    if (ws.isAlive === false) {
      console.log(`[WS] Encerrando conexão zumbi de ${disp.nome} (${disp.id})`);
      gerenciadorSessoes.registrarDesconexao(disp.id, disp.nome, 'ausencia_pong');
      conexoesAtivas.delete(ws);
      ws.terminate();
      transmitirListaAparelhos();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 10000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws, req) => {
  const ipCliente = req.socket.remoteAddress;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const infoDispositivo = {
    id: `disp_${Math.random().toString(36).substring(2, 9)}`,
    nome: 'Aparelho',
    papel: 'ambos',
    area: '1',
    autenticado: false,
    conectado: true,
    ip: ipCliente,
    latenciaMs: 0,
    offsetRelogioMs: 0,
    ultimoEventoMs: Date.now(),
    qtdEventos: 0
  };

  conexoesAtivas.set(ws, infoDispositivo);

  ws.on('message', (dadosBrutos) => {
    try {
      const msg = JSON.parse(dadosBrutos.toString());
      tratarMensagemWebSocket(ws, msg, infoDispositivo, req);
    } catch (err) {
      console.warn('[WS] Mensagem inválida recebida:', err);
    }
  });

  ws.on('close', () => {
    infoDispositivo.conectado = false;
    if (infoDispositivo.autenticado) {
      gerenciadorSessoes.registrarDesconexao(infoDispositivo.id, infoDispositivo.nome, 'socket_fechado');
    }
    conexoesAtivas.delete(ws);
    transmitirListaAparelhos();
  });

  ws.on('error', (err) => {
    console.warn('[WS] Erro na conexão do socket:', err);
  });
});

/**
 * Processamento das mensagens recebidas pelo WebSocket
 */
function tratarMensagemWebSocket(ws, msg, dispositivo, req) {
  // 1. Autenticação por PIN e Reconexão
  if (msg.tipo === 'autenticar') {
    const agora = Date.now();
    const pinRecebido = String(msg.pin || '').trim();
    const ehLocal = ehOrigemLocal(req) || ehOrigemLocal({ socket: { remoteAddress: dispositivo.ip } });
    const ehPainel = msg.papel === 'painel' || msg.nome === 'Painel Notebook' || msg.authLocal;
    const autenticadoPorOrigemLocal = ehLocal && ehPainel;

    // Se não for autenticado automaticamente por origem local, valida o PIN
    if (!autenticadoPorOrigemLocal && pinRecebido !== PIN_ACESSO) {
      const tentativa = tentativasPinPorIp.get(dispositivo.ip) || { contagem: 0, bloqueadoAte: 0 };
      if (agora < tentativa.bloqueadoAte) {
        const restanteSeg = Math.ceil((tentativa.bloqueadoAte - agora) / 1000);
        ws.send(JSON.stringify({
          tipo: 'autenticado',
          sucesso: false,
          mensagem: `Muitas tentativas incorretas. Tente novamente em ${restanteSeg} segundos.`
        }));
        return;
      }

      tentativa.contagem++;
      if (tentativa.contagem >= 5) {
        tentativa.bloqueadoAte = agora + 30000;
        tentativa.contagem = 0;
      }
      tentativasPinPorIp.set(dispositivo.ip, tentativa);

      ws.send(JSON.stringify({
        tipo: 'autenticado',
        sucesso: false,
        mensagem: 'PIN incorreto. Verifique o número no servidor.'
      }));
      return;
    }

    // PIN Válido ou Autenticação Local: limpa eventuais tentativas incorretas
    tentativasPinPorIp.delete(dispositivo.ip);

    // Se já havia um socket antigo conectado para este mesmo dispositivoId, fecha o antigo
    const dId = msg.dispositivoId || dispositivo.id;
    for (const [outroWs, outroDisp] of conexoesAtivas.entries()) {
      if (outroWs !== ws && outroDisp.id === dId) {
        const socketAberto = outroWs.readyState === WebSocket.OPEN || outroWs.readyState === WebSocket.CONNECTING;
        if (socketAberto) {
          const agoraLog = Date.now();
          const infoLog = rateLimitSubstituicaoLog.get(dId) || { count: 0, ultimoLogMs: 0 };
          infoLog.count++;

          if (agoraLog - infoLog.ultimoLogMs >= 3000) {
            if (infoLog.count > 1) {
              console.log(`[WS] Substituindo socket antigo do aparelho ${outroDisp.nome} (${dId}) (substituído ${infoLog.count} vezes)`);
            } else {
              console.log(`[WS] Substituindo socket antigo do aparelho ${outroDisp.nome} (${dId})`);
            }
            infoLog.ultimoLogMs = agoraLog;
            infoLog.count = 0;
          }
          rateLimitSubstituicaoLog.set(dId, infoLog);

          try {
            outroWs.close(4001, 'substituído');
          } catch (e) {
            outroWs.terminate();
          }
        }
        conexoesAtivas.delete(outroWs);
      }
    }

    dispositivo.autenticado = true;
    dispositivo.id = dId;
    if (msg.dispositivoNome) dispositivo.nome = msg.dispositivoNome;
    dispositivo.papel = msg.papel || (ehPainel ? 'painel' : 'ambos');
    if (msg.area) dispositivo.area = msg.area;

    gerenciadorSessoes.registrarConexao(dispositivo.id, dispositivo.nome, dispositivo.area);

    const sessaoAtiva = gerenciadorSessoes.sessaoAtiva;
    const estado = sessaoAtiva ? sessaoAtiva.estadoAtual : null;
    const eventos = sessaoAtiva ? sessaoAtiva.eventos : [];

    // Se o cliente informou o último seq que possui, envia os eventos faltantes
    let eventosFaltantes = [];
    if (msg.ultimoSeq !== undefined && sessaoAtiva) {
      eventosFaltantes = sessaoAtiva.eventos.filter(e => e.seq > msg.ultimoSeq);
    }

    ws.send(JSON.stringify({
      tipo: 'autenticado',
      sucesso: true,
      dispositivoId: dispositivo.id,
      sessao: gerenciadorSessoes.obterResumoSessaoAtiva(),
      estado,
      eventos,
      eventosFaltantes
    }));

    transmitirListaAparelhos();
    return;
  }

  // As mensagens subsequentes exigem autenticação
  if (!dispositivo.autenticado) {
    ws.send(JSON.stringify({
      tipo: 'erro',
      codigo: 'NAO_AUTENTICADO',
      mensagem: 'Envie o PIN de acesso para se conectar.'
    }));
    return;
  }

  // 2. Sincronização de relógio (NTP simplificado em 5 rodadas)
  if (msg.tipo === 'sync_ping') {
    ws.send(JSON.stringify({
      tipo: 'sync_pong',
      tCliente1: msg.tCliente1,
      tServidor: Date.now(),
      rodada: msg.rodada
    }));
    return;
  }

  // 3. Batimento cardíaco (Ping / Pong para latência)
  if (msg.tipo === 'ping') {
    if (msg.latencia !== undefined) dispositivo.latenciaMs = msg.latencia;
    if (msg.offsetRelogio !== undefined) dispositivo.offsetRelogioMs = msg.offsetRelogio;
    ws.send(JSON.stringify({
      tipo: 'pong',
      tServidor: Date.now()
    }));
    return;
  }

  // 4. Mudança de área (seja solicitada pelo celular ou pelo painel)
  if (msg.tipo === 'mudar_area') {
    const alvoId = msg.dispositivoId || dispositivo.id;
    const novaArea = msg.novaArea || msg.area || '1';

    // Localiza o dispositivo nas conexões ativas
    for (const [sck, disp] of conexoesAtivas.entries()) {
      if (disp.id === alvoId) {
        const areaAntiga = disp.area;
        disp.area = novaArea;
        gerenciadorSessoes.registrarMudancaArea(disp.id, disp.nome, areaAntiga, novaArea, dispositivo.nome);

        // Notifica o próprio celular da mudança
        sck.send(JSON.stringify({
          tipo: 'area_atualizada',
          area: novaArea
        }));
        break;
      }
    }

    // Grava evento de auditoria atribuicao
    const res = gerenciadorSessoes.processarComando({
      acao: 'atribuicao',
      dispositivoId: alvoId,
      dispositivoNome: msg.dispositivoNome || dispositivo.nome,
      area: novaArea
    }, { id: dispositivo.id, nome: dispositivo.nome });

    transmitirListaAparelhos();
    return;
  }

  // 5. Desativação de fila durante a sessão
  if (msg.tipo === 'desativar_fila') {
    const autor = { id: dispositivo.id, nome: dispositivo.nome, area: dispositivo.area };
    const res = gerenciadorSessoes.processarComando({
      acao: 'desativar_fila',
      fila: msg.fila
    }, autor);

    if (res.sucesso) {
      transmitirParaTodos({
        tipo: 'novo_evento',
        evento: res.evento,
        estado: res.estado,
        diff: res.diff
      });
      transmitirListaAparelhos();
    } else {
      ws.send(JSON.stringify({
        tipo: 'comando_resposta',
        sucesso: false,
        codigo: res.codigo,
        mensagem: res.mensagem
      }));
    }
    return;
  }

  // 6. Comandos de Coleta da Fila (chegada, atendido, anulacao, reversao, ajuste_fila, anotacao)
  if (msg.tipo === 'comando') {
    const autor = {
      id: dispositivo.id,
      nome: dispositivo.nome,
      area: dispositivo.area
    };

    const res = gerenciadorSessoes.processarComando(msg, autor, dispositivo.offsetRelogioMs);

    if (res.sucesso) {
      dispositivo.qtdEventos++;
      dispositivo.ultimoEventoMs = Date.now();

      // Confirmação ao remetente
      ws.send(JSON.stringify({
        tipo: 'comando_resposta',
        sucesso: true,
        clientEventId: res.clientEventId,
        evento: res.evento,
        eventos: res.eventos || (res.evento ? [res.evento] : [])
      }));

      // Difusão do evento (ou eventos de ajuste) para todos os aparelhos conectados
      if (res.eventos && res.eventos.length > 0) {
        for (const ev of res.eventos) {
          transmitirParaTodos({
            tipo: 'novo_evento',
            evento: ev,
            estado: res.estado,
            diff: res.diff
          });
        }
      } else if (res.evento) {
        transmitirParaTodos({
          tipo: 'novo_evento',
          evento: res.evento,
          eventoEncadeado: res.eventoEncadeado,
          estado: res.estado,
          diff: res.diff
        });
        if (res.eventoEncadeado) {
          transmitirParaTodos({
            tipo: 'novo_evento',
            evento: res.eventoEncadeado,
            estado: res.estado,
            diff: []
          });
        }
      }

      transmitirListaAparelhos();
    } else {
      // Rejeição com código e mensagem clara ao remetente
      ws.send(JSON.stringify({
        tipo: 'comando_resposta',
        sucesso: false,
        codigo: res.codigo,
        mensagem: res.mensagem,
        clientEventId: res.clientEventId
      }));

      // Notifica o painel sobre a rejeição para auditoria
      transmitirParaPainel({
        tipo: 'comando_rejeitado',
        rejeicao: {
          t: Date.now(),
          codigo: res.codigo,
          mensagem: res.mensagem,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          comando: msg
        }
      });
    }
    return;
  }

  // 7. Iniciar Sessão (pelo Painel)
  if (msg.tipo === 'iniciar_sessao') {
    try {
      const res = gerenciadorSessoes.iniciarSessao(msg.config, { id: dispositivo.id, nome: dispositivo.nome });
      transmitirParaTodos({
        tipo: 'sessao_iniciada',
        sessao: res.sessao,
        estado: res.estado,
        evento: res.evento
      });
    } catch (err) {
      ws.send(JSON.stringify({ tipo: 'erro', mensagem: err.message }));
    }
    return;
  }

  // 8. Encerrar Sessão (pelo Painel)
  if (msg.tipo === 'encerrar_sessao') {
    try {
      const res = gerenciadorSessoes.encerrarSessao({ id: dispositivo.id, nome: dispositivo.nome });
      transmitirParaTodos({
        tipo: 'sessao_encerrada',
        sessao: res.sessao,
        estado: res.estado,
        evento: res.evento
      });
    } catch (err) {
      ws.send(JSON.stringify({ tipo: 'erro', mensagem: err.message }));
    }
    return;
  }

  // 9. Simular Coleta de Teste
  if (msg.tipo === 'simular_teste') {
    executarSimulacaoTeste(ws, msg.qtdEventos || 60);
    return;
  }
}

/**
 * Transmite uma mensagem para todos os clientes autenticados.
 */
function transmitirParaTodos(objetoMsg) {
  const dados = JSON.stringify(objetoMsg);
  for (const [ws, disp] of conexoesAtivas.entries()) {
    if (disp.autenticado && ws.readyState === WebSocket.OPEN) {
      ws.send(dados);
    }
  }
}

/**
 * Transmite especificamente para painéis de notebook.
 */
function transmitirParaPainel(objetoMsg) {
  const dados = JSON.stringify(objetoMsg);
  for (const [ws, disp] of conexoesAtivas.entries()) {
    if (disp.autenticado && ws.readyState === WebSocket.OPEN) {
      ws.send(dados);
    }
  }
}

/**
 * Envia a lista atualizada de dispositivos conectados para o painel.
 */
function transmitirListaAparelhos() {
  const lista = [];
  for (const disp of conexoesAtivas.values()) {
    if (disp.autenticado) {
      lista.push({
        id: disp.id,
        nome: disp.nome,
        papel: disp.papel,
        area: disp.area || '1',
        conectado: disp.conectado,
        latenciaMs: disp.latenciaMs,
        ultimoEventoMs: disp.ultimoEventoMs,
        qtdEventos: disp.qtdEventos
      });
    }
  }

  transmitirParaPainel({
    tipo: 'lista_aparelhos',
    aparelhos: lista
  });
}

let simulacaoEmAndamento = false;

/**
 * Gera eventos sintéticos de teste para ensaio de carga e animação.
 */
async function executarSimulacaoTeste(ws, total = 60) {
  if (simulacaoEmAndamento) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ tipo: 'aviso', mensagem: 'Simulação de teste já em execução.' }));
    }
    return;
  }
  simulacaoEmAndamento = true;

  try {
    if (!gerenciadorSessoes.sessaoAtiva) {
      gerenciadorSessoes.iniciarSessao({
        nome: 'Coleta de Teste Sintética',
        local: 'RU - Simulação de Laboratório',
        observacoes: 'Sessão gerada automaticamente para teste de carga e animação.',
        filasAtivas: [1, 2, 3],
        duracaoPrevistaMin: 60,
        servidores: 1,
        blocoMin: 5,
        limiarPausaSeg: 60,
        teste: true
      }, { id: 'simulador', nome: 'Simulador' });

      transmitirParaTodos({
        tipo: 'sessao_iniciada',
        sessao: gerenciadorSessoes.obterResumoSessaoAtiva(),
        estado: gerenciadorSessoes.sessaoAtiva.estadoAtual
      });
    }

    const autor = { id: 'simulador', nome: 'Robô de Teste' };
    const filasAtivas = gerenciadorSessoes.sessaoAtiva.config.filasAtivas || [1];

    for (let i = 0; i < total; i++) {
      if (!gerenciadorSessoes.sessaoAtiva) break;

      // Escolhe uma fila ativa
      const filaEscolhida = filasAtivas[Math.floor(Math.random() * filasAtivas.length)];
      const filaObj = gerenciadorSessoes.sessaoAtiva.estadoAtual.filas[filaEscolhida];
      const filaVazia = !filaObj || filaObj.fila.length === 0;

      const deveChegar = Math.random() < 0.6 || filaVazia;

      if (deveChegar) {
        // Se Fila 2 estiver encadeada com Fila 1, chegada na Fila 2 vem da Fila 1
        if (filaEscolhida === 2 && filasAtivas.includes(1)) {
          // Gera chegada na Fila 1
          const res = gerenciadorSessoes.processarComando({
            acao: 'chegada',
            fila: 1,
            clientEventId: `sim_ch1_${Date.now()}_${i}`
          }, autor);
          if (res.sucesso) {
            transmitirParaTodos({
              tipo: 'novo_evento',
              evento: res.evento,
              eventoEncadeado: res.eventoEncadeado,
              estado: res.estado,
              diff: res.diff
            });
          }
        } else {
          const res = gerenciadorSessoes.processarComando({
            acao: 'chegada',
            fila: filaEscolhida,
            clientEventId: `sim_ch_${filaEscolhida}_${Date.now()}_${i}`
          }, autor);
          if (res.sucesso) {
            transmitirParaTodos({
              tipo: 'novo_evento',
              evento: res.evento,
              eventoEncadeado: res.eventoEncadeado,
              estado: res.estado,
              diff: res.diff
            });
          }
        }
      } else {
        if (filaObj && filaObj.fila.length > 0) {
          const cabeca = filaObj.fila[0];
          const res = gerenciadorSessoes.processarComando({
            acao: 'atendido',
            fila: filaEscolhida,
            pessoaEsperada: cabeca,
            clientEventId: `sim_at_${filaEscolhida}_${Date.now()}_${i}`
          }, autor);

          if (res.sucesso) {
            transmitirParaTodos({
              tipo: 'novo_evento',
              evento: res.evento,
              eventoEncadeado: res.eventoEncadeado,
              estado: res.estado,
              diff: res.diff
            });
          }
        }
      }

      await new Promise(r => setTimeout(r, 220));
    }
  } finally {
    simulacaoEmAndamento = false;
  }
}

/**
 * Inicialização do Servidor
 */
servidorHttp.listen(PORTA, '0.0.0.0', async () => {
  const rede = detectarEnderecosRede();
  const urlCelular = `http://${rede.ipPreferido}:${PORTA}/celular.html`;
  const urlPainel = `http://localhost:${PORTA}/painel.html`;
  const urlHistorico = `http://localhost:${PORTA}/historico.html`;

  let qrTerminal = '';
  try {
    const resQr = await gerarQrCode(urlCelular);
    qrTerminal = resQr.qrTerminal;
  } catch (e) {}

  console.log('\n================================================================');
  console.log('   SISTEMA COLABORATIVO DE COLETA DA FILA DO RU - SERVIDOR');
  console.log('================================================================');
  console.log(`\n  Rede Local (Hotspot): ${rede.ipPreferido}`);
  console.log(`  PIN DE ACESSO:        >>> ${PIN_ACESSO} <<<\n`);
  console.log('  Conexão dos Celulares:');
  console.log(`    URL: ${urlCelular}`);
  console.log('  Painel do Notebook (Projeção):');
  console.log(`    URL: ${urlPainel}`);
  console.log('  Histórico e Relatórios:');
  console.log(`    URL: ${urlHistorico}`);
  if (qrTerminal) {
    console.log('\n----------------- QR CODE PARA OS CELULARES --------------------');
    console.log(qrTerminal);
    console.log('----------------------------------------------------------------');
  }
  console.log(`Servidor ouvindo em todas as interfaces na porta ${PORTA}.\n`);
});
