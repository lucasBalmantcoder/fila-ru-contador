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
import { obterZonasPadrao, gerarPontosDeZonas } from '../shared/estado.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR_RAIZ = path.resolve(__dirname, '..');
const DIR_PUBLIC = path.resolve(DIR_RAIZ, 'public');
const DIR_SHARED = path.resolve(DIR_RAIZ, 'shared');
const DIR_DADOS = path.resolve(DIR_RAIZ, 'dados');

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
  } else if (pathname === '/pontos') {
    caminhoArquivoRelativo = '/pontos.html';
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
 * Trata requisições da API REST (Download de relatórios, CSV, listagem de sessões, presets e QR codes).
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

  // GET /api/info - Retorna dados de rede, PIN e resumo da sessão
  if (pathname === '/api/info' && req.method === 'GET') {
    const rede = detectarEnderecosRede();
    const urlCelular = `http://${rede.ipPreferido}:${PORTA}/celular.html`;
    try {
      const { qrDataUrl } = await gerarQrCode(urlCelular);
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
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: err.message }));
    }
    return;
  }

  // GET /api/presets & POST /api/presets
  if (pathname === '/api/presets') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(gerenciadorSessoes.obterPresets()));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const preset = JSON.parse(body);
          if (!preset.nome || !Array.isArray(preset.zonas)) {
            throw new Error('Preset inválido: nome e lista de zonas são obrigatórios.');
          }
          if (!preset.id) preset.id = `custom_${Date.now()}`;
          const presets = gerenciadorSessoes.salvarPreset(preset);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sucesso: true, presets }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sucesso: false, erro: err.message }));
        }
      });
      return;
    }
  }

  // GET /api/pontos-qr - Retorna QR codes por ponto de verificação para impressão
  if (pathname === '/api/pontos-qr' && req.method === 'GET') {
    const rede = detectarEnderecosRede();
    const sessaoAtiva = gerenciadorSessoes.sessaoAtiva;
    let pontos = [];

    if (sessaoAtiva) {
      pontos = sessaoAtiva.config.pontos;
    } else {
      const zonasPadrao = obterZonasPadrao();
      pontos = gerarPontosDeZonas(zonasPadrao);
    }

    try {
      const listaPontosQr = await Promise.all(pontos.map(async (p) => {
        const urlPonto = `http://${rede.ipPreferido}:${PORTA}/celular.html?ponto=${encodeURIComponent(p.id)}`;
        const { qrDataUrl } = await gerarQrCode(urlPonto);
        return {
          id: p.id,
          nome: p.nome,
          de: p.de,
          para: p.para,
          modoOrigem: p.modoOrigem,
          url: urlPonto,
          qrDataUrl
        };
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        pin: PIN_ACESSO,
        pontos: listaPontosQr
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: err.message }));
    }
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
      const zonasHabilitadas = metricas.config.zonas.filter(z => z.habilitada !== false);

      let header = '\uFEFFPessoa;Situacao';
      for (const z of zonasHabilitadas) {
        header += `;Entrada_${z.nome.replace(/\s+/g, '_')};Saida_${z.nome.replace(/\s+/g, '_')};Tempo_${z.nome.replace(/\s+/g, '_')}_Seg`;
      }
      header += ';Tempo_Total_Sistema_Seg;Chegada;Saida_Final\r\n';

      let csv = header;
      for (const p of metricas.pessoas) {
        let linha = `${p.pessoa};${p.situacao}`;
        for (const z of zonasHabilitadas) {
          const entr = p.zonaEntradaMs?.[z.id] ? formatarHoraLocal(p.zonaEntradaMs[z.id]) : '';
          const sai = p.zonaSaidaMs?.[z.id] ? formatarHoraLocal(p.zonaSaidaMs[z.id]) : '';
          const tempo = (p.tempoZonaMs?.[z.id] !== undefined && p.tempoZonaMs?.[z.id] !== null)
            ? formatarNumero(p.tempoZonaMs[z.id] / 1000, 2)
            : '';
          linha += `;${entr};${sai};${tempo}`;
        }
        const tempoTotal = p.tempoTotalMs !== null ? formatarNumero(p.tempoTotalMs / 1000, 2) : '';
        const chegStr = p.chegadaMs ? formatarHoraLocal(p.chegadaMs) : '';
        const saiStr = p.saidaMs ? formatarHoraLocal(p.saidaMs) : '';
        linha += `;${tempoTotal};${chegStr};${saiStr}\r\n`;
        csv += linha;
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pessoas_${sessaoId}.csv"`
      });
      res.end(csv);
      return;
    }

    // GET /api/sessoes/:id/csv-resumo-zonas
    if (subAcao === 'csv-resumo-zonas' && req.method === 'GET') {
      const metricas = calcularMetricas(dadosSessao.eventos, dadosSessao.meta.config, dadosSessao.meta.fimMs);
      let csv = '\uFEFFZona_ID;Nome;Modo;Entradas;Saidas;Anuladas;Ocupacao_Media_L;Pico_Maximo;Tempo_Medio_Concluidos_Seg;Tempo_Medio_Little_Seg;Divergencia_Little_Perc;Taxa_Entrada_Lambda_Min;Vazao_Saida_Min;Taxa_Servico_Mu_Min;Utilizacao_Perc;Participacao_Tempo_Total_Perc\r\n';

      for (const z of Object.values(metricas.zonas)) {
        csv += `${z.id};${z.nome};${z.modo};${z.entradas};${z.saidas};${z.anuladas};` +
               `${formatarNumero(z.ocupacao.mediaPonderada, 4)};${z.ocupacao.max};` +
               `${formatarNumero(z.tempoMedioConcluidosSeg, 2)};${formatarNumero(z.tempoMedioLittleSeg, 2)};` +
               `${formatarNumero(z.divergenciaLittle.diffPerc, 2)};${formatarNumero(z.taxaEntradaLambda, 4)};` +
               `${formatarNumero(z.vazaoSaida, 4)};${formatarNumero(z.muPorServidor, 4)};` +
               `${formatarNumero(z.utilizacao * 100, 2)};${formatarNumero(z.participacaoTempoTotal, 2)}\r\n`;
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="resumo_zonas_${sessaoId}.csv"`
      });
      res.end(csv);
      return;
    }

    // GET /api/sessoes/:id/csv-eventos
    if (subAcao === 'csv-eventos' && req.method === 'GET') {
      let csv = '\uFEFFSeq;Horario;Horario_Efetivo;Tipo;Pessoa;Ponto;De;Para;Identidade;Dispositivo;Tardio;Inversao_Corrigida;Texto\r\n';
      for (const ev of dadosSessao.eventos) {
        const hOrig = formatarHoraLocal(ev.t);
        const hEfet = formatarHoraLocal(ev.tEfetivo ?? ev.t);
        csv += `${ev.seq};${hOrig};${hEfet};${ev.tipo};${ev.pessoa || ''};${ev.ponto || ''};${ev.de || ''};${ev.para || ''};${ev.identidade || ''};${ev.dispositivoNome || ''};${ev.tardio ? 'SIM' : 'NAO'};${ev.inversaoCorrigida ? 'SIM' : 'NAO'};${ev.texto ? `"${ev.texto.replace(/"/g, '""')}"` : ''}\r\n`;
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
      csv += `Total de Chegadas;${m.balanco.chegadas};pessoas\r\n`;
      csv += `Total de Concluidos (Saidas);${m.balanco.saidas};pessoas\r\n`;
      csv += `Total de Anulados;${m.balanco.anuladas};pessoas\r\n`;
      csv += `Presentes no Sistema;${m.balanco.presentes};pessoas\r\n`;
      csv += `Balanco de Consistencia;${m.balanco.consistente ? 'OK' : 'DISCREPANCIA'};\r\n`;
      csv += `Tempo Medio no Sistema;${formatarNumero(m.global.tempoMedioSistemaSeg, 2)};seg\r\n`;
      csv += `Taxa Global Chegadas (lambda);${formatarNumero(m.global.lambdaGlobal, 4)};pessoas/min\r\n`;
      csv += `Ocupacao Media Global (L);${formatarNumero(m.global.L_medioGlobal, 4)};pessoas\r\n`;
      csv += `Lei de Little Global (lambda*W);${formatarNumero(m.global.littleGlobal.L_calculado_lambda_W, 4)};pessoas\r\n`;
      csv += `Lei de Little Global Diferenca;${formatarNumero(m.global.littleGlobal.diffPerc, 2)};%\r\n`;

      for (const z of Object.values(m.zonas)) {
        csv += `\r\n--- Zona: ${z.nome} (${z.id}) ---\r\n`;
        csv += `Modo;${z.modo};\r\n`;
        csv += `Entradas;${z.entradas};pessoas\r\n`;
        csv += `Saidas;${z.saidas};pessoas\r\n`;
        csv += `Ocupacao Media (L);${formatarNumero(z.ocupacao.mediaPonderada, 4)};pessoas\r\n`;
        csv += `Ocupacao Pico;${z.ocupacao.max};pessoas\r\n`;
        csv += `Tempo Medio Concluintes;${formatarNumero(z.tempoMedioConcluidosSeg, 2)};seg\r\n`;
        csv += `Tempo Medio Little;${formatarNumero(z.tempoMedioLittleSeg, 2)};seg\r\n`;
        csv += `Divergencia Little;${formatarNumero(z.divergenciaLittle.diffPerc, 2)};%\r\n`;
        csv += `Taxa Entrada (lambda);${formatarNumero(z.taxaEntradaLambda, 4)};pessoas/min\r\n`;
        csv += `Vazao Saida;${formatarNumero(z.vazaoSaida, 4)};pessoas/min\r\n`;
        csv += `Participacao no Tempo Total;${formatarNumero(z.participacaoTempoTotal, 2)};%\r\n`;
      }

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
    papel: 'avaliador',
    autenticado: false,
    conectado: true,
    ip: ipCliente,
    latenciaMs: 0,
    offsetRelogioMs: 0,
    ultimoEventoMs: Date.now(),
    qtdEventos: 0,
    pontoDesejado: null
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
        tentativa.bloqueadoAte = agora + 30000;
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
    if (msg.pontoDesejado) dispositivo.pontoDesejado = msg.pontoDesejado;

    const sessaoAtiva = gerenciadorSessoes.sessaoAtiva;

    // Autoatribuição se leu QR de ponto específico
    if (sessaoAtiva && msg.pontoDesejado) {
      const pontoExiste = sessaoAtiva.config.pontos.some(p => p.id === msg.pontoDesejado);
      if (pontoExiste) {
        const novasAtrib = { ...sessaoAtiva.atribuicoes, [dispositivo.id]: [msg.pontoDesejado] };
        gerenciadorSessoes.atualizarAtribuicoes(novasAtrib, { id: dispositivo.id, nome: dispositivo.nome });
      }
    } else if (sessaoAtiva && sessaoAtiva.config.autoAtribuirLivres && dispositivo.papel === 'avaliador') {
      // Autoatribuição de pontos livres a novos aparelhos
      const atribuicoesAtuais = sessaoAtiva.atribuicoes;
      if (!atribuicoesAtuais[dispositivo.id] || atribuicoesAtuais[dispositivo.id].length === 0) {
        const todosPontos = sessaoAtiva.config.pontos.map(p => p.id);
        const pontosOcupados = new Set(Object.values(atribuicoesAtuais).flat());
        const pontoLivre = todosPontos.find(pId => !pontosOcupados.has(pId));
        if (pontoLivre) {
          const novasAtrib = { ...atribuicoesAtuais, [dispositivo.id]: [pontoLivre] };
          gerenciadorSessoes.atualizarAtribuicoes(novasAtrib, { id: dispositivo.id, nome: dispositivo.nome });
        }
      }
    }

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

  // Mensagens subsequentes exigem autenticação
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

  // 4. Comandos de Coleta da Fila (chegada, avanço, anulação, reversão, anotação)
  if (msg.tipo === 'comando') {
    const autor = {
      id: dispositivo.id,
      nome: dispositivo.nome,
      papel: dispositivo.papel
    };

    // Callback para difundir evento quando uma inversão for resolvida
    const onInversaoResolvida = (eventoJusante, estadoNovo) => {
      transmitirParaTodos({
        tipo: 'novo_evento',
        evento: eventoJusante,
        estado: estadoNovo,
        diff: [{
          op: 'mover',
          pessoa: eventoJusante.pessoa,
          de: eventoJusante.de,
          para: eventoJusante.para,
          ponto: eventoJusante.ponto,
          identidade: eventoJusante.identidade
        }]
      });
    };

    const res = gerenciadorSessoes.processarComando(msg, autor, dispositivo.offsetRelogioMs, onInversaoResolvida);

    if (res.sucesso) {
      dispositivo.qtdEventos++;
      dispositivo.ultimoEventoMs = Date.now();

      if (res.pendenteInversao) {
        // Evento entrou em espera por inversão temporária
        ws.send(JSON.stringify({
          tipo: 'comando_resposta',
          sucesso: true,
          pendenteInversao: true,
          clientEventId: res.clientEventId,
          mensagem: res.mensagem
        }));
      } else {
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

  // 7. Atualizar Atribuições de Aparelhos aos Pontos (pelo Painel)
  if (msg.tipo === 'atribuir_pontos') {
    try {
      const res = gerenciadorSessoes.atualizarAtribuicoes(msg.atribuicoes, { id: dispositivo.id, nome: dispositivo.nome });
      transmitirParaTodos({
        tipo: 'atribuicoes_atualizadas',
        atribuicoes: res.atribuicoes,
        evento: res.evento,
        sessao: gerenciadorSessoes.obterResumoSessaoAtiva()
      });
      transmitirListaAparelhos();
    } catch (err) {
      ws.send(JSON.stringify({ tipo: 'erro', mensagem: err.message }));
    }
    return;
  }

  // 8. Atualizar Configurações Permitidas da Sessão Ativa (Nomes, cores, capacidades)
  if (msg.tipo === 'atualizar_config_sessao') {
    try {
      const meta = gerenciadorSessoes.atualizarConfiguracaoSessao(msg.alteracoes);
      transmitirParaTodos({
        tipo: 'config_atualizada',
        meta,
        sessao: gerenciadorSessoes.obterResumoSessaoAtiva(),
        estado: gerenciadorSessoes.sessaoAtiva.estadoAtual
      });
    } catch (err) {
      ws.send(JSON.stringify({ tipo: 'erro', mensagem: err.message }));
    }
    return;
  }

  // 9. Simular Coleta de Teste
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
 * Transmite especificamente para o painel.
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
 * Envia a lista atualizada de dispositivos conectados para o painel e clientes.
 */
function transmitirListaAparelhos() {
  const sessaoAtiva = gerenciadorSessoes.sessaoAtiva;
  const atribuicoes = sessaoAtiva ? sessaoAtiva.atribuicoes : {};

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
        qtdEventos: disp.qtdEventos,
        pontosAtribuidos: atribuicoes[disp.id] || []
      });
    }
  }

  transmitirParaPainel({
    tipo: 'lista_aparelhos',
    aparelhos: lista,
    atribuicoes
  });
}

/**
 * Monitor periódico a cada 1 segundo para descarte de inversões expiradas.
 */
setInterval(() => {
  if (gerenciadorSessoes.sessaoAtiva) {
    const agora = Date.now();
    gerenciadorSessoes.descartarPendentesExpirados(agora, (pendente) => {
      // Notifica o aparelho remetente
      for (const [ws, disp] of conexoesAtivas.entries()) {
        if (disp.id === pendente.autor.id && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            tipo: 'comando_resposta',
            sucesso: false,
            codigo: 'EXPIRADO',
            mensagem: `Evento no ponto "${pendente.pontoAlvo?.nome || pendente.pontoAlvo?.id}" expirou sem confirmação a montante.`,
            clientEventId: pendente.clientEventId
          }));
        }
      }

      // Notifica o painel sobre a rejeição
      transmitirParaPainel({
        tipo: 'comando_rejeitado',
        rejeicao: {
          t: agora,
          codigo: 'EXPIRADO',
          mensagem: 'Evento de avanço expirou sem registro a montante.',
          dispositivoId: pendente.autor.id,
          dispositivoNome: pendente.autor.nome,
          comando: pendente.cmd
        }
      });
    });
  }
}, 1000);

/**
 * Gera eventos sintéticos de teste para ensaio de carga e animação através de todas as zonas.
 */
async function executarSimulacaoTeste(ws, total = 80) {
  if (!gerenciadorSessoes.sessaoAtiva) {
    const zonasPadrao = obterZonasPadrao();
    gerenciadorSessoes.iniciarSessao({
      nome: 'Coleta de Teste Sintética (Zonas RU)',
      local: 'RU - Simulação de Laboratório',
      observacoes: 'Sessão gerada automaticamente para teste de carga e animação multi-zona.',
      duracaoPrevistaMin: 60,
      servidores: 1,
      blocoMin: 5,
      limiarPausaSeg: 60,
      limiarAlertaOciosoSeg: 120,
      janelaInversaoS: 20,
      teste: true,
      zonas: zonasPadrao
    }, { id: 'simulador', nome: 'Simulador' });

    transmitirParaTodos({
      tipo: 'sessao_iniciada',
      sessao: gerenciadorSessoes.obterResumoSessaoAtiva(),
      estado: gerenciadorSessoes.sessaoAtiva.estadoAtual
    });
  }

  const autor = { id: 'simulador', nome: 'Robô de Teste', papel: 'supervisor' };
  const pontos = gerenciadorSessoes.sessaoAtiva.config.pontos;

  for (let i = 0; i < total; i++) {
    const estado = gerenciadorSessoes.sessaoAtiva.estadoAtual;
    const primeiraZona = gerenciadorSessoes.sessaoAtiva.config.zonas.filter(z => z.habilitada !== false)[0]?.id || 'z1';

    // Determina ação: se fila inicial estiver vazia, gera chegada
    let pontoEscolhido = null;
    let acao = 'chegada';
    let pessoaEsperada = null;

    const zonasComGente = Object.values(estado.zonas).filter(z => z.fila.length > 0);
    const deveChegar = Math.random() < 0.45 || zonasComGente.length === 0;

    if (deveChegar) {
      acao = 'chegada';
      pontoEscolhido = pontos[0];
    } else {
      acao = 'avanco';
      // Escolhe uma zona que tem gente para avançar
      const zonaSorteada = zonasComGente[Math.floor(Math.random() * zonasComGente.length)];
      pontoEscolhido = pontos.find(p => p.de === zonaSorteada.id);
      if (zonaSorteada.modo === 'fifo') {
        pessoaEsperada = zonaSorteada.fila[0];
      }
    }

    if (pontoEscolhido) {
      const cmd = {
        acao,
        ponto: pontoEscolhido.id,
        pessoaEsperada,
        clientEventId: `sim_${Date.now()}_${i}`
      };

      const res = gerenciadorSessoes.processarComando(cmd, autor);
      if (res.sucesso && res.evento) {
        transmitirParaTodos({
          tipo: 'novo_evento',
          evento: res.evento,
          estado: res.estado,
          diff: res.diff
        });
      }
    }

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
  const urlPontos = `http://localhost:${PORTA}/pontos.html`;

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
  console.log('  Impressão dos Pontos (QR Codes):');
  console.log(`    URL: ${urlPontos}`);
  console.log('\n----------------- QR CODE PARA OS CELULARES --------------------');
  console.log(qrTerminal);
  console.log('----------------------------------------------------------------');
  console.log(`Servidor ouvindo em todas as interfaces na porta ${PORTA}.\n`);
});
