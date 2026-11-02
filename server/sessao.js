/**
 * server/sessao.js
 * Gerenciamento do ciclo de vida das sessões, persistência síncrona em JSON Lines,
 * validação estrita de comandos com delegação por ponto, papéis (avaliador/supervisor/observador),
 * tratamento de inversão com janela temporal configurável e compatibilidade com sessões legadas.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { derivarEstado, diffEstado, normalizarConfiguracao, obterZonasPadrao, gerarPontosDeZonas } from '../shared/estado.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR_DADOS = path.resolve(__dirname, '..', 'dados');
const ARQUIVO_PRESETS = path.join(DIR_DADOS, 'presets.json');

export const VERSAO_ESQUEMA = 2;

export class GerenciadorSessoes {
  constructor() {
    this.sessaoAtiva = null;
    this.garantirDiretoriosEPresets();
    this.retomarSessaoAtivaSeExistir();
  }

  garantirDiretoriosEPresets() {
    if (!fs.existsSync(DIR_DADOS)) {
      fs.mkdirSync(DIR_DADOS, { recursive: true });
    }

    if (!fs.existsSync(ARQUIVO_PRESETS)) {
      const presetsPadrao = [
        {
          id: 'completo',
          nome: 'Completo (Fila, Atendimento, Mesas)',
          descricao: 'Percurso integral com fila inicial, atendimento e mesas.',
          zonas: obterZonasPadrao()
        },
        {
          id: 'fila_atendimento',
          nome: 'Fila + Atendimento',
          descricao: 'Coleta na fila externa e no atendimento de pratos; sem mesas.',
          zonas: [
            { id: 'z1', nome: 'Fila inicial', cor: '#dc2626', modo: 'fifo', habilitada: true, capacidade: null, servidores: 1 },
            { id: 'z2', nome: 'Atendimento', cor: '#16a34a', modo: 'fifo', habilitada: true, capacidade: null, servidores: 1 },
            { id: 'z3', nome: 'Mesas', cor: '#ec4899', modo: 'contagem', habilitada: false, capacidade: 120, servidores: null }
          ]
        },
        {
          id: 'somente_fila',
          nome: 'Somente fila',
          descricao: 'Coleta clássica simplificada: chegada e saída na catraca.',
          zonas: [
            { id: 'z1', nome: 'Fila inicial', cor: '#dc2626', modo: 'fifo', habilitada: true, capacidade: null, servidores: 1 },
            { id: 'z2', nome: 'Atendimento', cor: '#16a34a', modo: 'fifo', habilitada: false, capacidade: null, servidores: 1 },
            { id: 'z3', nome: 'Mesas', cor: '#ec4899', modo: 'contagem', habilitada: false, capacidade: 120, servidores: null }
          ]
        }
      ];
      fs.writeFileSync(ARQUIVO_PRESETS, JSON.stringify(presetsPadrao, null, 2), 'utf-8');
    }
  }

  obterPresets() {
    try {
      this.garantirDiretoriosEPresets();
      return JSON.parse(fs.readFileSync(ARQUIVO_PRESETS, 'utf-8'));
    } catch (e) {
      return [];
    }
  }

  salvarPreset(preset) {
    const presets = this.obterPresets();
    const idx = presets.findIndex(p => p.id === preset.id);
    if (idx !== -1) {
      presets[idx] = preset;
    } else {
      presets.push(preset);
    }
    fs.writeFileSync(ARQUIVO_PRESETS, JSON.stringify(presets, null, 2), 'utf-8');
    return presets;
  }

  retomarSessaoAtivaSeExistir() {
    try {
      const entradas = fs.readdirSync(DIR_DADOS, { withFileTypes: true });
      const dirs = entradas.filter(e => e.isDirectory()).map(e => e.name);

      for (const dirNome of dirs) {
        const dirPath = path.join(DIR_DADOS, dirNome);
        const metaPath = path.join(dirPath, 'metadados.json');
        const eventosPath = path.join(dirPath, 'eventos.jsonl');

        if (fs.existsSync(metaPath) && fs.existsSync(eventosPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          if (meta.status === 'ativa') {
            console.log(`[SESSAO] Retomando sessão ativa encontrada em disco: ${meta.nome} (${dirNome})`);
            this.carregarSessaoDeDisco(dirPath, meta);
            break;
          }
        }
      }
    } catch (err) {
      console.error('[SESSAO] Erro ao tentar retomar sessão ativa:', err);
    }
  }

  carregarSessaoDeDisco(dirPath, meta) {
    // Verificação de versão do esquema
    if (meta.versao && meta.versao > VERSAO_ESQUEMA) {
      throw new Error(`Versão de esquema desconhecida (${meta.versao}). O servidor suporta até a versão ${VERSAO_ESQUEMA}.`);
    }

    const eventosPath = path.join(dirPath, 'eventos.jsonl');
    const rejeitadosPath = path.join(dirPath, 'rejeitados.jsonl');
    const linhas = fs.readFileSync(eventosPath, 'utf-8').split('\n').filter(l => l.trim().length > 0);

    const eventos = [];
    const clientEventIds = new Map();
    let maxSeq = 0;
    let maxPessoa = 0;

    for (const linha of linhas) {
      try {
        const ev = JSON.parse(linha);
        eventos.push(ev);
        if (ev.clientEventId) {
          clientEventIds.set(ev.clientEventId, ev);
        }
        if (ev.seq > maxSeq) maxSeq = ev.seq;
        if (ev.pessoa && ev.pessoa > maxPessoa) maxPessoa = ev.pessoa;
      } catch (e) {
        console.warn('[SESSAO] Linha malformada no log ignorada:', linha);
      }
    }

    const config = normalizarConfiguracao(meta.config || {});
    const estadoAtual = derivarEstado(eventos, Infinity, config);

    this.sessaoAtiva = {
      dirPath,
      eventosPath,
      rejeitadosPath,
      meta,
      config,
      versao: meta.versao || 1,
      seq: maxSeq,
      proximaPessoa: maxPessoa + 1,
      eventos,
      clientEventIds,
      estadoAtual,
      atribuicoes: meta.atribuicoes || {},
      coberturaIntervalos: {}, // pontoId -> [{ inicio, fim }]
      pendentesInversao: new Map() // clientEventId -> pendente
    };
  }

  /**
   * Inicia uma nova sessão de observação.
   */
  iniciarSessao(configOriginal = {}, autor = { id: 'servidor', nome: 'Servidor' }) {
    if (this.sessaoAtiva) {
      throw new Error('Já existe uma sessão ativa. Encerre-a antes de iniciar outra.');
    }

    const agora = Date.now();
    const dataIso = new Date(agora).toISOString().replace(/[:.]/g, '-');
    const dirNome = `sessao_${dataIso}_${Math.random().toString(36).substring(2, 7)}`;
    const dirPath = path.join(DIR_DADOS, dirNome);
    fs.mkdirSync(dirPath, { recursive: true });

    const eventosPath = path.join(dirPath, 'eventos.jsonl');
    const rejeitadosPath = path.join(dirPath, 'rejeitados.jsonl');
    const metaPath = path.join(dirPath, 'metadados.json');

    const config = normalizarConfiguracao(configOriginal);
    const atribuicoes = config.atribuicoes || {};

    const meta = {
      versao: VERSAO_ESQUEMA,
      id: dirNome,
      nome: config.nome || 'Observação RU',
      local: config.local || 'RU Central',
      observacoes: config.observacoes || '',
      duracaoPrevistaMin: config.duracaoPrevistaMin || 60,
      servidores: config.servidores || 1,
      blocoMin: config.blocoMin || 5,
      limiarPausaSeg: config.limiarPausaSeg || 60,
      limiarAlertaOciosoSeg: config.limiarAlertaOciosoSeg || 120,
      janelaInversaoS: config.janelaInversaoS || 20,
      autoAtribuirLivres: config.autoAtribuirLivres !== false,
      teste: !!config.teste,
      status: 'ativa',
      inicioMs: agora,
      fimMs: null,
      zonas: config.zonas,
      pontos: config.pontos,
      atribuicoes,
      config
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    const eventoInicio = {
      seq: 1,
      t: agora,
      tipo: 'sessao_iniciada',
      versao: VERSAO_ESQUEMA,
      dispositivoId: autor.id,
      dispositivoNome: autor.nome,
      clientEventId: `init_${agora}`,
      tardio: false,
      config: meta
    };

    fs.appendFileSync(eventosPath, JSON.stringify(eventoInicio) + '\n', 'utf-8');

    this.sessaoAtiva = {
      dirPath,
      eventosPath,
      rejeitadosPath,
      meta,
      config,
      versao: VERSAO_ESQUEMA,
      seq: 1,
      proximaPessoa: 1,
      eventos: [eventoInicio],
      clientEventIds: new Map([[eventoInicio.clientEventId, eventoInicio]]),
      estadoAtual: derivarEstado([eventoInicio], Infinity, config),
      atribuicoes,
      coberturaIntervalos: {},
      pendentesInversao: new Map()
    };

    // Inicializa intervalos de cobertura para pontos atribuídos
    for (const pt of config.pontos) {
      this.sessaoAtiva.coberturaIntervalos[pt.id] = [];
    }

    return {
      evento: eventoInicio,
      estado: this.sessaoAtiva.estadoAtual,
      sessao: meta
    };
  }

  /**
   * Encerra a sessão ativa.
   */
  encerrarSessao(autor = { id: 'servidor', nome: 'Servidor' }) {
    if (!this.sessaoAtiva) {
      throw new Error('Nenhuma sessão ativa para encerrar.');
    }

    const agora = Date.now();
    this.sessaoAtiva.seq++;

    // Descarta eventuais pendentes de inversão expirados
    this.descartarPendentesExpirados(agora);

    const eventoFim = {
      seq: this.sessaoAtiva.seq,
      t: agora,
      tipo: 'sessao_encerrada',
      versao: VERSAO_ESQUEMA,
      dispositivoId: autor.id,
      dispositivoNome: autor.nome,
      clientEventId: `end_${agora}`,
      tardio: false
    };

    fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(eventoFim) + '\n', 'utf-8');
    this.sessaoAtiva.eventos.push(eventoFim);
    this.sessaoAtiva.meta.status = 'encerrada';
    this.sessaoAtiva.meta.fimMs = agora;

    const metaPath = path.join(this.sessaoAtiva.dirPath, 'metadados.json');
    fs.writeFileSync(metaPath, JSON.stringify(this.sessaoAtiva.meta, null, 2), 'utf-8');

    const anterior = this.sessaoAtiva.estadoAtual;
    const novo = derivarEstado(this.sessaoAtiva.eventos, agora, this.sessaoAtiva.config);
    const diff = diffEstado(anterior, novo);
    this.sessaoAtiva.estadoAtual = novo;

    const sessaoFinalizada = this.sessaoAtiva.meta;
    this.sessaoAtiva = null;

    return {
      evento: eventoFim,
      estado: novo,
      diff,
      sessao: sessaoFinalizada
    };
  }

  /**
   * Atualiza as atribuições de aparelhos a pontos de verificação em tempo real.
   */
  atualizarAtribuicoes(novasAtribuicoes = {}, autor = { id: 'servidor', nome: 'Servidor' }) {
    if (!this.sessaoAtiva) {
      throw new Error('Nenhuma sessão ativa para alterar atribuições.');
    }

    const agora = Date.now();
    this.sessaoAtiva.atribuicoes = { ...novasAtribuicoes };
    this.sessaoAtiva.meta.atribuicoes = this.sessaoAtiva.atribuicoes;
    this.sessaoAtiva.config.atribuicoes = this.sessaoAtiva.atribuicoes;

    const metaPath = path.join(this.sessaoAtiva.dirPath, 'metadados.json');
    fs.writeFileSync(metaPath, JSON.stringify(this.sessaoAtiva.meta, null, 2), 'utf-8');

    this.sessaoAtiva.seq++;
    const eventoAtrib = {
      seq: this.sessaoAtiva.seq,
      t: agora,
      tipo: 'atribuicao',
      atribuicoes: this.sessaoAtiva.atribuicoes,
      dispositivoId: autor.id,
      dispositivoNome: autor.nome,
      clientEventId: `atrib_${agora}`,
      tardio: false
    };

    fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(eventoAtrib) + '\n', 'utf-8');
    this.sessaoAtiva.eventos.push(eventoAtrib);

    return {
      atribuicoes: this.sessaoAtiva.atribuicoes,
      evento: eventoAtrib
    };
  }

  /**
   * Atualiza atributos editáveis de uma sessão em andamento (nomes dos pontos, cores, capacidades).
   */
  atualizarConfiguracaoSessao(alteracoes = {}) {
    if (!this.sessaoAtiva) return null;

    if (alteracoes.nomesPontos) {
      this.sessaoAtiva.config.nomesPontos = { ...this.sessaoAtiva.config.nomesPontos, ...alteracoes.nomesPontos };
      this.sessaoAtiva.config.pontos = gerarPontosDeZonas(this.sessaoAtiva.config.zonas, this.sessaoAtiva.config.nomesPontos);
      this.sessaoAtiva.meta.pontos = this.sessaoAtiva.config.pontos;
    }

    if (Array.isArray(alteracoes.zonas)) {
      // Apenas cores e capacidades podem mudar; estrutura/modo é travada
      for (const zAlt of alteracoes.zonas) {
        const zExistente = this.sessaoAtiva.config.zonas.find(z => z.id === zAlt.id);
        if (zExistente) {
          if (zAlt.cor) zExistente.cor = zAlt.cor;
          if (zAlt.capacidade !== undefined) zExistente.capacidade = zAlt.capacidade;
          if (zAlt.nome) zExistente.nome = zAlt.nome;
        }
      }
    }

    const metaPath = path.join(this.sessaoAtiva.dirPath, 'metadados.json');
    fs.writeFileSync(metaPath, JSON.stringify(this.sessaoAtiva.meta, null, 2), 'utf-8');
    this.sessaoAtiva.estadoAtual = derivarEstado(this.sessaoAtiva.eventos, Infinity, this.sessaoAtiva.config);

    return this.sessaoAtiva.meta;
  }

  /**
   * Processa e valida comandos enviados por clientes WebSocket.
   * Suporta chegada, avanço, anulação, reversão e anotação, verificando permissões por ponto e papéis.
   */
  processarComando(cmd, autor, offsetRelogio = 0, onInversaoResolvida = null) {
    if (!this.sessaoAtiva) {
      this.registrarRejeicao(cmd, autor, 'SEM_SESSAO', 'Nenhuma sessão ativa no servidor.', cmd.ponto);
      return {
        sucesso: false,
        codigo: 'SEM_SESSAO',
        mensagem: 'Nenhuma sessão ativa no momento. Inicie uma sessão no painel.',
        clientEventId: cmd.clientEventId
      };
    }

    // 1. Verificação de Idempotência
    if (cmd.clientEventId && this.sessaoAtiva.clientEventIds.has(cmd.clientEventId)) {
      const eventoExistente = this.sessaoAtiva.clientEventIds.get(cmd.clientEventId);
      return {
        sucesso: true,
        idempotente: true,
        evento: eventoExistente,
        estado: this.sessaoAtiva.estadoAtual,
        diff: [],
        clientEventId: cmd.clientEventId
      };
    }

    const config = this.sessaoAtiva.config;
    const papel = autor.papel;

    // 2. Validação de Papel de Observador (somente leitura)
    if (papel === 'observador') {
      this.registrarRejeicao(cmd, autor, 'PONTO_NAO_ATRIBUIDO', 'Aparelhos no papel observador não possuem permissão para registrar eventos.', cmd.ponto);
      return {
        sucesso: false,
        codigo: 'PONTO_NAO_ATRIBUIDO',
        mensagem: 'Aparelho configurado como Observador (somente visualização).',
        clientEventId: cmd.clientEventId
      };
    }

    // Mapeamento de ação legada 'atendido' para 'avanco'
    const acao = cmd.acao === 'atendido' ? 'avanco' : cmd.acao;

    // Identificar pontos e zonas envolvidas
    const pontosDisponiveis = config.pontos || [];
    const zonasHabilitadas = config.zonas.filter(z => z.habilitada !== false);
    const primeiraZonaId = zonasHabilitadas[0]?.id || 'z1';

    let pontoAlvo = null;
    if (cmd.ponto) {
      pontoAlvo = pontosDisponiveis.find(p => p.id === cmd.ponto);
      if (!pontoAlvo) {
        this.registrarRejeicao(cmd, autor, 'PONTO_INEXISTENTE', `Ponto "${cmd.ponto}" inexistente na sessão.`, cmd.ponto);
        return {
          sucesso: false,
          codigo: 'PONTO_INEXISTENTE',
          mensagem: `Ponto de verificação "${cmd.ponto}" não existe na configuração ativa.`,
          clientEventId: cmd.clientEventId
        };
      }
    } else {
      // Compatibilidade legada se cmd.ponto não for enviado
      if (acao === 'chegada') {
        pontoAlvo = pontosDisponiveis[0] || { id: `origem->${primeiraZonaId}`, de: 'origem', para: primeiraZonaId };
      } else if (acao === 'avanco') {
        pontoAlvo = pontosDisponiveis.find(p => p.de === primeiraZonaId) || pontosDisponiveis[1] || pontosDisponiveis[0];
      }
    }

    // 3. Validação de Delegação de Aparelhos
    // Aparelhos com papel explícito 'avaliador' só podem operar nos pontos que lhe foram atribuídos.
    // Se o aparelho tiver atribuições registradas na matriz da sessão, também valida contra essa lista.
    if (autor.id !== 'servidor' && autor.id !== 'simulador' && papel !== 'supervisor' && papel !== 'ambos') {
      const temMatrizAtribuicao = Object.keys(this.sessaoAtiva.atribuicoes).length > 0;
      if (papel === 'avaliador' || temMatrizAtribuicao) {
        const pontosAutorizados = this.sessaoAtiva.atribuicoes[autor.id] || [];
        if (pontoAlvo && !pontosAutorizados.includes(pontoAlvo.id)) {
          this.registrarRejeicao(cmd, autor, 'PONTO_NAO_ATRIBUIDO', `Aparelho "${autor.nome}" não está atribuído ao ponto "${pontoAlvo.nome || pontoAlvo.id}".`, pontoAlvo.id);
          return {
            sucesso: false,
            codigo: 'PONTO_NAO_ATRIBUIDO',
            mensagem: `Ponto "${pontoAlvo.nome || pontoAlvo.id}" não está delegado a este aparelho.`,
            clientEventId: cmd.clientEventId
          };
        }
      }
    }

    const agoraServidor = Date.now();
    const ehTardio = !!cmd.tardio;
    const ultimoT = this.sessaoAtiva.eventos.length > 0
      ? (this.sessaoAtiva.eventos[this.sessaoAtiva.eventos.length - 1].tEfetivo ?? this.sessaoAtiva.eventos[this.sessaoAtiva.eventos.length - 1].t)
      : (agoraServidor - 1);
    const tEvento = agoraServidor > ultimoT ? agoraServidor : (ultimoT + 1);

    const estadoAnterior = this.sessaoAtiva.estadoAtual;
    let eventoCriado = null;

    switch (acao) {
      case 'chegada': {
        const numPessoa = this.sessaoAtiva.proximaPessoa++;
        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tEfetivo: tEvento,
          tipo: 'chegada',
          pessoa: numPessoa,
          ponto: pontoAlvo?.id || `origem->${primeiraZonaId}`,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null,
          inversaoCorrigida: false
        };

        // Verifica se há evento a jusante pendente por inversão na primeira zona
        this.verificarInversaoPendente(primeiraZonaId, eventoCriado, onInversaoResolvida);
        break;
      }

      case 'avanco': {
        const de = pontoAlvo ? pontoAlvo.de : primeiraZonaId;
        const para = pontoAlvo ? pontoAlvo.para : 'saida';
        const zonaOrigem = estadoAnterior.zonas[de];
        const filaOrigem = zonaOrigem ? zonaOrigem.fila : [];
        const modoOrigem = zonaOrigem ? zonaOrigem.modo : 'fifo';

        // REGRA DE INVERSÃO: Zona de origem vazia
        if (filaOrigem.length === 0) {
          const janelaSeg = config.janelaInversaoS || 20;
          const pendente = {
            id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            cmd,
            autor,
            pontoAlvo,
            de,
            para,
            t: tEvento,
            expiraEm: agoraServidor + (janelaSeg * 1000),
            clientEventId: cmd.clientEventId,
            offsetRelogio
          };

          this.sessaoAtiva.pendentesInversao.set(cmd.clientEventId || pendente.id, pendente);

          return {
            sucesso: true,
            pendenteInversao: true,
            codigo: 'ZONA_VAZIA',
            mensagem: `Aguardando registro no ponto anterior (janela de ${janelaSeg}s)...`,
            clientEventId: cmd.clientEventId
          };
        }

        let pessoaQueAvanca = null;
        let identidade = 'confirmada';

        if (modoOrigem === 'fifo') {
          pessoaQueAvanca = filaOrigem[0];
          identidade = 'confirmada';

          if (cmd.pessoaEsperada && cmd.pessoaEsperada !== pessoaQueAvanca) {
            // Analisa motivo da discrepância
            const p = estadoAnterior.pessoas.find(x => x.pessoa === cmd.pessoaEsperada);
            if (p && p.situacao === 'saiu') {
              this.registrarRejeicao(cmd, autor, 'JA_ATENDIDO', `Pessoa ${cmd.pessoaEsperada} já concluiu o percurso.`, pontoAlvo?.id);
              return {
                sucesso: false,
                codigo: 'JA_ATENDIDO',
                mensagem: `Pessoa ${cmd.pessoaEsperada} já foi processada anteriormente.`,
                clientEventId: cmd.clientEventId
              };
            } else if (p && p.situacao === 'anulada') {
              this.registrarRejeicao(cmd, autor, 'JA_ANULADO', `Pessoa ${cmd.pessoaEsperada} foi anulada.`, pontoAlvo?.id);
              return {
                sucesso: false,
                codigo: 'JA_ANULADO',
                mensagem: `Pessoa ${cmd.pessoaEsperada} foi anulada do sistema.`,
                clientEventId: cmd.clientEventId
              };
            } else if (p && p.zonaAtual !== de) {
              this.registrarRejeicao(cmd, autor, 'PESSOA_JA_AVANCOU', `Pessoa ${cmd.pessoaEsperada} já avançou para ${p.zonaAtual}.`, pontoAlvo?.id);
              return {
                sucesso: false,
                codigo: 'PESSOA_JA_AVANCOU',
                mensagem: `Pessoa ${cmd.pessoaEsperada} já avançou da fila.`,
                clientEventId: cmd.clientEventId
              };
            } else {
              this.registrarRejeicao(cmd, autor, 'CABECA_MUDOU', `Cabeça da fila mudou. Esperado: ${cmd.pessoaEsperada}, Atual: ${pessoaQueAvanca}`, pontoAlvo?.id);
              return {
                sucesso: false,
                codigo: 'CABECA_MUDOU',
                mensagem: `A fila avançou! A próxima pessoa é Pessoa ${pessoaQueAvanca}.`,
                clientEventId: cmd.clientEventId
              };
            }
          }
        } else {
          // Modo contagem: avança a pessoa mais antiga presente na zona; identidade estimada
          pessoaQueAvanca = filaOrigem[0];
          identidade = 'estimada';
        }

        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tEfetivo: tEvento,
          tipo: 'avanco',
          pessoa: pessoaQueAvanca,
          de,
          para,
          ponto: pontoAlvo ? pontoAlvo.id : `${de}->${para}`,
          identidade,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null,
          inversaoCorrigida: false
        };

        // Se avançou para outra zona, verifica se há inversões esperando nessa zona de destino
        if (para !== 'saida') {
          this.verificarInversaoPendente(para, eventoCriado, onInversaoResolvida);
        }
        break;
      }

      case 'anulacao': {
        let pId = cmd.pessoa;
        let zonaAlvo = cmd.zona || pontoAlvo?.de;

        if (!pId) {
          // Em zona contagem, o operador pode clicar "Remover 1 pessoa"
          if (zonaAlvo && estadoAnterior.zonas[zonaAlvo]?.fila.length > 0) {
            const fila = estadoAnterior.zonas[zonaAlvo].fila;
            pId = fila[fila.length - 1]; // Remove a última que entrou
          } else {
            this.registrarRejeicao(cmd, autor, 'NAO_ENCONTRADO', 'Identificador de pessoa ausente.', pontoAlvo?.id);
            return {
              sucesso: false,
              codigo: 'NAO_ENCONTRADO',
              mensagem: 'Nenhuma pessoa identificada para anulação.',
              clientEventId: cmd.clientEventId
            };
          }
        }

        // Verifica se a pessoa está em alguma zona
        const pObj = estadoAnterior.pessoas.find(p => p.pessoa === pId);
        if (!pObj || pObj.situacao !== 'em_zona') {
          if (pObj && pObj.situacao === 'saiu') {
            this.registrarRejeicao(cmd, autor, 'JA_ATENDIDO', `Pessoa ${pId} já concluiu o percurso e não pode ser anulada.`, pontoAlvo?.id);
            return {
              sucesso: false,
              codigo: 'JA_ATENDIDO',
              mensagem: `Pessoa ${pId} já saiu do restaurante universitário.`,
              clientEventId: cmd.clientEventId
            };
          } else if (pObj && pObj.situacao === 'anulada') {
            this.registrarRejeicao(cmd, autor, 'JA_ANULADO', `Pessoa ${pId} já foi anulada anteriormente.`, pontoAlvo?.id);
            return {
              sucesso: false,
              codigo: 'JA_ANULADO',
              mensagem: `Pessoa ${pId} já foi anulada anteriormente.`,
              clientEventId: cmd.clientEventId
            };
          } else {
            this.registrarRejeicao(cmd, autor, 'NAO_ENCONTRADO', `Pessoa ${pId} não encontrada em nenhuma zona.`, pontoAlvo?.id);
            return {
              sucesso: false,
              codigo: 'NAO_ENCONTRADO',
              mensagem: `Pessoa ${pId} não foi encontrada no sistema.`,
              clientEventId: cmd.clientEventId
            };
          }
        }

        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tEfetivo: tEvento,
          tipo: 'anulacao',
          pessoa: pId,
          zona: pObj.zonaAtual,
          ponto: pontoAlvo?.id || null,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };
        break;
      }

      case 'reversao': {
        // Encontra o último evento efetivo do ponto informado (ou da sessão se não informado)
        const pontoIdAlvo = pontoAlvo?.id;
        const evs = this.sessaoAtiva.eventos;
        let eventoParaReverter = null;

        for (let i = evs.length - 1; i >= 0; i--) {
          const ev = evs[i];
          if (ev.tipo === 'sessao_iniciada' || ev.tipo === 'sessao_encerrada' || ev.tipo === 'anotacao' || ev.tipo === 'atribuicao' || ev.tipo === 'reversao' || ev.tipo === 'anulacao') {
            continue;
          }

          if (pontoIdAlvo) {
            const evPonto = ev.ponto || (ev.tipo === 'chegada' ? `origem->${primeiraZonaId}` : `${ev.de || primeiraZonaId}->${ev.para || 'saida'}`);
            if (evPonto === pontoIdAlvo) {
              eventoParaReverter = ev;
              break;
            }
          } else {
            // Reversão global do último avanço/chegada
            eventoParaReverter = ev;
            break;
          }
        }

        if (!eventoParaReverter) {
          this.registrarRejeicao(cmd, autor, 'NADA_A_REVERTER', 'Nenhum registro anterior encontrado para reverter neste ponto.', pontoIdAlvo);
          return {
            sucesso: false,
            codigo: 'NADA_A_REVERTER',
            mensagem: 'Nenhum registro encontrado para ser desfeito neste ponto.',
            clientEventId: cmd.clientEventId
          };
        }

        const pessoaRevertida = eventoParaReverter.pessoa;
        const pObj = estadoAnterior.pessoas.find(p => p.pessoa === pessoaRevertida);

        if (!pObj) {
          this.registrarRejeicao(cmd, autor, 'NADA_A_REVERTER', 'Pessoa não encontrada no estado.', pontoIdAlvo);
          return {
            sucesso: false,
            codigo: 'NADA_A_REVERTER',
            mensagem: 'Registro não pode ser desfeito.',
            clientEventId: cmd.clientEventId
          };
        }

        // Valida se a pessoa ainda está na zona de destino daquele evento
        const zonaDestino = eventoParaReverter.para || (eventoParaReverter.tipo === 'chegada' ? primeiraZonaId : 'saida');
        const aindaNaZonaDestino = (zonaDestino === 'saida' && pObj.situacao === 'saiu') ||
                                   (pObj.situacao === 'em_zona' && pObj.zonaAtual === zonaDestino);

        if (!aindaNaZonaDestino) {
          this.registrarRejeicao(cmd, autor, 'PESSOA_JA_AVANCOU', `Pessoa ${pessoaRevertida} já avançou para outra zona e não pode ser revertida.`, pontoIdAlvo);
          return {
            sucesso: false,
            codigo: 'PESSOA_JA_AVANCOU',
            mensagem: `Pessoa ${pessoaRevertida} já avançou para a etapa seguinte. Não é possível desfazer.`,
            clientEventId: cmd.clientEventId
          };
        }

        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tEfetivo: tEvento,
          tipo: 'reversao',
          pessoa: pessoaRevertida,
          de: eventoParaReverter.de || (eventoParaReverter.tipo === 'chegada' ? 'origem' : primeiraZonaId),
          para: zonaDestino,
          ponto: pontoIdAlvo || eventoParaReverter.ponto || null,
          reverteChegada: eventoParaReverter.tipo === 'chegada',
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };
        break;
      }

      case 'anotacao': {
        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tEfetivo: tEvento,
          tipo: 'anotacao',
          texto: String(cmd.texto || '').trim().substring(0, 200),
          ponto: pontoAlvo?.id || null,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };
        break;
      }

      default:
        this.registrarRejeicao(cmd, autor, 'COMANDO_DESCONHECIDO', `Ação "${cmd.acao}" desconhecida.`, pontoAlvo?.id);
        return {
          sucesso: false,
          codigo: 'COMANDO_DESCONHECIDO',
          mensagem: `Ação "${cmd.acao}" não reconhecida.`,
          clientEventId: cmd.clientEventId
        };
    }

    // Persistência síncrona imediata
    fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(eventoCriado) + '\n', 'utf-8');
    this.sessaoAtiva.eventos.push(eventoCriado);
    if (eventoCriado.clientEventId) {
      this.sessaoAtiva.clientEventIds.set(eventoCriado.clientEventId, eventoCriado);
    }

    const estadoNovo = derivarEstado(this.sessaoAtiva.eventos, Infinity, this.sessaoAtiva.config);
    const diff = diffEstado(estadoAnterior, estadoNovo);
    this.sessaoAtiva.estadoAtual = estadoNovo;

    return {
      sucesso: true,
      evento: eventoCriado,
      estado: estadoNovo,
      diff,
      clientEventId: cmd.clientEventId
    };
  }

  /**
   * Verifica se a chegada ou avanço recém-registrado resolve uma pendência de inversão
   * na zona informada.
   */
  verificarInversaoPendente(zonaId, eventoMontante, callbackResolvida = null) {
    if (!this.sessaoAtiva || this.sessaoAtiva.pendentesInversao.size === 0) return;

    for (const [pendId, pend] of this.sessaoAtiva.pendentesInversao.entries()) {
      if (pend.de === zonaId) {
        this.sessaoAtiva.pendentesInversao.delete(pendId);

        // Corrige horários: o evento a montante assume o menor entre os dois
        const tMontanteOriginal = eventoMontante.t;
        const tJusanteOriginal = pend.t;
        const tEfetivo = Math.min(tMontanteOriginal, tJusanteOriginal);

        eventoMontante.tEfetivo = tEfetivo;
        eventoMontante.inversaoCorrigida = true;

        this.sessaoAtiva.seq++;
        const eventoJusante = {
          seq: this.sessaoAtiva.seq,
          t: tJusanteOriginal,
          tEfetivo: Math.max(tEfetivo, tJusanteOriginal),
          tipo: 'avanco',
          pessoa: eventoMontante.pessoa,
          de: pend.de,
          para: pend.para,
          ponto: pend.pontoAlvo ? pend.pontoAlvo.id : `${pend.de}->${pend.para}`,
          identidade: pend.pontoAlvo?.modoOrigem === 'contagem' ? 'estimada' : 'confirmada',
          dispositivoId: pend.autor.id,
          dispositivoNome: pend.autor.nome,
          clientEventId: pend.clientEventId,
          tardio: !!pend.cmd.tardio,
          tCliente: pend.cmd.tCliente || null,
          inversaoCorrigida: true
        };

        // Grava o evento jusante no log
        fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(eventoJusante) + '\n', 'utf-8');
        this.sessaoAtiva.eventos.push(eventoJusante);
        if (eventoJusante.clientEventId) {
          this.sessaoAtiva.clientEventIds.set(eventoJusante.clientEventId, eventoJusante);
        }

        // Re-deriva o estado com os dois eventos
        this.sessaoAtiva.estadoAtual = derivarEstado(this.sessaoAtiva.eventos, Infinity, this.sessaoAtiva.config);

        if (typeof callbackResolvida === 'function') {
          callbackResolvida(eventoJusante, this.sessaoAtiva.estadoAtual);
        }
        break;
      }
    }
  }

  /**
   * Descarta eventos pendentes de inversão cujo prazo de janela expirou.
   */
  descartarPendentesExpirados(agora = Date.now(), onExpirado = null) {
    if (!this.sessaoAtiva) return [];
    const expirados = [];

    for (const [id, pend] of this.sessaoAtiva.pendentesInversao.entries()) {
      if (agora >= pend.expiraEm) {
        this.sessaoAtiva.pendentesInversao.delete(id);
        expirados.push(pend);

        this.registrarRejeicao(
          pend.cmd,
          pend.autor,
          'EXPIRADO',
          `Evento de avanço expirou após ${this.sessaoAtiva.config.janelaInversaoS}s sem registro a montante.`,
          pend.pontoAlvo?.id
        );

        if (typeof onExpirado === 'function') {
          onExpirado(pend);
        }
      }
    }

    return expirados;
  }

  registrarRejeicao(cmd, autor, codigo, mensagem, pontoId = null) {
    if (!this.sessaoAtiva) return;
    const entrada = {
      t: Date.now(),
      codigo,
      mensagem,
      ponto: pontoId || cmd.ponto || null,
      comando: cmd,
      dispositivoId: autor.id,
      dispositivoNome: autor.nome
    };
    try {
      fs.appendFileSync(this.sessaoAtiva.rejeitadosPath, JSON.stringify(entrada) + '\n', 'utf-8');
    } catch (e) {
      console.error('[SESSAO] Erro ao gravar log de rejeitados:', e);
    }
  }

  obterResumoSessaoAtiva() {
    if (!this.sessaoAtiva) return null;
    return {
      id: this.sessaoAtiva.meta.id,
      nome: this.sessaoAtiva.meta.nome,
      local: this.sessaoAtiva.meta.local,
      observacoes: this.sessaoAtiva.meta.observacoes,
      duracaoPrevistaMin: this.sessaoAtiva.meta.duracaoPrevistaMin,
      servidores: this.sessaoAtiva.meta.servidores,
      blocoMin: this.sessaoAtiva.meta.blocoMin,
      limiarPausaSeg: this.sessaoAtiva.meta.limiarPausaSeg,
      limiarAlertaOciosoSeg: this.sessaoAtiva.meta.limiarAlertaOciosoSeg,
      janelaInversaoS: this.sessaoAtiva.meta.janelaInversaoS,
      autoAtribuirLivres: this.sessaoAtiva.meta.autoAtribuirLivres,
      teste: this.sessaoAtiva.meta.teste,
      inicioMs: this.sessaoAtiva.meta.inicioMs,
      seq: this.sessaoAtiva.seq,
      status: this.sessaoAtiva.meta.status,
      zonas: this.sessaoAtiva.config.zonas,
      pontos: this.sessaoAtiva.config.pontos,
      atribuicoes: this.sessaoAtiva.atribuicoes
    };
  }

  obterUltimosRejeitados(limite = 20) {
    if (!this.sessaoAtiva || !fs.existsSync(this.sessaoAtiva.rejeitadosPath)) return [];
    try {
      const linhas = fs.readFileSync(this.sessaoAtiva.rejeitadosPath, 'utf-8')
        .split('\n')
        .filter(l => l.trim().length > 0);
      return linhas.slice(-limite).map(l => JSON.parse(l)).reverse();
    } catch (e) {
      return [];
    }
  }

  listarTodasSessoes() {
    this.garantirDiretoriosEPresets();
    const entradas = fs.readdirSync(DIR_DADOS, { withFileTypes: true });
    const sessoes = [];

    for (const ent of entradas) {
      if (ent.isDirectory()) {
        const metaPath = path.join(DIR_DADOS, ent.name, 'metadados.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            sessoes.push(meta);
          } catch (e) {}
        }
      }
    }

    return sessoes.sort((a, b) => (b.inicioMs || 0) - (a.inicioMs || 0));
  }

  obterSessaoCompleta(id) {
    const dirPath = path.join(DIR_DADOS, id);
    const metaPath = path.join(dirPath, 'metadados.json');
    const eventosPath = path.join(dirPath, 'eventos.jsonl');
    const rejeitadosPath = path.join(dirPath, 'rejeitados.jsonl');

    if (!fs.existsSync(metaPath) || !fs.existsSync(eventosPath)) {
      return null;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    // Rejeita versão desconhecida
    if (meta.versao && meta.versao > VERSAO_ESQUEMA) {
      throw new Error(`Sessão gravada com versão de esquema superior (${meta.versao}) não suportada.`);
    }

    const eventos = fs.readFileSync(eventosPath, 'utf-8')
      .split('\n')
      .filter(l => l.trim().length > 0)
      .map(l => JSON.parse(l));

    let rejeitados = [];
    if (fs.existsSync(rejeitadosPath)) {
      rejeitados = fs.readFileSync(rejeitadosPath, 'utf-8')
        .split('\n')
        .filter(l => l.trim().length > 0)
        .map(l => JSON.parse(l));
    }

    return {
      meta,
      eventos,
      rejeitados
    };
  }

  excluirSessao(id) {
    if (this.sessaoAtiva && this.sessaoAtiva.meta.id === id) {
      throw new Error('Não é possível excluir uma sessão que está atualmente em andamento.');
    }
    const dirPath = path.join(DIR_DADOS, id);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  renomearSessao(id, novoNome) {
    const dirPath = path.join(DIR_DADOS, id);
    const metaPath = path.join(dirPath, 'metadados.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.nome = novoNome;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      if (this.sessaoAtiva && this.sessaoAtiva.meta.id === id) {
        this.sessaoAtiva.meta.nome = novoNome;
      }
      return meta;
    }
    return null;
  }
}
