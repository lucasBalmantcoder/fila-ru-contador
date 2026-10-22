/**
 * shared/estado.js
 * Funções puras para derivação e comparação de estado da fila.
 * Compatível tanto com Node.js (ES module) quanto com navegadores (ES module).
 */

/**
 * Deriva o estado completo da fila a partir do log de eventos até o instante t.
 * @param {Array<Object>} eventos - Lista ordenada de eventos da sessão.
 * @param {number} [t=Infinity] - Instante limite (epoch ms). Padrão: Infinity.
 * @returns {Object} Estado derivado da fila.
 */
export function derivarEstado(eventos = [], t = Infinity) {
  const pessoas = new Map();
  const fila = []; // Array ordenado de IDs de pessoas que aguardam atendimento
  let totalChegadas = 0;
  let totalAtendidas = 0;
  let totalAnuladas = 0;
  let totalRevertidas = 0;
  let ultimoAtendimentoMs = null;
  let ultimoIntervaloSeg = null;
  let historicoAtendimentos = []; // { pessoa, t }

  // Filtrar eventos até o instante t
  const eventosValidos = eventos.filter(ev => ev.t <= t);

  for (const ev of eventosValidos) {
    if (ev.tipo === 'chegada') {
      totalChegadas++;
      const pId = ev.pessoa;
      pessoas.set(pId, {
        pessoa: pId,
        status: 'esperando',
        chegadaMs: ev.t,
        atendimentoMs: null,
        anulacaoMs: null,
        dispositivoChegada: ev.dispositivoNome || 'Desconhecido',
        dispositivoAtendimento: null,
        esperaMs: null,
        intervaloAtendimentoMs: null
      });
      fila.push(pId);
    } else if (ev.tipo === 'atendimento') {
      const pId = ev.pessoa;
      const idx = fila.indexOf(pId);
      if (idx !== -1) {
        fila.splice(idx, 1);
      }
      const p = pessoas.get(pId);
      if (p) {
        p.status = 'atendida';
        p.atendimentoMs = ev.t;
        p.dispositivoAtendimento = ev.dispositivoNome || 'Desconhecido';
        p.esperaMs = Math.max(0, ev.t - p.chegadaMs);

        if (ultimoAtendimentoMs !== null) {
          const deltaMs = Math.max(0, ev.t - ultimoAtendimentoMs);
          p.intervaloAtendimentoMs = deltaMs;
          ultimoIntervaloSeg = deltaMs / 1000;
        } else {
          p.intervaloAtendimentoMs = null;
          ultimoIntervaloSeg = null;
        }
        ultimoAtendimentoMs = ev.t;
        historicoAtendimentos.push({ pessoa: pId, t: ev.t });
        totalAtendidas++;
      }
    } else if (ev.tipo === 'anulacao') {
      const pId = ev.pessoa;
      const idx = fila.indexOf(pId);
      if (idx !== -1) {
        fila.splice(idx, 1);
      }
      const p = pessoas.get(pId);
      if (p) {
        p.status = 'anulada';
        p.anulacaoMs = ev.t;
        totalAnuladas++;
      }
    } else if (ev.tipo === 'reversao') {
      const pId = ev.pessoa;
      const p = pessoas.get(pId);
      if (p) {
        p.status = 'esperando';
        p.atendimentoMs = null;
        p.dispositivoAtendimento = null;
        p.esperaMs = null;
        p.intervaloAtendimentoMs = null;

        // Reinsere a pessoa no início da fila
        if (!fila.includes(pId)) {
          fila.unshift(pId);
        }

        // Remove do histórico de atendimentos
        const idxHist = historicoAtendimentos.map(h => h.pessoa).lastIndexOf(pId);
        if (idxHist !== -1) {
          historicoAtendimentos.splice(idxHist, 1);
        }

        // Recalcula o último atendimento
        if (historicoAtendimentos.length > 0) {
          ultimoAtendimentoMs = historicoAtendimentos[historicoAtendimentos.length - 1].t;
          if (historicoAtendimentos.length >= 2) {
            const penultimo = historicoAtendimentos[historicoAtendimentos.length - 2].t;
            ultimoIntervaloSeg = Math.max(0, ultimoAtendimentoMs - penultimo) / 1000;
          } else {
            ultimoIntervaloSeg = null;
          }
        } else {
          ultimoAtendimentoMs = null;
          ultimoIntervaloSeg = null;
        }

        totalAtendidas = Math.max(0, totalAtendidas - 1);
        totalRevertidas++;
      }
    }
  }

  // Define o status derivado "na_catraca" (verde): sempre a primeira pessoa da fila ativa
  for (let i = 0; i < fila.length; i++) {
    const pId = fila[i];
    const p = pessoas.get(pId);
    if (p) {
      if (i === 0) {
        p.status = 'na_catraca';
      } else {
        p.status = 'esperando';
      }
    }
  }

  const primeiraDaFila = fila.length > 0 ? fila[0] : null;

  // Cálculo da vazão recente nos últimos 5 minutos
  const tReferencia = (t !== Infinity && t !== null && !isNaN(t))
    ? t
    : (eventosValidos.length > 0 ? eventosValidos[eventosValidos.length - 1].t : Date.now());
  const cincoMinAtras = tReferencia - (5 * 60 * 1000);
  const atendimentosUltimos5Min = historicoAtendimentos.filter(h => h.t >= cincoMinAtras && h.t <= tReferencia).length;
  const vazaoRecente = atendimentosUltimos5Min / 5; // pessoas/min

  // Tempo de espera da pessoa que está atualmente na catraca (se houver)
  let esperaNaCatracaMs = 0;
  if (primeiraDaFila !== null) {
    const pCatraca = pessoas.get(primeiraDaFila);
    if (pCatraca) {
      esperaNaCatracaMs = Math.max(0, tReferencia - pCatraca.chegadaMs);
    }
  }

  return {
    pessoas: Array.from(pessoas.values()),
    fila,
    primeiraDaFila,
    esperaNaCatracaMs,
    contadores: {
      chegadas: totalChegadas,
      atendidas: totalAtendidas,
      anuladas: totalAnuladas,
      revertidas: totalRevertidas,
      naFila: fila.length
    },
    vazaoRecente,
    ultimoIntervaloSeg
  };
}

/**
 * Calcula a diferença operacional de animação entre dois estados consecutivos.
 * @param {Object|null} anterior - Estado anterior retornado por derivarEstado.
 * @param {Object} novo - Novo estado retornado por derivarEstado.
 * @returns {Array<Object>} Lista de operações de animação: entrar(N), confirmar(N), avancar, anular(N), reverter(N).
 */
export function diffEstado(anterior, novo) {
  if (!novo) return [];
  if (!anterior) {
    // Se não há estado anterior, gera as entradas para a fila atual
    return novo.fila.map(pessoa => ({ op: 'entrar', pessoa }));
  }

  const operacoes = [];
  const filaAntiga = anterior.fila || [];
  const filaNova = novo.fila || [];

  // 1. Checagem de novas chegadas (itens em novo que não existiam no anterior)
  const pessoasAntigas = new Set((anterior.pessoas || []).map(p => p.pessoa));
  const novasPessoas = (novo.pessoas || []).filter(p => !pessoasAntigas.has(p.pessoa));
  for (const p of novasPessoas) {
    operacoes.push({ op: 'entrar', pessoa: p.pessoa });
  }

  // 2. Checagem de confirmação de atendimento (cabeça antiga que passou para atendida)
  const cabecaAntiga = filaAntiga[0];
  if (cabecaAntiga !== undefined) {
    const pNovo = (novo.pessoas || []).find(p => p.pessoa === cabecaAntiga);
    if (pNovo && pNovo.status === 'atendida') {
      operacoes.push({ op: 'confirmar', pessoa: cabecaAntiga });
      operacoes.push({ op: 'avancar' });
    }
  }

  // 3. Checagem de anulações
  const anuladasAntigas = new Set(
    (anterior.pessoas || []).filter(p => p.status === 'anulada').map(p => p.pessoa)
  );
  const novasAnuladas = (novo.pessoas || []).filter(
    p => p.status === 'anulada' && !anuladasAntigas.has(p.pessoa)
  );
  for (const p of novasAnuladas) {
    operacoes.push({ op: 'anular', pessoa: p.pessoa });
  }

  // 4. Checagem de reversão (pessoa que estava atendida e voltou para a fila)
  if (novo.contadores.revertidas > (anterior.contadores.revertidas || 0)) {
    const cabecaNova = filaNova[0];
    if (cabecaNova !== undefined) {
      operacoes.push({ op: 'reverter', pessoa: cabecaNova });
    }
  }

  return operacoes;
}

