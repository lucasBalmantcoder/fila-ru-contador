/**
 * server/server.js
 * Servidor HTTP nativo e WebSocket para coordenação colaborativa em tempo real.
 * Não utiliza Express; apenas os módulos nativos do Node.js e as bibliotecas 'ws' e 'qrcode'.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { detectarEnderecosRede, obterOuGerarPin, gerarQrCode } from './rede.js';
import { GerenciadorSessoes } from './sessao.js';
import { calcularMetricas, formatarNumero, formatarDuracao, formatarHoraLocal } from '../shared/metricas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR_RAIZ = path.resolve(__dirname, '..');
const DIR_PUBLIC = path.resolve(DIR_RAIZ, 'public');
const DIR_SHARED = path.resolve(DIR_RAIZ, 'shared');

const PORTA = process.env.PORT || 3000;
const PIN_ACESSO = obterOuGerarPin();
const gerenciadorSessoes = new GerenciadorSessoes();

// Rastreamento de tentativas incorretas de PIN por endereço IP
const tentativasPinPorIp = new Map(); // ip -> { contagem, bloqueadoAte }

// Dispositivos conectados via WebSocket: Map(ws -> Dispositivo)
const conexoesAtivas = new Map();

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
function tratarRequisicaoApi(req, res, pathname, urlParsed) {
  // CORS para a rede local
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/info - Retorna dados de rede e PIN para o painel
  if (pathname === '/api/info' && req.method === 'GET') {
    const rede = detectarEnderecosRede();
    const urlCelular = `http://${rede.ipPreferido}:${PORTA}/celular.html`;
    gerarQrCode(urlCelular).then(({ qrDataUrl }) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ipPreferido: rede.ipPreferido,
        todasInterfaces: rede.todasInterfaces,
        porta: PORTA,
        pin: PIN_ACESSO,
        urlCelular,
        qrDataUrl,
        sessaoAtiva: gerenciadorSessoes.obterResumoSessaoAtiva()
      }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: err.message }));
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

    // Obter dados completos da sessão
    const dadosSessao = gerenciadorSessoes.obterSessaoCompleta(sessaoId);
    if (!dadosSessao) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Sessão não encontrada.' }));
      return;
    }

    // GET /api/sessoes/:id (detalhes e métricas)
    if (!subAcao && req.method === 'GET') {
      const metricas = calcularMetricas(dadosSessao.eventos, dadosSessao.meta.config, dadosSessao.meta.fimMs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        meta: dadosSessao.meta,
        eventos: dadosSessao.eventos,
        rejeitados: dadosSessao.rejeitados,
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
      res.end(JSON.stringify(dadosSessao, null, 2));
      return;
    }

    // GET /api/sessoes/:id/csv-pessoas
    if (subAcao === 'csv-pessoas' && req.method === 'GET') {
      const metricas = calcularMetricas(dadosSessao.eventos, dadosSessao.meta.config, dadosSessao.meta.fimMs);
      let csv = '\uFEFFPessoa;Horario_Chegada;Horario_Atendimento;Tempo_Espera_Seg;Intervalo_Atendimento_Seg;Status;Disp_Chegada;Disp_Atendimento\r\n';

      for (const p of metricas.pessoas) {
        const chegadaStr = p.chegadaMs ? formatarHoraLocal(p.chegadaMs) : '';
        const atendStr = p.atendimentoMs ? formatarHoraLocal(p.atendimentoMs) : '';
        const esperaSeg = p.esperaMs !== null ? formatarNumero(p.esperaMs / 1000, 2) : '';
        const intSeg = p.intervaloAtendimentoMs !== null ? formatarNumero(p.intervaloAtendimentoMs / 1000, 2) : '';

        csv += `${p.pessoa};${chegadaStr};${atendStr};${esperaSeg};${intSeg};${p.status};${p.dispositivoChegada || ''};${p.dispositivoAtendimento || ''}\r\n`;
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
      let csv = '\uFEFFSeq;Horario;Tipo;Pessoa;Dispositivo;Tardio;Texto\r\n';
      for (const ev of dadosSessao.eventos) {
        csv += `${ev.seq};${formatarHoraLocal(ev.t)};${ev.tipo};${ev.pessoa || ''};${ev.dispositivoNome || ''};${ev.tardio ? 'SIM' : 'NAO'};${ev.texto ? `"${ev.texto.replace(/"/g, '""')}"` : ''}\r\n`;
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="eventos_${sessaoId}.csv"`
      });
      res.end(csv);
      return;
    }

    // GET /api/sessoes/:id/csv-metricas
    if (subAcao === 'csv-metricas' && req.method === 'GET') {
      const m = calcularMetricas(dadosSessao.eventos, dadosSessao.meta.config, dadosSessao.meta.fimMs);
      let csv = '\uFEFFMetrica;Valor;Unidade\r\n';
      csv += `Nome da Sessao;${dadosSessao.meta.nome};\r\n`;
      csv += `Local;${dadosSessao.meta.local};\r\n`;
      csv += `Duracao Observada;${formatarDuracao(m.duracaoTotalMs)};HH:MM:SS\r\n`;
      csv += `Duracao em Minutos;${formatarNumero(m.duracaoMin, 2)};min\r\n`;
      csv += `Total de Chegadas;${m.n_chegadas};pessoas\r\n`;
      csv += `Total de Atendidos;${m.n_atendimentos};pessoas\r\n`;
      csv += `Total de Anulados;${m.n_anuladas};pessoas\r\n`;
      csv += `Total de Revertidos;${m.n_revertidas};pessoas\r\n`;
      csv += `Pessoas Restantes na Fila;${m.n_na_fila};pessoas\r\n`;
      csv += `Taxa de Chegada (lambda);${formatarNumero(m.lambda, 4)};pessoas/min\r\n`;
      csv += `Taxa de Servico (mu);${formatarNumero(m.muPorServidor, 4)};pessoas/min/servidor\r\n`;
      csv += `Utilizacao do Sistema (rho);${formatarNumero(m.utilizacao * 100, 2)};%\r\n`;
      csv += `Vazao Global;${formatarNumero(m.vazaoGlobalPorMin, 4)};pessoas/min\r\n`;
      csv += `Vazao Operacional Efetiva;${formatarNumero(m.vazaoOperacionalPorMin, 4)};pessoas/min\r\n`;
      csv += `Tempo de Espera Medio;${formatarNumero(m.statsEspera.media, 2)};seg\r\n`;
      csv += `Tempo de Espera Mediano;${formatarNumero(m.statsEspera.mediana, 2)};seg\r\n`;
      csv += `Tempo de Espera Desvio Padrao;${formatarNumero(m.statsEspera.desvioPadrao, 2)};seg\r\n`;
      csv += `Tempo de Espera P90;${formatarNumero(m.statsEspera.p90, 2)};seg\r\n`;
      csv += `Tempo de Espera P95;${formatarNumero(m.statsEspera.p95, 2)};seg\r\n`;
      csv += `Intervalo Atendimentos Medio;${formatarNumero(m.statsIntervalosAtend.media, 2)};seg\r\n`;
      csv += `Intervalo Atendimentos CV;${formatarNumero(m.statsIntervalosAtend.cv, 4)};\r\n`;
      csv += `Comprimento Fila Medio Ponderado (L);${formatarNumero(m.filaTempo.mediaPonderada, 4)};pessoas\r\n`;
      csv += `Pico Maximo da Fila;${m.filaTempo.max};pessoas\r\n`;
      csv += `Lei de Little Produto lambda*W;${formatarNumero(m.little.L_calculado_lambda_W, 4)};pessoas\r\n`;
      csv += `Lei de Little Diferenca Percentual;${formatarNumero(m.little.diffPerc, 2)};%\r\n`;
      csv += `Tempo Total Ocioso;${formatarDuracao(m.ociosidade.tempoOciosoTotalMs)};HH:MM:SS\r\n`;
      csv += `Percentual Ocioso;${formatarNumero(m.ociosidade.percentualOcioso, 2)};%\r\n`;

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="metricas_${sessaoId}.csv"`
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
        if (!dados.meta || !dados.eventos || !Array.isArray(dados.eventos)) {
          throw new Error('Formato de arquivo JSON inválido.');
        }

        const novoId = `sessao_importada_${Date.now()}`;
        const dirPath = path.join(DIR_DADOS, novoId);
        fs.mkdirSync(dirPath, { recursive: true });

        dados.meta.id = novoId;
        dados.meta.nome = `[Importado] ${dados.meta.nome}`;
        dados.meta.status = 'encerrada';

        fs.writeFileSync(path.join(dirPath, 'metadados.json'), JSON.stringify(dados.meta, null, 2), 'utf-8');
        const linhasEventos = dados.eventos.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.writeFileSync(path.join(dirPath, 'eventos.jsonl'), linhasEventos, 'utf-8');

        if (dados.rejeitados && dados.rejeitados.length > 0) {
          const linhasRejeitados = dados.rejeitados.map(r => JSON.stringify(r)).join('\n') + '\n';
          fs.writeFileSync(path.join(dirPath, 'rejeitados.jsonl'), linhasRejeitados, 'utf-8');
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

wss.on('connection', (ws, req) => {
  const ipCliente = req.socket.remoteAddress;

  const infoDispositivo = {
    id: `disp_${Math.random().toString(36).substring(2, 9)}`,
    nome: 'Aparelho',
    papel: 'ambos',
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
      tratarMensagemWebSocket(ws, msg, infoDispositivo);
    } catch (err) {
      console.warn('[WS] Mensagem inválida recebida:', err);
    }
  });

  ws.on('close', () => {
    infoDispositivo.conectado = false;
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
function tratarMensagemWebSocket(ws, msg, dispositivo) {
  // 1. Autenticação por PIN
  if (msg.tipo === 'autenticar') {
    const agora = Date.now();
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

    if (String(msg.pin).trim() !== PIN_ACESSO) {
      tentativa.contagem++;
      if (tentativa.contagem >= 5) {
        tentativa.bloqueadoAte = agora + 30000; // Bloqueio temporário de 30s
        tentativa.contagem = 0;
      }
      tentativasPinPorIp.set(dispositivo.ip, tentativa);

      ws.send(JSON.stringify({
        tipo: 'autenticado',
        sucesso: false,
        mensagem: 'PIN incorreto. Verifique o número exibido no painel do notebook.'
      }));
      return;
    }

    // PIN Válido
    tentativasPinPorIp.delete(dispositivo.ip);
    dispositivo.autenticado = true;
    if (msg.dispositivoId) dispositivo.id = msg.dispositivoId;
    if (msg.dispositivoNome) dispositivo.nome = msg.dispositivoNome;
    if (msg.papel) dispositivo.papel = msg.papel;

    const sessaoAtiva = gerenciadorSessoes.sessaoAtiva;
    const estado = sessaoAtiva ? sessaoAtiva.estadoAtual : null;
    const eventos = sessaoAtiva ? sessaoAtiva.eventos : [];

    ws.send(JSON.stringify({
      tipo: 'autenticado',
      sucesso: true,
      dispositivoId: dispositivo.id,
      sessao: gerenciadorSessoes.obterResumoSessaoAtiva(),
      estado,
      eventos
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
    if (msg.latencia !== undefined) {
      dispositivo.latenciaMs = msg.latencia;
    }
    if (msg.offsetRelogio !== undefined) {
      dispositivo.offsetRelogioMs = msg.offsetRelogio;
    }
    ws.send(JSON.stringify({
      tipo: 'pong',
      tServidor: Date.now()
    }));
    return;
  }

  // 4. Comandos de Coleta da Fila (chegada, atendido, anulacao, reversao, anotacao)
  if (msg.tipo === 'comando') {
    const autor = {
      id: dispositivo.id,
      nome: dispositivo.nome
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
        evento: res.evento
      }));

      // Difusão do evento para todos os aparelhos conectados
      transmitirParaTodos({
        tipo: 'novo_evento',
        evento: res.evento,
        estado: res.estado,
        diff: res.diff
      });

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

  // 5. Iniciar Sessão (pelo Painel)
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

  // 6. Encerrar Sessão (pelo Painel)
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

  // 7. Simular Coleta de Teste
  if (msg.tipo === 'simular_teste') {
    executarSimulacaoTeste(ws, msg.qtdEventos || 80);
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

/**
 * Gera eventos sintéticos de teste para ensaio de carga e animação.
 */
async function executarSimulacaoTeste(ws, total = 80) {
  if (!gerenciadorSessoes.sessaoAtiva) {
    gerenciadorSessoes.iniciarSessao({
      nome: 'Coleta de Teste Sintética',
      local: 'RU - Simulação de Laboratório',
      observacoes: 'Sessão gerada automaticamente para teste de carga e animação.',
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
  let chegadasRealizadas = 0;

  for (let i = 0; i < total; i++) {
    // Alterna entre chegadas e atendimentos
    const deveChegar = Math.random() < 0.55 || gerenciadorSessoes.sessaoAtiva.estadoAtual.fila.length === 0;

    if (deveChegar) {
      chegadasRealizadas++;
      const res = gerenciadorSessoes.processarComando({
        acao: 'chegada',
        clientEventId: `sim_cheg_${Date.now()}_${i}`
      }, autor);

      transmitirParaTodos({
        tipo: 'novo_evento',
        evento: res.evento,
        estado: res.estado,
        diff: res.diff
      });
    } else {
      const fila = gerenciadorSessoes.sessaoAtiva.estadoAtual.fila;
      if (fila.length > 0) {
        const res = gerenciadorSessoes.processarComando({
          acao: 'atendido',
          pessoaEsperada: fila[0],
          clientEventId: `sim_atend_${Date.now()}_${i}`
        }, autor);

        if (res.sucesso) {
          transmitirParaTodos({
            tipo: 'novo_evento',
            evento: res.evento,
            estado: res.estado,
            diff: res.diff
          });
        }
      }
    }

    // Pequeno intervalo entre ações simuladas
    await new Promise(r => setTimeout(r, 120));
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

  const { qrTerminal } = await gerarQrCode(urlCelular);

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
  console.log('\n----------------- QR CODE PARA OS CELULARES --------------------');
  console.log(qrTerminal);
  console.log('----------------------------------------------------------------');
  console.log(`Servidor ouvindo em todas as interfaces na porta ${PORTA}.\n`);
});
