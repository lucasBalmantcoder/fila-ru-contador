/**
 * server/sessao.js
 * Gerenciamento do ciclo de vida das sessões, persistência síncrona em JSON Lines,
 * suporte a até três filas ativas (Fila 1, Fila 2, Fila 3), encadeamento atômico,
 * desativação de fila durante a sessão, ajuste de fila e registro de conexões/cobertura.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { derivarEstado, diffEstado } from '../shared/estado.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function criarSetFilasDesativadas(iniciais = []) {
  const s = new Set(iniciais);
  s.includes = function(v) { return this.has(Number(v)); };
  return s;
}

const DIR_DADOS_PADRAO = path.resolve(__dirname, '..', 'dados');

export class GerenciadorSessoes {
  constructor(dirDados = null) {
    this.dirDados = dirDados || process.env.DIR_DADOS || DIR_DADOS_PADRAO;
    this.sessaoAtiva = null;
    this.garantirDiretorioDados();
    this.retomarSessaoAtivaSeExistir();
  }

  garantirDiretorioDados() {
    if (!fs.existsSync(this.dirDados)) {
      fs.mkdirSync(this.dirDados, { recursive: true });
    }
  }

  /**
   * Procura no diretório dados/ se existe alguma sessão com status "ativa".
   * Se existir, reconstrói o estado em memória a partir do log de eventos.
   */
  retomarSessaoAtivaSeExistir() {
    try {
      const entradas = fs.readdirSync(this.dirDados, { withFileTypes: true });
      const dirs = entradas.filter(e => e.isDirectory()).map(e => e.name);

      for (const dirNome of dirs) {
        const dirPath = path.join(this.dirDados, dirNome);
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
    const conexoesPath = path.join(dirPath, 'conexoes.jsonl');

    const linhas = fs.readFileSync(eventosPath, 'utf-8').split('\n').filter(l => l.trim().length > 0);

    const eventos = [];
    const clientEventIds = new Map(); // clientEventId -> evento
    let maxSeq = 0;
    const maxPessoaPorFila = { 1: 0, 2: 0, 3: 0 };
    const filasDesativadas = criarSetFilasDesativadas();

    for (const linha of linhas) {
      try {
        const ev = JSON.parse(linha);
        eventos.push(ev);
        if (ev.clientEventId) {
          clientEventIds.set(ev.clientEventId, ev);
        }
        if (ev.seq > maxSeq) maxSeq = ev.seq;

        const fNum = Number(ev.fila || 1);
        if (ev.pessoa && ev.pessoa > (maxPessoaPorFila[fNum] || 0)) {
          maxPessoaPorFila[fNum] = ev.pessoa;
        }

        if (ev.tipo === 'fila_desativada') {
          filasDesativadas.add(Number(ev.fila || 1));
        }
      } catch (e) {
        console.warn('[SESSAO] Linha malformada no log ignorada:', linha);
      }
    }

    const config = meta.config || meta;
    const estadoAtual = derivarEstado(eventos, Infinity, config);

    this.sessaoAtiva = {
      dirPath,
      eventosPath,
      rejeitadosPath,
      conexoesPath,
      meta,
      config,
      filasAtivas: meta.filasAtivas || [1],
      seq: maxSeq,
      proximaPessoaPorFila: {
        1: maxPessoaPorFila[1] + 1,
        2: maxPessoaPorFila[2] + 1,
        3: maxPessoaPorFila[3] + 1
      },
      filasDesativadas,
      eventos,
      clientEventIds,
      estadoAtual
    };
  }

  /**
   * Inicia uma nova sessão de observação.
   */
  iniciarSessao(configOriginal, autor = { id: 'servidor', nome: 'Servidor' }) {
    if (this.sessaoAtiva) {
      throw new Error('Já existe uma sessão ativa. Encerre-a antes de iniciar outra.');
    }

    const agora = Date.now();
    const dataIso = new Date(agora).toISOString().replace(/[:.]/g, '-');
    const dirNome = `sessao_${dataIso}_${Math.random().toString(36).substring(2, 7)}`;
    const dirPath = path.join(this.dirDados, dirNome);
    fs.mkdirSync(dirPath, { recursive: true });

    const eventosPath = path.join(dirPath, 'eventos.jsonl');
    const rejeitadosPath = path.join(dirPath, 'rejeitados.jsonl');
    const conexoesPath = path.join(dirPath, 'conexoes.jsonl');
    const metaPath = path.join(dirPath, 'metadados.json');

    // Normalização das opções de filas
    const filasAtivas = Array.isArray(configOriginal.filasAtivas) && configOriginal.filasAtivas.length > 0
      ? configOriginal.filasAtivas.map(Number)
      : [1];

    const rotulosFilas = {
      1: { entrada: 'CHEGADA', saida: 'PASSOU NA CATRACA' },
      2: { entrada: 'PASSOU NA CATRACA', saida: 'CHEGOU ÀS MESAS' },
      3: { entrada: 'SAIU DAS MESAS', saida: 'PASSOU NA SAÍDA' },
      ...(configOriginal.rotulosFilas || {})
    };

    const servidoresPorFila = {
      1: 1,
      2: 1,
      3: 1,
      ...(configOriginal.servidoresPorFila || {})
    };
    if (configOriginal.servidores) {
      servidoresPorFila[1] = configOriginal.servidores;
    }

    const config = {
      ...configOriginal,
      filasAtivas,
      rotulosFilas,
      servidoresPorFila
    };

    const meta = {
      id: dirNome,
      nome: config.nome || 'Observação RU',
      local: config.local || 'RU Central',
      observacoes: config.observacoes || '',
      duracaoPrevistaMin: config.duracaoPrevistaMin || 60,
      servidores: servidoresPorFila[1] || 1,
      servidoresPorFila,
      rotulosFilas,
      filasAtivas,
      blocoMin: config.blocoMin || 5,
      limiarPausaSeg: config.limiarPausaSeg || 60,
      teste: !!config.teste,
      status: 'ativa',
      inicioMs: agora,
      fimMs: null,
      config
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    fs.writeFileSync(conexoesPath, '', 'utf-8'); // Inicializa conexões vazio

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
      conexoesPath,
      meta,
      config,
      filasAtivas,
      seq: 1,
      proximaPessoaPorFila: { 1: 1, 2: 1, 3: 1 },
      filasDesativadas: criarSetFilasDesativadas(),
      eventos: [eventoInicio],
      clientEventIds: new Map([[eventoInicio.clientEventId, eventoInicio]]),
      estadoAtual: derivarEstado([eventoInicio], agora, config)
    };

    return {
      evento: eventoInicio,
      estado: this.sessaoAtiva.estadoAtual,
      sessao: meta
    };
  }

  /**
   * Compatibilidade: getter para proximaPessoa da Fila 1.
   */
  get proximaPessoa() {
    return this.sessaoAtiva ? this.sessaoAtiva.proximaPessoaPorFila[1] : 1;
  }
  set proximaPessoa(valor) {
    if (this.sessaoAtiva) {
      this.sessaoAtiva.proximaPessoaPorFila[1] = valor;
    }
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
   * Registra eventos de conexão e auditoria de aparelhos em conexoes.jsonl.
   */
  registrarConexao(dispId, dispNome, area = '1') {
    if (!this.sessaoAtiva || !this.sessaoAtiva.conexoesPath) return;
    const entrada = {
      t: Date.now(),
      tipo: 'conexao',
      dispositivoId: dispId,
      dispositivoNome: dispNome,
      area
    };
    try {
      fs.appendFileSync(this.sessaoAtiva.conexoesPath, JSON.stringify(entrada) + '\n', 'utf-8');
    } catch (e) {}
  }

  registrarDesconexao(dispId, dispNome, causa = 'socket_close') {
    if (!this.sessaoAtiva || !this.sessaoAtiva.conexoesPath) return;
    const entrada = {
      t: Date.now(),
      tipo: 'desconexao',
      dispositivoId: dispId,
      dispositivoNome: dispNome,
      causa
    };
    try {
      fs.appendFileSync(this.sessaoAtiva.conexoesPath, JSON.stringify(entrada) + '\n', 'utf-8');
    } catch (e) {}
  }

  registrarMudancaArea(dispId, dispNome, deArea, paraArea, autor = 'dispositivo') {
    if (!this.sessaoAtiva || !this.sessaoAtiva.conexoesPath) return;
    const entrada = {
      t: Date.now(),
      tipo: 'mudanca_area',
      dispositivoId: dispId,
      dispositivoNome: dispNome,
      deArea,
      paraArea,
      autor
    };
    try {
      fs.appendFileSync(this.sessaoAtiva.conexoesPath, JSON.stringify(entrada) + '\n', 'utf-8');
    } catch (e) {}
  }

  obterConexoes(id = null) {
    const caminho = id
      ? path.join(this.dirDados, id, 'conexoes.jsonl')
      : (this.sessaoAtiva?.conexoesPath);

    if (!caminho || !fs.existsSync(caminho)) return [];
    try {
      return fs.readFileSync(caminho, 'utf-8')
        .split('\n')
        .filter(l => l.trim().length > 0)
        .map(l => JSON.parse(l));
    } catch (e) {
      return [];
    }
  }

  /**
   * Processa e valida comandos enviados por clientes WebSocket.
   * Suporta três filas, encadeamento atômico Fila 1 -> Fila 2, ajuste de fila,
   * desativação de fila e validações estritas de permissão e estado.
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

    const filaNum = Number(cmd.fila || 1);
    const estadoAnterior = this.sessaoAtiva.estadoAtual;
    const filasAtivas = this.sessaoAtiva.config.filasAtivas || [1];

    // Trata comando especial: desativar_fila
    if (cmd.acao === 'desativar_fila') {
      if (!filasAtivas.includes(filaNum) || this.sessaoAtiva.filasDesativadas.has(filaNum)) {
        this.registrarRejeicao(cmd, autor, 'FILA_INATIVA', `Fila ${filaNum} não está ativa.`);
        return {
          sucesso: false,
          codigo: 'FILA_INATIVA',
          mensagem: `A Fila ${filaNum} já está inativa ou desativada.`,
          clientEventId: cmd.clientEventId
        };
      }

      this.sessaoAtiva.filasDesativadas.add(filaNum);
      this.sessaoAtiva.seq++;

      const evDesativada = {
        seq: this.sessaoAtiva.seq,
        t: tEvento,
        tipo: 'fila_desativada',
        fila: filaNum,
        dispositivoId: autor.id,
        dispositivoNome: autor.nome,
        clientEventId: cmd.clientEventId
      };

      fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(evDesativada) + '\n', 'utf-8');
      this.sessaoAtiva.eventos.push(evDesativada);
      if (cmd.clientEventId) this.sessaoAtiva.clientEventIds.set(cmd.clientEventId, evDesativada);

      const novoEstado = derivarEstado(this.sessaoAtiva.eventos, Infinity, this.sessaoAtiva.config);
      const diff = diffEstado(estadoAnterior, novoEstado);
      this.sessaoAtiva.estadoAtual = novoEstado;

      return {
        sucesso: true,
        evento: evDesativada,
        estado: novoEstado,
        diff,
        clientEventId: cmd.clientEventId
      };
    }

    // Trata comando especial: atribuicao de área de aparelho
    if (cmd.acao === 'atribuicao') {
      this.sessaoAtiva.seq++;
      const evAtrib = {
        seq: this.sessaoAtiva.seq,
        t: tEvento,
        tipo: 'atribuicao',
        dispositivoId: cmd.dispositivoId || autor.id,
        dispositivoNome: cmd.dispositivoNome || autor.nome,
        area: cmd.area || 'apoio',
        dispositivoIdAutor: autor.id,
        clientEventId: cmd.clientEventId
      };

      fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(evAtrib) + '\n', 'utf-8');
      this.sessaoAtiva.eventos.push(evAtrib);
      if (cmd.clientEventId) this.sessaoAtiva.clientEventIds.set(cmd.clientEventId, evAtrib);

      this.registrarMudancaArea(evAtrib.dispositivoId, evAtrib.dispositivoNome, autor.area, evAtrib.area, autor.nome);

      return {
        sucesso: true,
        evento: evAtrib,
        estado: this.sessaoAtiva.estadoAtual,
        diff: [],
        clientEventId: cmd.clientEventId
      };
    }

    // Validação de Fila Ativa para comandos operacionais (chegada, atendido, anulacao, reversao, ajuste_fila)
    if (cmd.acao !== 'anotacao') {
      if (this.sessaoAtiva.filasDesativadas.has(filaNum)) {
        this.registrarRejeicao(cmd, autor, 'FILA_DESATIVADA', `A Fila ${filaNum} foi desativada durante a sessão.`);
        return {
          sucesso: false,
          codigo: 'FILA_DESATIVADA',
          mensagem: `A Fila ${filaNum} já foi desativada.`,
          clientEventId: cmd.clientEventId
        };
      }

      if (!filasAtivas.includes(filaNum)) {
        this.registrarRejeicao(cmd, autor, 'FILA_INATIVA', `A Fila ${filaNum} não está ativa nesta sessão.`);
        return {
          sucesso: false,
          codigo: 'FILA_INATIVA',
          mensagem: `A Fila ${filaNum} não foi selecionada nesta sessão.`,
          clientEventId: cmd.clientEventId
        };
      }

      // Validação de Modo Apoio: aparelhos em apoio não podem registrar eventos de coleta (chegada, atendido, etc)
      if (['chegada', 'atendido', 'anulacao', 'reversao'].includes(cmd.acao)) {
        if (autor.area === 'apoio' || autor.area === 'sem_area' || autor.papel === 'apoio') {
          this.registrarRejeicao(cmd, autor, 'APARELHO_EM_APOIO', 'Aparelho configurado em modo apoio (somente visualização).');
          return {
            sucesso: false,
            codigo: 'APARELHO_EM_APOIO',
            mensagem: 'Aparelho em modo apoio não possui permissão para registrar eventos na fila.',
            clientEventId: cmd.clientEventId
          };
        }
      }
    }

    const filaAlvoObj = estadoAnterior.filas[filaNum];
    const filaArray = filaAlvoObj ? filaAlvoObj.fila : [];

    let eventoCriado = null;
    let eventoEncadeado = null;

    switch (cmd.acao) {
      case 'chegada': {
        const numPessoa = this.sessaoAtiva.proximaPessoaPorFila[filaNum]++;
        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'chegada',
          fila: filaNum,
          pessoa: numPessoa,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null,
          ajuste: false,
          encadeado: false
        };
        break;
      }

      case 'atendido':
      case 'saida': {
        if (!cmd.pessoaEsperada) {
          this.registrarRejeicao(cmd, autor, 'CABECA_MUDOU', 'Comando sem pessoa esperada.');
          return {
            sucesso: false,
            codigo: 'CABECA_MUDOU',
            mensagem: 'Comando de atendimento inválido.',
            clientEventId: cmd.clientEventId
          };
        }

        if (filaArray.length === 0) {
          this.registrarRejeicao(cmd, autor, 'FILA_VAZIA', `Tentativa de atender com a Fila ${filaNum} vazia.`);
          return {
            sucesso: false,
            codigo: 'FILA_VAZIA',
            mensagem: 'A fila está vazia. Não há ninguém para atender.',
            clientEventId: cmd.clientEventId
          };
        }

        const pessoaNaCabeca = filaArray[0];

        if (pessoaNaCabeca !== cmd.pessoaEsperada) {
          // Identificar se a pessoa esperada já foi atendida, anulada ou se a cabeça mudou
          const p = estadoAnterior.pessoas.find(x => (x.fila || 1) === filaNum && x.pessoa === cmd.pessoaEsperada);
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
            this.registrarRejeicao(cmd, autor, 'CABECA_MUDOU', `Cabeça da fila mudou. Esperado: ${cmd.pessoaEsperada}, Atual: ${pessoaNaCabeca}`);
            return {
              sucesso: false,
              codigo: 'CABECA_MUDOU',
              mensagem: `A fila avançou! A próxima pessoa da fila é Pessoa ${pessoaNaCabeca}.`,
              clientEventId: cmd.clientEventId
            };
          }
        }

        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'atendimento',
          fila: filaNum,
          pessoa: pessoaNaCabeca,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };

        // Encadeamento atômico Fila 1 -> Fila 2
        // Se as Filas 1 e 2 estiverem ativas, passar pela catraca gera chegada imediata na Fila 2
        const fila2Ativa = filasAtivas.includes(2) && !this.sessaoAtiva.filasDesativadas.has(2);
        if (filaNum === 1 && fila2Ativa) {
          this.sessaoAtiva.seq++;
          eventoEncadeado = {
            seq: this.sessaoAtiva.seq,
            t: tEvento,
            tipo: 'chegada',
            fila: 2,
            pessoa: pessoaNaCabeca,
            encadeado: true,
            ajuste: false,
            dispositivoId: autor.id,
            dispositivoNome: autor.nome,
            clientEventId: `${cmd.clientEventId || `cat_${pessoaNaCabeca}`}_chain`,
            tardio: ehTardio,
            tCliente: cmd.tCliente || null
          };
        }
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

        const naFila = filaArray.includes(pessoaId);
        if (!naFila) {
          const p = estadoAnterior.pessoas.find(x => (x.fila || 1) === filaNum && x.pessoa === pessoaId);
          if (p && p.status === 'atendida') {
            this.registrarRejeicao(cmd, autor, 'JA_ATENDIDO', `Pessoa ${pessoaId} já foi atendida e não pode ser anulada.`);
            return {
              sucesso: false,
              codigo: 'JA_ATENDIDO',
              mensagem: `Pessoa ${pessoaId} já foi atendida nesta fila.`,
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
            this.registrarRejeicao(cmd, autor, 'NAO_ENCONTRADO', `Pessoa ${pessoaId} não encontrada na Fila ${filaNum}.`);
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
          fila: filaNum,
          pessoa: pessoaId,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null,
          ajuste: false
        };
        break;
      }

      case 'reversao': {
        // Encontra a última pessoa atendida na fila indicada
        const atendidosFila = estadoAnterior.pessoas.filter(
          p => (p.fila || 1) === filaNum && p.status === 'atendida' && p.atendimentoMs !== null
        );

        if (atendidosFila.length === 0) {
          this.registrarRejeicao(cmd, autor, 'NADA_A_REVERTER', `Nenhum atendimento realizado na Fila ${filaNum} para reverter.`);
          return {
            sucesso: false,
            codigo: 'NADA_A_REVERTER',
            mensagem: 'Nenhum atendimento anterior foi encontrado nesta fila para ser desfeito.',
            clientEventId: cmd.clientEventId
          };
        }

        atendidosFila.sort((a, b) => b.atendimentoMs - a.atendimentoMs);
        const ultimaAtendida = atendidosFila[0].pessoa;

        // Regra de encadeamento Fila 1 -> Fila 2:
        // A reversão da catraca (Fila 1) só é aceita se a pessoa AINDA estiver na Fila 2!
        const fila2Ativa = filasAtivas.includes(2) && !this.sessaoAtiva.filasDesativadas.has(2);
        if (filaNum === 1 && fila2Ativa) {
          const estaNaFila2 = estadoAnterior.filas[2]?.fila.includes(ultimaAtendida);
          if (!estaNaFila2) {
            this.registrarRejeicao(cmd, autor, 'PESSOA_JA_AVANCOU', `Pessoa ${ultimaAtendida} já avançou na Fila 2 e não pode ser revertida.`);
            return {
              sucesso: false,
              codigo: 'PESSOA_JA_AVANCOU',
              mensagem: `A Pessoa ${ultimaAtendida} já concluiu ou foi alterada na Fila 2 e não pode retornar à catraca.`,
              clientEventId: cmd.clientEventId
            };
          }
        }

        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'reversao',
          fila: filaNum,
          pessoa: ultimaAtendida,
          dispositivoId: autor.id,
          dispositivoNome: autor.nome,
          clientEventId: cmd.clientEventId,
          tardio: ehTardio,
          tCliente: cmd.tCliente || null
        };
        break;
      }

      case 'ajuste_fila': {
        const tamAtual = filaArray.length;
        let qtdReal = tamAtual;
        if (cmd.quantidadeReal !== undefined) {
          qtdReal = Math.max(0, parseInt(cmd.quantidadeReal, 10) || 0);
        } else if (cmd.delta !== undefined) {
          qtdReal = Math.max(0, tamAtual + (parseInt(cmd.delta, 10) || 0));
        }

        const deltaCalculado = qtdReal - tamAtual;

        if (qtdReal === tamAtual) {
          return {
            sucesso: true,
            ajuste: true,
            delta: 0,
            tamanhoApos: qtdReal,
            mensagem: `Fila ${filaNum} já possui exatamente ${qtdReal} pessoas.`,
            evento: { tipo: 'ajuste_fila', fila: filaNum, delta: 0, tamanhoApos: qtdReal },
            eventos: [],
            estado: estadoAnterior,
            diff: [],
            clientEventId: cmd.clientEventId
          };
        }

        const eventosAjuste = [];

        if (qtdReal < tamAtual) {
          // Quantidade real é menor: anular pessoas da cabeça da fila
          const diffQtd = tamAtual - qtdReal;
          const pessoasRemover = filaArray.slice(0, diffQtd);

          for (const pId of pessoasRemover) {
            this.sessaoAtiva.seq++;
            const evAnul = {
              seq: this.sessaoAtiva.seq,
              t: tEvento,
              tipo: 'anulacao',
              fila: filaNum,
              pessoa: pId,
              ajuste: true,
              dispositivoId: autor.id,
              dispositivoNome: autor.nome,
              clientEventId: `${cmd.clientEventId || 'ajuste'}_anul_${pId}`,
              tardio: false
            };
            eventosAjuste.push(evAnul);
          }
        } else {
          // Quantidade real é maior: acrescentar pessoas na cauda da fila
          const diffQtd = qtdReal - tamAtual;

          for (let i = 0; i < diffQtd; i++) {
            const numPessoa = this.sessaoAtiva.proximaPessoaPorFila[filaNum]++;
            this.sessaoAtiva.seq++;
            const evCheg = {
              seq: this.sessaoAtiva.seq,
              t: tEvento,
              tipo: 'chegada',
              fila: filaNum,
              pessoa: numPessoa,
              ajuste: true,
              encadeado: false,
              dispositivoId: autor.id,
              dispositivoNome: autor.nome,
              clientEventId: `${cmd.clientEventId || 'ajuste'}_cheg_${numPessoa}`,
              tardio: false
            };
            eventosAjuste.push(evCheg);
          }
        }

        // Persistência síncrona dos eventos de ajuste
        for (const ev of eventosAjuste) {
          fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(ev) + '\n', 'utf-8');
          this.sessaoAtiva.eventos.push(ev);
          if (ev.clientEventId) this.sessaoAtiva.clientEventIds.set(ev.clientEventId, ev);
        }

        const estadoNovo = derivarEstado(this.sessaoAtiva.eventos, Infinity, this.sessaoAtiva.config);
        const diff = diffEstado(estadoAnterior, estadoNovo);
        this.sessaoAtiva.estadoAtual = estadoNovo;

        const evAjusteResumo = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'ajuste_fila',
          fila: filaNum,
          delta: deltaCalculado,
          tamanhoApos: qtdReal,
          clientEventId: cmd.clientEventId
        };

        return {
          sucesso: true,
          ajuste: true,
          delta: deltaCalculado,
          tamanhoApos: qtdReal,
          evento: evAjusteResumo,
          eventos: eventosAjuste,
          estado: estadoNovo,
          diff,
          clientEventId: cmd.clientEventId
        };
      }

      case 'anotacao': {
        this.sessaoAtiva.seq++;
        eventoCriado = {
          seq: this.sessaoAtiva.seq,
          t: tEvento,
          tipo: 'anotacao',
          fila: cmd.fila ? Number(cmd.fila) : null,
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

    if (eventoEncadeado) {
      fs.appendFileSync(this.sessaoAtiva.eventosPath, JSON.stringify(eventoEncadeado) + '\n', 'utf-8');
      this.sessaoAtiva.eventos.push(eventoEncadeado);
      if (eventoEncadeado.clientEventId) {
        this.sessaoAtiva.clientEventIds.set(eventoEncadeado.clientEventId, eventoEncadeado);
      }
    }

    const estadoNovo = derivarEstado(this.sessaoAtiva.eventos, Infinity, this.sessaoAtiva.config);
    const diff = diffEstado(estadoAnterior, estadoNovo);
    this.sessaoAtiva.estadoAtual = estadoNovo;

    return {
      sucesso: true,
      evento: eventoCriado,
      eventoEncadeado,
      eventosGerados: eventoEncadeado ? [eventoCriado, eventoEncadeado] : [eventoCriado],
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
      fila: cmd?.fila || null,
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
      servidoresPorFila: this.sessaoAtiva.meta.servidoresPorFila,
      rotulosFilas: this.sessaoAtiva.meta.rotulosFilas,
      filasAtivas: this.sessaoAtiva.meta.filasAtivas,
      filasDesativadas: Array.from(this.sessaoAtiva.filasDesativadas),
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

  desativarFila(fila, autor = 'Servidor') {
    const autorObj = typeof autor === 'string' ? { id: 'servidor', nome: autor } : autor;
    return this.processarComando({ acao: 'desativar_fila', fila: Number(fila) }, autorObj);
  }

  definirAreaAparelho(dispId, area, autor = { id: 'servidor', nome: 'Servidor' }) {
    return this.processarComando({ acao: 'atribuicao', dispositivoId: dispId, area }, autor);
  }

  listarTodasSessoes() {
    this.garantirDiretorioDados();
    const entradas = fs.readdirSync(this.dirDados, { withFileTypes: true });
    const sessoes = [];

    for (const ent of entradas) {
      if (ent.isDirectory()) {
        const metaPath = path.join(this.dirDados, ent.name, 'metadados.json');
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
    const dirPath = path.join(this.dirDados, id);
    const metaPath = path.join(dirPath, 'metadados.json');
    const eventosPath = path.join(dirPath, 'eventos.jsonl');
    const rejeitadosPath = path.join(dirPath, 'rejeitados.jsonl');
    const conexoesPath = path.join(dirPath, 'conexoes.jsonl');

    if (!fs.existsSync(metaPath) || !fs.existsSync(eventosPath)) {
      return null;
    }

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.config = meta.config || {};
      meta.filasAtivas = meta.filasAtivas || meta.config.filasAtivas || [1];

      const eventos = [];
      const conteudoEv = fs.readFileSync(eventosPath, 'utf-8');
      const linhasEv = conteudoEv.split('\n');
      for (const l of linhasEv) {
        if (!l.trim()) continue;
        try {
          eventos.push(JSON.parse(l));
        } catch (e) {
          console.warn(`[SESSAO] Linha de evento ignorada em ${id}:`, e.message);
        }
      }

      let rejeitados = [];
      if (fs.existsSync(rejeitadosPath)) {
        const linhasRej = fs.readFileSync(rejeitadosPath, 'utf-8').split('\n');
        for (const l of linhasRej) {
          if (!l.trim()) continue;
          try {
            rejeitados.push(JSON.parse(l));
          } catch (e) {}
        }
      }

      let conexoes = [];
      if (fs.existsSync(conexoesPath)) {
        const linhasCon = fs.readFileSync(conexoesPath, 'utf-8').split('\n');
        for (const l of linhasCon) {
          if (!l.trim()) continue;
          try {
            conexoes.push(JSON.parse(l));
          } catch (e) {}
        }
      }

      return {
        meta,
        eventos,
        rejeitados,
        conexoes
      };
    } catch (err) {
      console.error(`[SESSAO] Erro ao carregar dados da sessão ${id}:`, err);
      return null;
    }
  }

  excluirSessao(id) {
    if (this.sessaoAtiva && this.sessaoAtiva.meta.id === id) {
      throw new Error('Não é possível excluir uma sessão que está atualmente em andamento.');
    }
    const dirPath = path.join(this.dirDados, id);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  renomearSessao(id, novoNome) {
    const dirPath = path.join(this.dirDados, id);
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
