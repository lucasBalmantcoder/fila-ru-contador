/**
 * server/sessao.js
 * Gerenciamento do ciclo de vida das sessões, persistência síncrona em JSON Lines e validação estrita de comandos.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { derivarEstado, diffEstado } from '../shared/estado.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR_DADOS = path.resolve(__dirname, '..', 'dados');

export class GerenciadorSessoes {
  constructor() {
    this.sessaoAtiva = null;
    this.garantirDiretorioDados();
    this.retomarSessaoAtivaSeExistir();
  }

  garantirDiretorioDados() {
    if (!fs.existsSync(DIR_DADOS)) {
      fs.mkdirSync(DIR_DADOS, { recursive: true });
    }
  }

  /**
   * Procura no diretório dados/ se existe alguma sessão com status "ativa".
   * Se existir, reconstrói o estado em memória a partir do log de eventos.
   */
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
    const eventosPath = path.join(dirPath, 'eventos.jsonl');
    const rejeitadosPath = path.join(dirPath, 'rejeitados.jsonl');
    const linhas = fs.readFileSync(eventosPath, 'utf-8').split('\n').filter(l => l.trim().length > 0);

    const eventos = [];
    const clientEventIds = new Map(); // clientEventId -> evento
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

    const estadoAtual = derivarEstado(eventos);

    this.sessaoAtiva = {
      dirPath,
      eventosPath,
      rejeitadosPath,
      meta,
      config: meta.config,
      seq: maxSeq,
      proximaPessoa: maxPessoa + 1,
      eventos,
      clientEventIds,
      estadoAtual
    };
  }

  /**
   * Inicia uma nova sessão de observação.
   */
  iniciarSessao(config, autor = { id: 'servidor', nome: 'Servidor' }) {
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

    const meta = {
      id: dirNome,
      nome: config.nome || 'Observação RU',
      local: config.local || 'RU Central',
      observacoes: config.observacoes || '',
      duracaoPrevistaMin: config.duracaoPrevistaMin || 60,
      servidores: config.servidores || 1,
      blocoMin: config.blocoMin || 5,
      limiarPausaSeg: config.limiarPausaSeg || 60,
      teste: !!config.teste,
      status: 'ativa',
      inicioMs: agora,
      fimMs: null,
      config
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    const eventoInicio = {
      seq: 1,
      t: agora,
      tipo: 'sessao_iniciada',
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
      seq: 1,
      proximaPessoa: 1,
      eventos: [eventoInicio],
      clientEventIds: new Map([[eventoInicio.clientEventId, eventoInicio]]),
      estadoAtual: derivarEstado([eventoInicio])
    };

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

    const eventoFim = {
      seq: this.sessaoAtiva.seq,
      t: agora,
      tipo: 'sessao_encerrada',
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
    const novo = derivarEstado(this.sessaoAtiva.eventos);
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
   * Processa e valida comandos enviados por clientes WebSocket.
   * Garante idempotência, ordem estrita e validação contra o estado atual.
   */
  processarComando(cmd, autor, offsetRelogio = 0) {
    if (!this.sessaoAtiva) {
      this.registrarRejeicao(cmd, autor, 'SEM_SESSAO', 'Nenhuma sessão ativa no servidor.');
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

    const agoraServidor = Date.now();
    const ehTardio = !!cmd.tardio;
    const ultimoT = this.sessaoAtiva.eventos.length > 0
      ? this.sessaoAtiva.eventos[this.sessaoAtiva.eventos.length - 1].t
      : (agoraServidor - 1);
    const tEvento = agoraServidor > ultimoT ? agoraServidor : (ultimoT + 1);

    const estadoAnterior = this.sessaoAtiva.estadoAtual;
    let eventoCriado = null;

    switch (cmd.acao) {
      case 'chegada': {
        const numPessoa = this.sessaoAtiva.proximaPessoa++;
        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'chegada',
          pessoa: numPessoa,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };
        break;
      }

      case 'atendido': {
        if (!cmd.pessoaEsperada) {
          this.registrarRejeicao(cmd, autor, 'CABECA_MUDOU', 'Comando sem pessoa esperada.');
          return {
            sucesso: false,
            codigo: 'CABECA_MUDOU',
            mensagem: 'Comando de atendimento inválido.',
            clientEventId: cmd.clientEventId
          };
        }

        if (estadoAnterior.fila.length === 0) {
          this.registrarRejeicao(cmd, autor, 'FILA_VAZIA', 'Tentativa de atender com a fila vazia.');
          return {
            sucesso: false,
            codigo: 'FILA_VAZIA',
            mensagem: 'A fila está vazia. Não há ninguém para atender.',
            clientEventId: cmd.clientEventId
          };
        }

        const pessoaNaCatraca = estadoAnterior.fila[0];

        if (pessoaNaCatraca !== cmd.pessoaEsperada) {
          // Identificar se a pessoa esperada já foi atendida, anulada ou se a cabeça mudou
          const p = estadoAnterior.pessoas.find(x => x.pessoa === cmd.pessoaEsperada);
          if (p && p.status === 'atendida') {
            this.registrarRejeicao(cmd, autor, 'JA_ATENDIDO', `Pessoa ${cmd.pessoaEsperada} já foi confirmada anteriormente.`);
            return {
              sucesso: false,
              codigo: 'JA_ATENDIDO',
              mensagem: `Pessoa ${cmd.pessoaEsperada} já foi atendida por outro operador.`,
              clientEventId: cmd.clientEventId
            };
          } else if (p && p.status === 'anulada') {
            this.registrarRejeicao(cmd, autor, 'JA_ANULADO', `Pessoa ${cmd.pessoaEsperada} foi anulada da fila.`);
            return {
              sucesso: false,
              codigo: 'JA_ANULADO',
              mensagem: `Pessoa ${cmd.pessoaEsperada} foi anulada e não está na fila.`,
              clientEventId: cmd.clientEventId
            };
          } else {
            this.registrarRejeicao(cmd, autor, 'CABECA_MUDOU', `Cabeça da fila mudou. Esperado: ${cmd.pessoaEsperada}, Atual: ${pessoaNaCatraca}`);
            return {
              sucesso: false,
              codigo: 'CABECA_MUDOU',
              mensagem: `A fila avançou! A pessoa atual na catraca é Pessoa ${pessoaNaCatraca}.`,
              clientEventId: cmd.clientEventId
            };
          }
        }

        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'atendimento',
          pessoa: pessoaNaCatraca,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };
        break;
      }

      case 'anulacao': {
        const pessoaId = cmd.pessoa;
        if (!pessoaId) {
          this.registrarRejeicao(cmd, autor, 'NAO_ENCONTRADO', 'Identificador de pessoa ausente.');
          return {
            sucesso: false,
            codigo: 'NAO_ENCONTRADO',
            mensagem: 'Pessoa não informada para anulação.',
            clientEventId: cmd.clientEventId
          };
        }

        const naFila = estadoAnterior.fila.includes(pessoaId);
        if (!naFila) {
          const p = estadoAnterior.pessoas.find(x => x.pessoa === pessoaId);
          if (p && p.status === 'atendida') {
            this.registrarRejeicao(cmd, autor, 'JA_ATENDIDO', `Pessoa ${pessoaId} já foi atendida e não pode ser anulada.`);
            return {
              sucesso: false,
              codigo: 'JA_ATENDIDO',
              mensagem: `Pessoa ${pessoaId} já foi atendida. Para cancelar, use Reverter Último Atendimento.`,
              clientEventId: cmd.clientEventId
            };
          } else if (p && p.status === 'anulada') {
            this.registrarRejeicao(cmd, autor, 'JA_ANULADO', `Pessoa ${pessoaId} já foi anulada.`);
            return {
              sucesso: false,
              codigo: 'JA_ANULADO',
              mensagem: `Pessoa ${pessoaId} já foi anulada da fila anteriormente.`,
              clientEventId: cmd.clientEventId
            };
          } else {
            this.registrarRejeicao(cmd, autor, 'NAO_ENCONTRADO', `Pessoa ${pessoaId} não encontrada na fila.`);
            return {
              sucesso: false,
              codigo: 'NAO_ENCONTRADO',
              mensagem: `Pessoa ${pessoaId} não foi encontrada na fila de espera.`,
              clientEventId: cmd.clientEventId
            };
          }
        }

        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'anulacao',
          pessoa: pessoaId,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };
        break;
      }

      case 'reversao': {
        // Encontrar a última pessoa com status "atendida"
        const atendidos = estadoAnterior.pessoas.filter(p => p.status === 'atendida' && p.atendimentoMs !== null);
        if (atendidos.length === 0) {
          this.registrarRejeicao(cmd, autor, 'NADA_A_REVERTER', 'Nenhum atendimento realizado para reverter.');
          return {
            sucesso: false,
            codigo: 'NADA_A_REVERTER',
            mensagem: 'Nenhum atendimento anterior foi encontrado para ser desfeito.',
            clientEventId: cmd.clientEventId
          };
        }

        // Pega a pessoa com o maior atendimentoMs
        atendidos.sort((a, b) => b.atendimentoMs - a.atendimentoMs);
        const ultimaAtendida = atendidos[0].pessoa;

        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'reversao',
          pessoa: ultimaAtendida,
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
          tipo: 'anotacao',
          texto: String(cmd.texto || '').trim().substring(0, 200),
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };
        break;
      }

      default:
        this.registrarRejeicao(cmd, autor, 'COMANDO_DESCONHECIDO', `Ação "${cmd.acao}" desconhecida.`);
        return {
          sucesso: false,
          codigo: 'COMANDO_DESCONHECIDO',
          mensagem: `Ação "${cmd.acao}" não reconhecida pelo servidor.`,
          clientEventId: cmd.clientEventId
        };
    }

    // Persistência síncrona imediata no arquivo de log da sessão
    fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(eventoCriado) + '\n', 'utf-8');
    this.sessaoAtiva.eventos.push(eventoCriado);
    if (eventoCriado.clientEventId) {
      this.sessaoAtiva.clientEventIds.set(eventoCriado.clientEventId, eventoCriado);
    }

    const estadoNovo = derivarEstado(this.sessaoAtiva.eventos);
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

  registrarRejeicao(cmd, autor, codigo, mensagem) {
    if (!this.sessaoAtiva) return;
    const entrada = {
      t: Date.now(),
      codigo,
      mensagem,
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
      teste: this.sessaoAtiva.meta.teste,
      inicioMs: this.sessaoAtiva.meta.inicioMs,
      seq: this.sessaoAtiva.seq,
      status: this.sessaoAtiva.meta.status
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
    this.garantirDiretorioDados();
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
