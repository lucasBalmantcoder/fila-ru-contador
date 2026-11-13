/**
 * shared/estado.js
 * Funções puras para derivação e comparação de estado das filas do RU.
 * Suporta até três filas simultâneas (Fila 1: Entrada->Catraca, Fila 2: Catraca->Mesas, Fila 3: Mesas->Saída).
 * Compatível tanto com Node.js (ES module) quanto com navegadores (ES module).
 */

/**
 * Verifica se uma fila possui entrada encadeada da fila anterior.
 * Depende estritamente de: fila anterior ativa E fila atual ativa.
 * @param {number} filaNum - Fila a verificar (2 ou 3).
 * @param {Array<number>} filasAtivas - Lista de filas ativas da sessão.
 * @param {Set<number>|Array<number>|null} [filasDesativadas=[]] - Filas desativadas.
 * @returns {boolean}
 */
export function filaTemEntradaEncadeada(filaNum, filasAtivas = [1], filasDesativadas = []) {
  const fNum = Number(filaNum);
  if (fNum <= 1 || fNum > 3) return false;
  const fAnt = fNum - 1;

  const ativasList = Array.isArray(filasAtivas) ? filasAtivas.map(Number) : [1];
  const desativadasSet = filasDesativadas instanceof Set
    ? filasDesativadas
    : new Set(Array.isArray(filasDesativadas) ? filasDesativadas.map(Number) : []);

  const antAtiva = ativasList.includes(fAnt) && !desativadasSet.has(fAnt);
  const atualAtiva = ativasList.includes(fNum) && !desativadasSet.has(fNum);
  return antAtiva && atualAtiva;
}

/**
 * Verifica se a saída de uma fila gera automaticamente entrada na fila seguinte.
 * Depende estritamente de: fila atual ativa E fila seguinte ativa.
 * @param {number} filaNum - Fila de saída (1 ou 2).
 * @param {Array<number>} filasAtivas - Lista de filas ativas da sessão.
 * @param {Set<number>|Array<number>|null} [filasDesativadas=[]] - Filas desativadas.
 * @returns {boolean}
 */
export function filaGeraSaidaEncadeada(filaNum, filasAtivas = [1], filasDesativadas = []) {
  const fNum = Number(filaNum);
  if (fNum < 1 || fNum >= 3) return false;
  return filaTemEntradaEncadeada(fNum + 1, filasAtivas, filasDesativadas);
}

/**
 * Deriva o estado completo de todas as filas ativas a partir do log de eventos até o instante t.
 * @param {Array<Object>} eventos - Lista ordenada de eventos da sessão.
 * @param {number} [t=Infinity] - Instante limite (epoch ms). Padrão: Infinity.
 * @param {Object} [configParam={}] - Configuração da sessão (opcional).
 * @returns {Object} Estado derivado das filas.
 */
export function derivarEstado(eventos = [], t = Infinity, configParam = {}) {
  // 1. Identificar configuração de filas ativas da sessão
  const evInicio = eventos.find(e => e.tipo === 'sessao_iniciada');
  const cfg = {
    filasAtivas: [1],
    ...configParam,
    ...(evInicio?.config?.config || evInicio?.config || {})
  };

  // Garante que filasAtivas seja array numérico (ex: [1], [1, 2], [1, 2, 3])
  const filasAtivasConfig = Array.isArray(cfg.filasAtivas) && cfg.filasAtivas.length > 0
    ? cfg.filasAtivas.map(Number)
    : [1];

  // Identificar filas desativadas até t
  const filasDesativadasMap = new Map(); // fila -> desativadaEm (ms)
  for (const ev of eventos) {
    if (ev.t <= t && ev.tipo === 'fila_desativada') {
      const fNum = Number(ev.fila || 1);
      filasDesativadasMap.set(fNum, ev.t);
    }
  }

  // Estrutura de cada fila
  const filas = {
    1: criarEstruturaFila(1, filasAtivasConfig.includes(1), filasDesativadasMap.get(1) || null),
    2: criarEstruturaFila(2, filasAtivasConfig.includes(2), filasDesativadasMap.get(2) || null),
    3: criarEstruturaFila(3, filasAtivasConfig.includes(3), filasDesativadasMap.get(3) || null)
  };

  const pessoas = new Map(); // chave: `${fila}_${pId}` -> objeto pessoa
  const mapaEntradaMesas = new Map(); // pId -> tEntrada
  const mapaSaidaMesas = new Map();   // pId -> tSaida

  // Filtrar eventos até o instante t
  const eventosValidos = eventos.filter(ev => ev.t <= t);

  for (const ev of eventosValidos) {
    const fNum = Number(ev.fila || 1);
    const filaObj = filas[fNum];

    // Ignora eventos de auditoria pura no estado da fila
    if (ev.tipo === 'atribuicao' || ev.tipo === 'sessao_iniciada' || ev.tipo === 'sessao_encerrada' || ev.tipo === 'anotacao' || ev.tipo === 'fila_desativada') {
      continue;
    }

    if (!filaObj) continue;

    // Se a fila foi desativada antes do evento, ignora comandos posteriores
    if (filaObj.desativadaEm !== null && ev.t > filaObj.desativadaEm) {
      continue;
    }

    const pId = ev.pessoa;
    const chavePessoa = `${fNum}_${pId}`;

    if (ev.tipo === 'chegada') {
      filaObj.contadores.chegadas++;
      if (!ev.encadeado) {
        filaObj.totalEventos++;
      }

      const dispChegadaNome = (ev.encadeado || ev.origem === 'encadeada')
        ? (ev.dispositivoNome ? `${ev.dispositivoNome} (encadeada)` : 'encadeada')
        : (ev.dispositivoNome || 'Desconhecido');

      pessoas.set(chavePessoa, {
        pessoa: pId,
        fila: fNum,
        status: 'esperando',
        chegadaMs: ev.t,
        atendimentoMs: null,
        anulacaoMs: null,
        dispositivoChegada: dispChegadaNome,
        dispositivoAtendimento: null,
        esperaMs: null,
        intervaloAtendimentoMs: null,
        ajuste: !!ev.ajuste,
        encadeado: !!ev.encadeado,
        origem: ev.origem || (ev.encadeado ? 'encadeada' : 'manual')
      });

      filaObj.fila.push(pId);
    } else if (ev.tipo === 'atendimento') {
      filaObj.totalEventos++;
      const idx = filaObj.fila.indexOf(pId);
      if (idx !== -1) {
        filaObj.fila.splice(idx, 1);
      }
      const p = pessoas.get(chavePessoa);
      if (p) {
        p.status = 'atendida';
        p.atendimentoMs = ev.t;
        p.dispositivoAtendimento = ev.dispositivoNome || 'Desconhecido';
        p.esperaMs = Math.max(0, ev.t - p.chegadaMs);

        if (filaObj.ultimoAtendimentoMs !== null) {
          const deltaMs = Math.max(0, ev.t - filaObj.ultimoAtendimentoMs);
          p.intervaloAtendimentoMs = deltaMs;
          filaObj.ultimoIntervaloSeg = deltaMs / 1000;
        } else {
          p.intervaloAtendimentoMs = null;
          filaObj.ultimoIntervaloSeg = null;
        }

        filaObj.ultimoAtendimentoMs = ev.t;
        filaObj.historicoAtendimentos.push({ pessoa: pId, t: ev.t });
        filaObj.contadores.atendidas++;

        // Rastreamento de ocupação das mesas:
        // Entrada nas mesas ocorre ao sair da Fila 2 (ou Fila 1 se F2 inativa)
        if (fNum === 2 || (fNum === 1 && !filasAtivasConfig.includes(2))) {
          mapaEntradaMesas.set(pId, ev.t);
        } else if (fNum === 3) {
          // Saída das mesas / saída do restaurante
          mapaSaidaMesas.set(pId, ev.t);
        }
      }
    } else if (ev.tipo === 'anulacao') {
      filaObj.totalEventos++;
      const idx = filaObj.fila.indexOf(pId);
      if (idx !== -1) {
        filaObj.fila.splice(idx, 1);
      }
      const p = pessoas.get(chavePessoa);
      if (p) {
        p.status = 'anulada';
        p.anulacaoMs = ev.t;
        if (ev.ajuste) p.ajuste = true;
        filaObj.contadores.anuladas++;
      }
      if (fNum === 2 || (fNum === 1 && !filasAtivasConfig.includes(2))) {
        mapaEntradaMesas.delete(pId);
      } else if (fNum === 3) {
        mapaSaidaMesas.set(pId, ev.t);
      }
    } else if (ev.tipo === 'reversao') {
      filaObj.totalEventos++;
      const p = pessoas.get(chavePessoa);
      if (p) {
        p.status = 'esperando';
        p.atendimentoMs = null;
        p.dispositivoAtendimento = null;
        p.esperaMs = null;
        p.intervaloAtendimentoMs = null;

        if (fNum === 2 || (fNum === 1 && !filasAtivasConfig.includes(2))) {
          mapaEntradaMesas.delete(pId);
        } else if (fNum === 3) {
          mapaSaidaMesas.delete(pId);
        }

        // Reinsere a pessoa no início da fila
        if (!filaObj.fila.includes(pId)) {
          filaObj.fila.unshift(pId);
        }

        // Remove do histórico de atendimentos da fila
        const idxHist = filaObj.historicoAtendimentos.map(h => h.pessoa).lastIndexOf(pId);
        if (idxHist !== -1) {
          filaObj.historicoAtendimentos.splice(idxHist, 1);
        }

        // Recalcula o último atendimento da fila
        if (filaObj.historicoAtendimentos.length > 0) {
          filaObj.ultimoAtendimentoMs = filaObj.historicoAtendimentos[filaObj.historicoAtendimentos.length - 1].t;
          if (filaObj.historicoAtendimentos.length >= 2) {
            const penultimo = filaObj.historicoAtendimentos[filaObj.historicoAtendimentos.length - 2].t;
            filaObj.ultimoIntervaloSeg = Math.max(0, filaObj.ultimoAtendimentoMs - penultimo) / 1000;
          } else {
            filaObj.ultimoIntervaloSeg = null;
          }
        } else {
          filaObj.ultimoAtendimentoMs = null;
          filaObj.ultimoIntervaloSeg = null;
        }

        filaObj.contadores.atendidas = Math.max(0, filaObj.contadores.atendidas - 1);
        filaObj.contadores.revertidas++;

        // Encadeamento (Fila 1 -> Fila 2 e Fila 2 -> Fila 3):
        // Reverter o atendimento na fila anterior desfaz a entrada na fila seguinte
        const proxFila = fNum + 1;
        if (filas[proxFila] && filas[proxFila].ativa) {
          const idxProx = filas[proxFila].fila.indexOf(pId);
          if (idxProx !== -1) {
            filas[proxFila].fila.splice(idxProx, 1);
            filas[proxFila].contadores.chegadas = Math.max(0, filas[proxFila].contadores.chegadas - 1);
            pessoas.delete(`${proxFila}_${pId}`);
          }
        }
      }
    }
  }

  // 2. Finalizar estados derivados por fila
  const tReferencia = (t !== Infinity && t !== null && !isNaN(t))
    ? t
    : (eventosValidos.length > 0 ? eventosValidos[eventosValidos.length - 1].t : Date.now());

  for (const fNum of [1, 2, 3]) {
    const fo = filas[fNum];
    fo.contadores.naFila = fo.fila.length;
    fo.primeiraDaFila = fo.fila.length > 0 ? fo.fila[0] : null;

    // Define status derivado na cabeça de cada fila
    const statusCabeca = fNum === 1 ? 'na_catraca' : (fNum === 2 ? 'nas_mesas' : 'na_saida');
    for (let i = 0; i < fo.fila.length; i++) {
      const pId = fo.fila[i];
      const p = pessoas.get(`${fNum}_${pId}`);
      if (p) {
        p.status = (i === 0) ? statusCabeca : 'esperando';
      }
    }

    // Tempo de espera da pessoa que está atualmente na cabeça da fila
    fo.esperaNaCabecaMs = 0;
    if (fo.primeiraDaFila !== null) {
      const pCabeca = pessoas.get(`${fNum}_${fo.primeiraDaFila}`);
      if (pCabeca) {
        fo.esperaNaCabecaMs = Math.max(0, tReferencia - pCabeca.chegadaMs);
      }
    }

    // Vazão recente dos últimos 5 minutos
    const cincoMinAtras = tReferencia - (5 * 60 * 1000);
    const atendimentosUltimos5Min = fo.historicoAtendimentos.filter(h => h.t >= cincoMinAtras && h.t <= tReferencia).length;
    fo.vazaoRecente = atendimentosUltimos5Min / 5;

    // Fila ativa sem nenhum evento é "semDados"
    fo.semDados = fo.ativa && fo.totalEventos === 0;

    // Propriedades diretas de conveniência para contadores
    fo.atendidas = fo.contadores.atendidas;
    fo.chegadas = fo.contadores.chegadas;
    fo.anuladas = fo.contadores.anuladas;
  }

  // 3. Estatística de preenchimento das Mesas (4 fileiras de 9 mesas, 6 cadeiras cada = 216 cadeiras)
  const CAPACIDADE_CADEIRAS = 216;
  const TOTAL_MESAS = 36;
  const FILEIRAS = 4;
  const MESAS_POR_FILEIRA = 9;
  const CADEIRAS_POR_MESA = 6;

  const temFila3Ativa = filasAtivasConfig.includes(3) && !filasDesativadasMap.has(3);
  const tempoRefeicaoMs = (cfg.tempoRefeicaoMin || 20) * 60 * 1000;
  const pessoasSentadas = [];

  for (const [pId, tEntrada] of mapaEntradaMesas.entries()) {
    if (tEntrada <= tReferencia) {
      const tSaida = mapaSaidaMesas.get(pId);
      if (tSaida !== undefined) {
        if (tSaida > tReferencia) {
          pessoasSentadas.push(pId);
        }
      } else {
        // Se Fila 3 estiver ativa, a liberação da cadeira depende da saída na Fila 3
        if (temFila3Ativa) {
          pessoasSentadas.push(pId);
        } else {
          // Se Fila 3 não for monitorada, a cadeira é liberada após o tempo estimado de permanência
          if (tReferencia - tEntrada < tempoRefeicaoMs) {
            pessoasSentadas.push(pId);
          }
        }
      }
    }
  }

  const cadeirasOcupadas = Math.min(CAPACIDADE_CADEIRAS, pessoasSentadas.length);
  const cadeirasLivres = Math.max(0, CAPACIDADE_CADEIRAS - cadeirasOcupadas);
  const taxaOcupacaoPerc = Math.round((cadeirasOcupadas / CAPACIDADE_CADEIRAS) * 100);
  const mesasOcupadasEstimadas = Math.min(TOTAL_MESAS, Math.ceil(cadeirasOcupadas / CADEIRAS_POR_MESA));

  let statusOcupacao = 'Tranquilo';
  if (taxaOcupacaoPerc >= 90) {
    statusOcupacao = 'Lotado';
  } else if (taxaOcupacaoPerc >= 75) {
    statusOcupacao = 'Quase Cheio';
  } else if (taxaOcupacaoPerc >= 50) {
    statusOcupacao = 'Moderado';
  }

  const ocupacaoMesas = {
    capacidadeTotal: CAPACIDADE_CADEIRAS,
    fileiras: FILEIRAS,
    mesasPorFileira: MESAS_POR_FILEIRA,
    totalMesas: TOTAL_MESAS,
    cadeirasPorMesa: CADEIRAS_POR_MESA,
    ocupadas: cadeirasOcupadas,
    livres: cadeirasLivres,
    percentual: taxaOcupacaoPerc,
    mesasOcupadas: mesasOcupadasEstimadas,
    status: statusOcupacao,
    pessoasSentadas
  };

  // Compatibilidade com raiz (Fila 1) para testes e interfaces legadas
  const f1 = filas[1];
  const pessoasArray = Array.from(pessoas.values());
  const filasDesativadasArray = Array.from(filasDesativadasMap.keys());

  return {
    filasAtivas: filasAtivasConfig,
    filasDesativadas: filasDesativadasArray,
    filas,
    pessoas: pessoasArray,
    ocupacaoMesas,
    // Propriedades raiz para compatibilidade estrita com Fila 1:
    fila: f1.fila,
    primeiraDaFila: f1.primeiraDaFila,
    esperaNaCatracaMs: f1.esperaNaCabecaMs,
    contadores: f1.contadores,
    vazaoRecente: f1.vazaoRecente,
    ultimoIntervaloSeg: f1.ultimoIntervaloSeg
  };
}

function criarEstruturaFila(id, ativa, desativadaEm) {
  return {
    id,
    ativa: !!ativa && desativadaEm === null,
    desativadaEm,
    semDados: false,
    totalEventos: 0,
    fila: [],
    primeiraDaFila: null,
    esperaNaCabecaMs: 0,
    atendidas: 0,
    chegadas: 0,
    anuladas: 0,
    contadores: {
      chegadas: 0,
      atendidas: 0,
      anuladas: 0,
      revertidas: 0,
      naFila: 0
    },
    vazaoRecente: 0,
    ultimoAtendimentoMs: null,
    ultimoIntervaloSeg: null,
    historicoAtendimentos: []
  };
}

/**
 * Calcula a diferença operacional de animação entre dois estados consecutivos.
 * @param {Object|null} anterior - Estado anterior retornado por derivarEstado.
 * @param {Object} novo - Novo estado retornado por derivarEstado.
 * @returns {Array<Object>} Lista de operações de animação: entrar, confirmar, avancar, anular, reverter, transferir, desativar_fila.
 */
export function diffEstado(anterior, novo) {
  if (!novo) return [];
  if (!anterior) {
    // Se não há estado anterior, gera as entradas para as filas ativas atuais
    const ops = [];
    for (const fNum of [1, 2, 3]) {
      const fila = novo.filas?.[fNum]?.fila || (fNum === 1 ? novo.fila : []);
      for (const pessoa of fila) {
        ops.push({ op: 'entrar', fila: fNum, pessoa });
      }
    }
    return ops;
  }

  const operacoes = [];

  for (const fNum of [1, 2, 3]) {
    const filaAntiga = anterior.filas?.[fNum]?.fila || (fNum === 1 ? anterior.fila : []) || [];
    const filaNova = novo.filas?.[fNum]?.fila || (fNum === 1 ? novo.fila : []) || [];

    const pessoasAntigasFila = new Set(
      (anterior.pessoas || []).filter(p => (p.fila || 1) === fNum).map(p => p.pessoa)
    );

    // 1. Checagem de desativação de fila
    const ativaAntiga = anterior.filas?.[fNum]?.ativa !== false;
    const ativaNova = novo.filas?.[fNum]?.ativa !== false;
    if (ativaAntiga && !ativaNova) {
      operacoes.push({ op: 'desativar_fila', fila: fNum });
    }

    // 2. Checagem de novas chegadas
    const novasPessoas = (novo.pessoas || []).filter(
      p => (p.fila || 1) === fNum && !pessoasAntigasFila.has(p.pessoa)
    );
    for (const p of novasPessoas) {
      if (p.encadeado && fNum > 1) {
        // Encadeamento de filas: F1 -> F2 (deFila: 1) ou F2 -> F3 (deFila: 2)
        const fOrigem = fNum - 1;
        operacoes.push({ op: 'transferir', pessoa: p.pessoa, fila: fOrigem, deFila: fOrigem, paraFila: fNum });
        operacoes.push({ op: 'entrar', fila: fNum, pessoa: p.pessoa, ajuste: !!p.ajuste });
      } else {
        operacoes.push({ op: 'entrar', fila: fNum, pessoa: p.pessoa, ajuste: !!p.ajuste });
      }
    }

    // 3. Checagem de confirmação de atendimento
    const cabecaAntiga = filaAntiga[0];
    if (cabecaAntiga !== undefined) {
      const pNovo = (novo.pessoas || []).find(p => (p.fila || 1) === fNum && p.pessoa === cabecaAntiga);
      if (pNovo && pNovo.status === 'atendida') {
        operacoes.push({ op: 'confirmar', fila: fNum, pessoa: cabecaAntiga });
        operacoes.push({ op: 'avancar', fila: fNum });
      }
    }

    // 4. Checagem de anulações
    const anuladasAntigas = new Set(
      (anterior.pessoas || []).filter(p => (p.fila || 1) === fNum && p.status === 'anulada').map(p => p.pessoa)
    );
    const novasAnuladas = (novo.pessoas || []).filter(
      p => (p.fila || 1) === fNum && p.status === 'anulada' && !anuladasAntigas.has(p.pessoa)
    );
    for (const p of novasAnuladas) {
      operacoes.push({ op: 'anular', fila: fNum, pessoa: p.pessoa, ajuste: !!p.ajuste });
    }

    // 5. Checagem de reversões
    const revertidasAntigas = anterior.filas?.[fNum]?.contadores?.revertidas ?? (fNum === 1 ? anterior.contadores?.revertidas : 0) ?? 0;
    const revertidasNovas = novo.filas?.[fNum]?.contadores?.revertidas ?? (fNum === 1 ? novo.contadores?.revertidas : 0) ?? 0;
    if (revertidasNovas > revertidasAntigas) {
      const cabecaNova = filaNova[0];
      if (cabecaNova !== undefined) {
        operacoes.push({ op: 'reverter', fila: fNum, pessoa: cabecaNova });
      }
    }
  }

  return operacoes;
}
