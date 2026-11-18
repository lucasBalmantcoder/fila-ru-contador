/**
 * shared/metricas.js
 * Funções puras para cálculo de métricas de desempenho de filas.
 * Suporta até três filas (Fila 1, Fila 2, Fila 3), cálculo de cobertura, lacunas,
 * ociosidade segmentada (serviço parado, sem demanda, sem cobertura), tabela por blocos
 * e tempo total da chegada às mesas (Fila 1 + Fila 2 encadeadas).
 * Compatível tanto com Node.js (ES module) quanto com navegadores (ES module).
 */

import { derivarEstado } from './estado.js';

/**
 * Formata milissegundos decorridos em HH:MM:SS.
 */
export function formatarDuracao(ms) {
  if (!ms || ms < 0 || isNaN(ms)) return "00:00:00";
  const totalSeg = Math.floor(ms / 1000);
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  const s = totalSeg % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/**
 * Formata timestamp em HH:MM:SS (fuso local).
 */
export function formatarHoraLocal(timestamp) {
  if (!timestamp) return "--:--:--";
  const d = new Date(timestamp);
  return d.toLocaleTimeString('pt-BR', { hour12: false });
}

/**
 * Formata número com vírgula decimal brasileira.
 */
export function formatarNumero(num, casas = 2) {
  if (num === null || num === undefined || isNaN(num)) return "0,00";
  return Number(num).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas
  });
}

/**
 * Calcula métricas estatísticas detalhadas sobre uma lista de números.
 */
export function calcularEstatisticas(valores = []) {
  if (!valores || valores.length === 0) {
    return {
      qtd: 0,
      media: 0,
      mediana: 0,
      desvioPadrao: 0,
      cv: 0,
      min: 0,
      max: 0,
      p90: 0,
      p95: 0
    };
  }

  const n = valores.length;
  const ordenados = [...valores].sort((a, b) => a - b);
  const soma = ordenados.reduce((acc, v) => acc + v, 0);
  const media = soma / n;

  // Mediana
  const meio = Math.floor(n / 2);
  const mediana = n % 2 !== 0 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;

  // Variância e Desvio Padrão amostral
  const somaQuad = ordenados.reduce((acc, v) => acc + Math.pow(v - media, 2), 0);
  const desvioPadrao = n > 1 ? Math.sqrt(somaQuad / (n - 1)) : 0;
  const cv = media > 0 ? (desvioPadrao / media) : 0;

  // Percentis
  const calcPercentil = (p) => {
    if (n === 1) return ordenados[0];
    const rank = (p / 100) * (n - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    const weight = rank - low;
    return ordenados[low] * (1 - weight) + ordenados[high] * weight;
  };

  return {
    qtd: n,
    media,
    mediana,
    desvioPadrao,
    cv,
    min: ordenados[0],
    max: ordenados[n - 1],
    p90: calcPercentil(90),
    p95: calcPercentil(95)
  };
}

/**
 * Calcula o comprimento da fila ponderado no tempo para uma fila específica.
 */
export function calcularComprimentoFilaTempo(eventos, inicioMs, fimMs, filaNum = 1) {
  if (!eventos || eventos.length === 0) {
    return { mediaPonderada: 0, max: 0, instanteMaxMs: inicioMs, timeline: [] };
  }

  const evs = eventos
    .filter(e => Number(e.fila || 1) === filaNum && (e.tipo === 'chegada' || e.tipo === 'atendimento' || e.tipo === 'anulacao' || e.tipo === 'reversao'))
    .sort((a, b) => a.t - b.t);

  const tempoTotal = Math.max(1, (fimMs || (evs[evs.length - 1]?.t || inicioMs)) - inicioMs);
  let qAtual = 0;
  let qMax = 0;
  let instanteMaxMs = inicioMs;
  let areaSobCurvaMs = 0;
  let tAnterior = inicioMs;

  const timeline = [{ t: inicioMs, q: 0 }];

  for (const ev of evs) {
    const deltaT = Math.max(0, ev.t - tAnterior);
    areaSobCurvaMs += qAtual * deltaT;
    tAnterior = ev.t;

    if (ev.tipo === 'chegada') {
      qAtual++;
    } else if (ev.tipo === 'atendimento' || ev.tipo === 'anulacao') {
      qAtual = Math.max(0, qAtual - 1);
    } else if (ev.tipo === 'reversao') {
      qAtual++;
    }

    timeline.push({ t: ev.t, q: qAtual });

    if (qAtual > qMax) {
      qMax = qAtual;
      instanteMaxMs = ev.t;
    }
  }

  const tFinalEfetivo = Math.max(tAnterior, fimMs || tAnterior);
  areaSobCurvaMs += qAtual * Math.max(0, tFinalEfetivo - tAnterior);
  timeline.push({ t: tFinalEfetivo, q: qAtual });

  const mediaPonderada = areaSobCurvaMs / tempoTotal;

  return {
    mediaPonderada,
    max: qMax,
    instanteMaxMs,
    timeline
  };
}

/**
 * Vazão e chegadas divididas por blocos temporais (ex: blocos de 5 min) para uma fila.
 * Blocos sem passagem recebem destaque (semPassagem: true).
 */
export function calcularVazaoBlocos(eventos, inicioMs, fimMs, blocoMin = 5, filaNum = 1, lacunas = []) {
  const blocoMs = blocoMin * 60 * 1000;
  const fimEfetivo = fimMs || Date.now();
  const duracaoTotal = Math.max(blocoMs, fimEfetivo - inicioMs);
  const totalBlocos = Math.max(1, Math.ceil(duracaoTotal / blocoMs));

  const blocos = [];
  for (let i = 0; i < totalBlocos; i++) {
    const tIniBloco = inicioMs + i * blocoMs;
    const tFimBloco = tIniBloco + blocoMs;

    // Calcula cobertura do bloco com base nas lacunas
    let tempoSemCoberturaNoBloco = 0;
    for (const lac of lacunas) {
      const interIni = Math.max(tIniBloco, lac.inicio);
      const interFim = Math.min(tFimBloco, lac.fim);
      if (interFim > interIni) {
        tempoSemCoberturaNoBloco += (interFim - interIni);
      }
    }
    const coberturaPerc = Math.max(0, Math.min(100, ((blocoMs - tempoSemCoberturaNoBloco) / blocoMs) * 100));

    blocos.push({
      indice: i + 1,
      rotulo: `${i * blocoMin}-${(i + 1) * blocoMin}m`,
      tInicio: tIniBloco,
      tFim: tFimBloco,
      chegadas: 0,
      atendimentos: 0,
      vazaoPorMin: 0,
      comprimentoMedio: 0,
      coberturaPerc,
      semPassagem: false
    });
  }

  const evsFila = eventos.filter(e => Number(e.fila || 1) === filaNum);

  for (const ev of evsFila) {
    if (ev.t < inicioMs) continue;
    const idx = Math.min(totalBlocos - 1, Math.floor((ev.t - inicioMs) / blocoMs));
    if (idx >= 0 && idx < totalBlocos) {
      if (ev.tipo === 'chegada' && !ev.ajuste) blocos[idx].chegadas++;
      if (ev.tipo === 'atendimento') blocos[idx].atendimentos++;
    }
  }

  for (const b of blocos) {
    b.vazaoPorMin = b.atendimentos / blocoMin;
    b.zeroPassagens = (b.atendimentos === 0);
    b.semPassagem = (b.atendimentos === 0);
  }

  const vazoes = blocos.map(b => b.vazaoPorMin);
  const maxVazao = Math.max(...vazoes, 0);
  const minVazao = Math.min(...vazoes, 0);
  const blocoPico = blocos.find(b => b.vazaoPorMin === maxVazao) || blocos[0];

  return {
    blocos,
    mediaVazao: vazoes.reduce((a, b) => a + b, 0) / blocos.length,
    maxVazao,
    minVazao,
    blocoPico
  };
}

/**
 * Calcula períodos de ociosidade e pausas longas para uma fila,
 * separando estritamente:
 * (a) Serviço parado: fila não vazia e nenhuma saída acima do limiar;
 * (b) Sem demanda: fila vazia;
 * (c) Sem cobertura: nenhum aparelho conectado cobrindo a fila.
 * A ociosidade de serviço NUNCA inclui períodos sem cobertura.
 */
export function calcularOciosidade(eventos, inicioMs, fimMs, limiarSeg = 60, filaNum = 1, lacunas = []) {
  const limiarMs = limiarSeg * 1000;
  const fimEfetivo = fimMs || Date.now();
  const duracaoTotal = Math.max(1000, fimEfetivo - inicioMs);

  // Pausas longas entre saídas consecutivas
  const atendimentos = eventos
    .filter(e => Number(e.fila || 1) === filaNum && e.tipo === 'atendimento')
    .sort((a, b) => a.t - b.t);

  const pausas = [];
  let maiorPausaSeg = 0;
  let tempoPausasTotalMs = 0;

  for (let i = 1; i < atendimentos.length; i++) {
    const delta = atendimentos[i].t - atendimentos[i - 1].t;
    if (delta >= limiarMs) {
      pausas.push({
        inicio: atendimentos[i - 1].t,
        fim: atendimentos[i].t,
        duracaoMs: delta,
        duracaoSeg: delta / 1000
      });
      tempoPausasTotalMs += delta;
      if (delta / 1000 > maiorPausaSeg) maiorPausaSeg = delta / 1000;
    }
  }

  // Análise contínua por discretização de 1 segundo (ou fatias de eventos)
  // para segmentar: Sem Cobertura vs Sem Demanda vs Serviço Parado
  const evs = eventos
    .filter(e => Number(e.fila || 1) === filaNum && (e.tipo === 'chegada' || e.tipo === 'atendimento' || e.tipo === 'anulacao' || e.tipo === 'reversao'))
    .sort((a, b) => a.t - b.t);

  // Intervalos de tempo
  const pontosTempo = new Set([inicioMs, fimEfetivo]);
  for (const e of evs) {
    if (e.t >= inicioMs && e.t <= fimEfetivo) pontosTempo.add(e.t);
  }
  for (const l of lacunas) {
    if (l.inicio >= inicioMs && l.inicio <= fimEfetivo) pontosTempo.add(l.inicio);
    if (l.fim >= inicioMs && l.fim <= fimEfetivo) pontosTempo.add(l.fim);
  }
  const tempos = Array.from(pontosTempo).sort((a, b) => a - b);

  let tempoSemCoberturaMs = 0;
  let tempoSemDemandaMs = 0;
  let tempoServicoParadoMs = 0;

  let q = 0;
  let ultimoAtendMs = inicioMs;
  let evIdx = 0;

  for (let i = 0; i < tempos.length - 1; i++) {
    const tIni = tempos[i];
    const tFim = tempos[i + 1];
    const delta = tFim - tIni;
    if (delta <= 0) continue;

    // Atualiza fila até tIni
    while (evIdx < evs.length && evs[evIdx].t <= tIni) {
      const ev = evs[evIdx];
      if (ev.tipo === 'chegada' || ev.tipo === 'reversao') q++;
      else if (ev.tipo === 'atendimento') {
        q = Math.max(0, q - 1);
        ultimoAtendMs = ev.t;
      } else if (ev.tipo === 'anulacao') {
        q = Math.max(0, q - 1);
      }
      evIdx++;
    }

    // Ponto médio da fatia
    const tMid = tIni + delta / 2;

    // Verifica se tMid está em uma lacuna de cobertura
    const semCob = lacunas.some(l => tMid >= l.inicio && tMid <= l.fim);

    if (semCob) {
      tempoSemCoberturaMs += delta;
    } else if (q === 0) {
      tempoSemDemandaMs += delta;
    } else {
      // Fila > 0 e coberto: se tempo desde último atendimento >= limiarMs, serviço está parado
      if ((tMid - ultimoAtendMs) >= limiarMs) {
        tempoServicoParadoMs += delta;
      }
    }
  }

  return {
    qtdPausas: pausas.length,
    maiorPausaSeg,
    tempoOciosoTotalMs: tempoPausasTotalMs,
    percentualOcioso: (tempoPausasTotalMs / duracaoTotal) * 100,
    pausas,
    // Decomposição estrita:
    tempoSemCoberturaMs,
    percSemCobertura: (tempoSemCoberturaMs / duracaoTotal) * 100,
    tempoSemDemandaMs,
    percSemDemanda: (tempoSemDemandaMs / duracaoTotal) * 100,
    tempoServicoParadoMs,
    percServicoParado: (tempoServicoParadoMs / duracaoTotal) * 100,
    detalhe: {
      servicoParadoSeg: Math.round(tempoServicoParadoMs / 1000),
      semDemandaSeg: Math.round(tempoSemDemandaMs / 1000),
      semCoberturaSeg: Math.round(tempoSemCoberturaMs / 1000),
      percServicoParado: (tempoServicoParadoMs / duracaoTotal) * 100,
      percSemDemanda: (tempoSemDemandaMs / duracaoTotal) * 100,
      percSemCobertura: (tempoSemCoberturaMs / duracaoTotal) * 100
    }
  };
}

/**
 * Calcula os períodos de cobertura e lacunas de uma fila a partir do log de conexões.
 * @param {Array<Object>} conexoes - Lista de eventos do conexoes.jsonl.
 * @param {number} filaNum - Fila alvo (1, 2 ou 3).
 * @param {number} inicioMs - Início do período ativo da fila.
 * @param {number} fimMs - Fim do período ativo da fila.
 */
export function calcularCoberturaPorFila(conexoes = [], filaNum = 1, inicioMs = 0, fimMs = Date.now()) {
  const duracaoTotal = Math.max(1000, fimMs - inicioMs);
  if (!conexoes || conexoes.length === 0) {
    // Sem registro de conexões (ex: sessões legadas)
    return {
      disponivel: false,
      coberturaPerc: 100,
      percentual: 100,
      cobertoMs: duracaoTotal,
      tempoComCoberturaSeg: Math.round(duracaoTotal / 1000),
      tempoSemCoberturaSeg: 0,
      lacunas: [],
      intervalosSemCobertura: [],
      aparelhosDistintos: [],
      cobertoAgora: false
    };
  }

  // Ordena eventos de conexão
  const evs = [...conexoes].sort((a, b) => a.t - b.t);

  // Reconstrói estado de cada dispositivo ao longo do tempo: Map(id -> { conectado, area })
  // Verifica se o dispositivo cobre filaNum:
  const cobreFila = (area) => {
    if (!area) return false;
    if (area === 'todas') return true;
    if (area === 'apoio' || area === 'sem_area') return false;
    if (typeof area === 'number') return area === filaNum;
    const str = String(area);
    if (str.includes(String(filaNum))) return true;
    return false;
  };

  // Coleta instantes críticos
  const instantesSet = new Set([inicioMs, fimMs]);
  for (const c of evs) {
    if (c.t >= inicioMs && c.t <= fimMs) instantesSet.add(c.t);
  }
  const instantes = Array.from(instantesSet).sort((a, b) => a - b);

  const aparelhos = new Map(); // id -> { conectado: boolean, area }
  let evIdx = 0;
  let cobertoMs = 0;
  const lacunas = [];
  let lacunaAtual = null;

  for (let i = 0; i < instantes.length - 1; i++) {
    const tIni = instantes[i];
    const tFim = instantes[i + 1];
    const delta = tFim - tIni;

    while (evIdx < evs.length && evs[evIdx].t <= tIni) {
      const ev = evs[evIdx];
      const dId = ev.dispositivoId || ev.id;
      if (ev.tipo === 'conexao' || ev.acao === 'conectou') {
        aparelhos.set(dId, { conectado: true, area: ev.area });
      } else if (ev.tipo === 'desconexao' || ev.acao === 'desconectou') {
        const ap = aparelhos.get(dId);
        if (ap) ap.conectado = false;
      } else if (ev.tipo === 'mudanca_area' || ev.tipo === 'atribuicao' || ev.acao === 'mudanca_area') {
        const ap = aparelhos.get(dId) || { conectado: true };
        ap.area = ev.paraArea || ev.area;
        aparelhos.set(dId, ap);
      }
      evIdx++;
    }

    // Há ao menos um aparelho conectado cobrindo esta fila?
    let temCobertura = false;
    for (const ap of aparelhos.values()) {
      if (ap.conectado && cobreFila(ap.area)) {
        temCobertura = true;
        break;
      }
    }

    if (temCobertura) {
      cobertoMs += delta;
      if (lacunaAtual) {
        lacunaAtual.fim = tIni;
        lacunaAtual.duracaoMs = lacunaAtual.fim - lacunaAtual.inicio;
        lacunaAtual.inicioMs = lacunaAtual.inicio;
        lacunaAtual.fimMs = lacunaAtual.fim;
        lacunaAtual.duracaoSeg = Math.round(lacunaAtual.duracaoMs / 1000);
        if (lacunaAtual.duracaoMs > 0) lacunas.push(lacunaAtual);
        lacunaAtual = null;
      }
    } else {
      if (!lacunaAtual) {
        lacunaAtual = {
          inicio: tIni,
          fim: tFim,
          duracaoMs: delta,
          inicioMs: tIni,
          fimMs: tFim,
          duracaoSeg: Math.round(delta / 1000)
        };
      } else {
        lacunaAtual.fim = tFim;
        lacunaAtual.duracaoMs = lacunaAtual.fim - lacunaAtual.inicio;
        lacunaAtual.fimMs = tFim;
        lacunaAtual.duracaoSeg = Math.round(lacunaAtual.duracaoMs / 1000);
      }
    }
  }

  if (lacunaAtual && lacunaAtual.duracaoMs > 0) {
    lacunaAtual.inicioMs = lacunaAtual.inicio;
    lacunaAtual.fimMs = lacunaAtual.fim;
    lacunaAtual.duracaoSeg = Math.round(lacunaAtual.duracaoMs / 1000);
    lacunas.push(lacunaAtual);
  }

  // Verifica estado no instante atual/fimMs
  let cobertoAgora = false;
  for (const ap of aparelhos.values()) {
    if (ap.conectado && cobreFila(ap.area)) {
      cobertoAgora = true;
      break;
    }
  }

  const coberturaPerc = (cobertoMs / duracaoTotal) * 100;

  return {
    disponivel: true,
    coberturaPerc,
    percentual: coberturaPerc,
    cobertoMs,
    tempoComCoberturaSeg: Math.round(cobertoMs / 1000),
    tempoSemCoberturaSeg: Math.round((duracaoTotal - cobertoMs) / 1000),
    lacunas,
    intervalosSemCobertura: lacunas,
    aparelhosDistintos: Array.from(aparelhos.keys()),
    cobertoAgora
  };
}

/**
 * Modelo Teórico de Teoria das Filas M/M/c (Erlang C) quando rho < 1.
 */
export function calcularModeloTeorico(lambdaPorMin, muPorMin, c = 1) {
  if (!lambdaPorMin || !muPorMin || lambdaPorMin <= 0 || muPorMin <= 0 || c < 1) {
    return { aplicavel: false, motivo: 'Taxas insuficientes para o modelo.' };
  }

  const a = lambdaPorMin / muPorMin; // Intensidade de tráfego (Erlangs)
  const rho = a / c; // Utilização por servidor

  if (rho >= 1) {
    return {
      aplicavel: false,
      rho,
      motivo: `Fila instável (ρ = ${formatarNumero(rho * 100, 1)}% ≥ 100%). Chegadas superam a capacidade do sistema.`
    };
  }

  const fatorial = (n) => {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  };

  let somaK = 0;
  for (let k = 0; k < c; k++) {
    somaK += Math.pow(a, k) / fatorial(k);
  }
  const termoC = Math.pow(a, c) / (fatorial(c) * (1 - rho));
  const P0 = 1 / (somaK + termoC);

  const P_espera = termoC * P0; // Probabilidade de esperar na fila C(c, a)
  const Lq = (P_espera * rho) / (1 - rho); // Comprimento médio da fila
  const Wq_min = Lq / lambdaPorMin; // Tempo médio de espera na fila (minutos)
  const L = Lq + a; // Clientes no sistema
  const W_min = Wq_min + (1 / muPorMin); // Tempo no sistema

  return {
    aplicavel: true,
    c,
    a,
    rho,
    P0,
    P_espera,
    Lq,
    Wq_seg: Wq_min * 60,
    L,
    W_seg: W_min * 60
  };
}

/**
 * Validação da Lei de Little: L = lambda * W
 */
export function verificarLeiDeLittle(L_medio, lambdaPorMin, W_espera_seg) {
  const W_min = (W_espera_seg || 0) / 60;
  const L_calculado = lambdaPorMin * W_min;
  const diffAbs = Math.abs(L_medio - L_calculado);
  const diffPerc = L_medio > 0 ? (diffAbs / L_medio) * 100 : 0;

  return {
    L_observado: L_medio,
    L_calculado_lambda_W: L_calculado,
    diffAbs,
    diffPerc,
    consistente: diffPerc < 20
  };
}

/**
 * Calcula todas as métricas detalhadas da sessão, por fila ativa e encadeadas.
 * @param {Array<Object>} eventos - Log de eventos da sessão.
 * @param {Object} [config={}] - Configuração da sessão.
 * @param {number|null} [fimMsParam=null] - Instante limite.
 * @param {Array<Object>} [conexoes=[]] - Log de conexões para cálculo de cobertura.
 * @param {Object} [opcoes={}] - { excluirPeriodosSemCobertura: boolean }.
 */
export function calcularMetricas(eventos = [], config = {}, fimMsParam = null, conexoes = [], opcoes = {}) {
  // Tratamento de compatibilidade caso a assinatura antiga (eventos, duracaoTotalMs, config, conexoes, opcoes) seja usada
  let duracaoForcadaMs = null;
  if (typeof config === 'number') {
    duracaoForcadaMs = config;
    const configReal = (fimMsParam && typeof fimMsParam === 'object') ? fimMsParam : {};
    fimMsParam = null;
    config = configReal;
  }

  eventos = Array.isArray(eventos) ? eventos : [];
  config = (config && typeof config === 'object') ? config : {};
  conexoes = Array.isArray(conexoes) ? conexoes : [];
  opcoes = (opcoes && typeof opcoes === 'object') ? opcoes : {};

  const inicioEv = eventos.find(e => e.tipo === 'sessao_iniciada');
  const encerramentoEv = eventos.find(e => e.tipo === 'sessao_encerrada');

  let inicioMs = inicioEv ? inicioEv.t : (eventos[0]?.t || Date.now());
  if (conexoes && conexoes.length > 0 && conexoes[0].t < inicioMs) {
    inicioMs = conexoes[0].t;
  }
  const fimMs = duracaoForcadaMs
    ? (inicioMs + duracaoForcadaMs)
    : (fimMsParam || (encerramentoEv ? encerramentoEv.t : (eventos[eventos.length - 1]?.t || Date.now())));
  const duracaoTotalMs = Math.max(1000, fimMs - inicioMs);
  const duracaoMin = duracaoTotalMs / (60 * 1000);

  const estadoFinal = derivarEstado(eventos, fimMs, config);
  const filasAtivas = estadoFinal.filasAtivas || [1];
  const todasPessoas = estadoFinal.pessoas || [];

  const metricasPorFila = {};

  for (const fNum of [1, 2, 3]) {
    const fo = estadoFinal.filas ? estadoFinal.filas[fNum] : null;
    if (!fo || !filasAtivas.includes(fNum)) {
      continue;
    }

    const tFimFila = fo.desativadaEm !== null ? fo.desativadaEm : fimMs;
    const duracaoFilaMs = Math.max(1000, tFimFila - inicioMs);
    const duracaoFilaMin = duracaoFilaMs / (60 * 1000);

    // Cobertura da fila
    const cob = calcularCoberturaPorFila(conexoes, fNum, inicioMs, tFimFila);
    const duracaoEfetivaMin = (opcoes.excluirPeriodosSemCobertura && cob.disponivel)
      ? Math.max(0.1, cob.cobertoMs / (60 * 1000))
      : duracaoFilaMin;

    // Fila sem nenhum evento
    if (fo.semDados) {
      metricasPorFila[fNum] = {
        fila: fNum,
        ativa: fo.ativa,
        desativadaEm: fo.desativadaEm,
        semDados: true,
        duracaoFilaMin,
        cobertura: cob
      };
      continue;
    }

    // Pessoas desta fila
    const pessoasFila = todasPessoas.filter(p => (p.fila || 1) === fNum);
    const pessoasEfetivas = pessoasFila.filter(p => p.status !== 'anulada');
    const pessoasAtendidas = pessoasEfetivas.filter(p => p.status === 'atendida' && p.atendimentoMs !== null);

    const n_chegadas = pessoasEfetivas.length;
    const n_atendimentos = pessoasAtendidas.length;
    const n_anuladas = fo.contadores.anuladas;
    const n_revertidas = fo.contadores.revertidas;
    const n_na_fila = fo.fila.length;

    // Taxa de Chegada lambda
    const lambda = duracaoEfetivaMin > 0 ? (n_chegadas / duracaoEfetivaMin) : 0;

    // Intervalos de atendimento e taxa de serviço mu
    // Exclui pessoas com ajuste
    const atendidasNaoAjuste = pessoasAtendidas.filter(p => !p.ajuste);
    const intervalosAtendSeg = atendidasNaoAjuste
      .filter(p => p.intervaloAtendimentoMs !== null)
      .map(p => p.intervaloAtendimentoMs / 1000);
    const statsIntervalosAtend = calcularEstatisticas(intervalosAtendSeg);

    const servidores = (config.servidoresPorFila && config.servidoresPorFila[fNum]) || config.servidores || 1;
    const mediaIntervaloSeg = statsIntervalosAtend.media;
    const muPorServidor = mediaIntervaloSeg > 0 ? ((60 / mediaIntervaloSeg) / servidores) : 0;

    // Fator de utilização rho
    const utilizacao = (muPorServidor > 0 && servidores > 0)
      ? (lambda / (servidores * muPorServidor))
      : 0;

    // Vazão
    const vazaoGlobalPorMin = duracaoEfetivaMin > 0 ? (n_atendimentos / duracaoEfetivaMin) : 0;
    let vazaoOperacionalPorMin = 0;
    if (atendidasNaoAjuste.length >= 2) {
      const tPrim = atendidasNaoAjuste[0].atendimentoMs;
      const tUlt = atendidasNaoAjuste[atendidasNaoAjuste.length - 1].atendimentoMs;
      const durOperacionalMin = Math.max(0.1, (tUlt - tPrim) / (60 * 1000));
      vazaoOperacionalPorMin = (atendidasNaoAjuste.length - 1) / durOperacionalMin;
    }

    // Tempos de Espera (exclui ajustes e, se solicitado, exclui quem atravessou lacunas)
    const pessoasEsperaValidas = atendidasNaoAjuste.filter(p => {
      if (p.esperaMs === null) return false;
      if (opcoes.excluirPeriodosSemCobertura && cob.lacunas.length > 0) {
        const atravessou = cob.lacunas.some(l => p.chegadaMs < l.fim && p.atendimentoMs > l.inicio);
        if (atravessou) return false;
      }
      return true;
    });

    const temposEsperaSeg = pessoasEsperaValidas.map(p => p.esperaMs / 1000);
    const statsEspera = calcularEstatisticas(temposEsperaSeg);

    // Intervalos entre Chegadas (exclui ajustes)
    const chegadasNaoAjuste = pessoasEfetivas.filter(p => !p.ajuste).sort((a, b) => a.chegadaMs - b.chegadaMs);
    const intervalosChegSeg = [];
    for (let i = 1; i < chegadasNaoAjuste.length; i++) {
      intervalosChegSeg.push((chegadasNaoAjuste[i].chegadaMs - chegadasNaoAjuste[i - 1].chegadaMs) / 1000);
    }
    const statsIntervalosCheg = calcularEstatisticas(intervalosChegSeg);

    // Comprimento da fila no tempo
    const filaTempo = calcularComprimentoFilaTempo(eventos, inicioMs, tFimFila, fNum);

    // Blocos temporais
    const vazaoBlocos = calcularVazaoBlocos(eventos, inicioMs, tFimFila, config.blocoMin || 5, fNum, cob.lacunas);

    // Ociosidade e pausas
    const ociosidade = calcularOciosidade(eventos, inicioMs, tFimFila, config.limiarPausaSeg || 60, fNum, cob.lacunas);

    // Lei de Little e modelo teórico
    const little = verificarLeiDeLittle(filaTempo.mediaPonderada, lambda, statsEspera.media);
    const teorico = calcularModeloTeorico(lambda, muPorServidor, servidores);

    metricasPorFila[fNum] = {
      fila: fNum,
      ativa: fo.ativa,
      desativadaEm: fo.desativadaEm,
      semDados: false,
      servidores,
      duracaoFilaMin,
      duracaoEfetivaMin,
      n_chegadas,
      n_atendimentos,
      n_anuladas,
      n_revertidas,
      n_na_fila,
      lambda,
      muPorServidor,
      utilizacao,
      vazaoGlobalPorMin,
      vazaoOperacionalPorMin,
      statsEspera,
      statsIntervalosAtend,
      statsIntervalosCheg,
      filaTempo,
      vazaoBlocos,
      ociosidade,
      little,
      teorico,
      cobertura: cob,
      pessoas: pessoasFila
    };
  }

  // Encadeamento Fila 1 -> Fila 2: tempo total da chegada até as mesas
  let tempoChegadaAteMesas = null;
  let transitoMesas = null;
  if (filasAtivas.includes(1) && filasAtivas.includes(2) && metricasPorFila[1] && metricasPorFila[2] && !metricasPorFila[1].semDados && !metricasPorFila[2].semDados) {
    const pessoasFila1Map = new Map(todasPessoas.filter(p => (p.fila || 1) === 1).map(p => [p.pessoa, p]));
    const pessoasFila2Atendidas = todasPessoas.filter(p => (p.fila || 1) === 2 && p.status === 'atendida' && p.atendimentoMs !== null && !p.ajuste);

    const temposChegadaAteMesasSeg = [];
    for (const p2 of pessoasFila2Atendidas) {
      const p1 = pessoasFila1Map.get(p2.pessoa);
      if (p1 && p1.chegadaMs && !p1.ajuste) {
        const deltaSeg = Math.max(0, p2.atendimentoMs - p1.chegadaMs) / 1000;
        temposChegadaAteMesasSeg.push(deltaSeg);
      }
    }
    tempoChegadaAteMesas = calcularEstatisticas(temposChegadaAteMesasSeg);
    if (tempoChegadaAteMesas && tempoChegadaAteMesas.qtd > 0) {
      transitoMesas = {
        count: tempoChegadaAteMesas.qtd,
        mediaSeg: tempoChegadaAteMesas.media,
        medianaSeg: tempoChegadaAteMesas.mediana,
        p90Seg: tempoChegadaAteMesas.p90
      };
    }
  }

  // Encadeamento Fila 2 -> Fila 3: tempo da chegada na F2 até a saída na F3
  let tempoMesasAteSaida = null;
  if (filasAtivas.includes(2) && filasAtivas.includes(3) && metricasPorFila[2] && metricasPorFila[3] && !metricasPorFila[2].semDados && !metricasPorFila[3].semDados) {
    const pessoasFila2Map = new Map(todasPessoas.filter(p => (p.fila || 1) === 2).map(p => [p.pessoa, p]));
    const pessoasFila3Atendidas = todasPessoas.filter(p => (p.fila || 1) === 3 && p.status === 'atendida' && p.atendimentoMs !== null && !p.ajuste);

    const temposMesasAteSaidaSeg = [];
    for (const p3 of pessoasFila3Atendidas) {
      const p2 = pessoasFila2Map.get(p3.pessoa);
      if (p2 && p2.chegadaMs && !p2.ajuste) {
        const deltaSeg = Math.max(0, p3.atendimentoMs - p2.chegadaMs) / 1000;
        temposMesasAteSaidaSeg.push(deltaSeg);
      }
    }
    tempoMesasAteSaida = calcularEstatisticas(temposMesasAteSaidaSeg);
  }

  // Encadeamento Completo Fila 1 -> Fila 2 -> Fila 3: tempo total da entrada no RU até a saída
  let tempoTotalF1F2F3 = null;
  let transitoSaida = null;
  if (filasAtivas.includes(1) && filasAtivas.includes(2) && filasAtivas.includes(3) &&
      metricasPorFila[1] && metricasPorFila[2] && metricasPorFila[3] &&
      !metricasPorFila[1].semDados && !metricasPorFila[2].semDados && !metricasPorFila[3].semDados) {
    const pessoasFila1Map = new Map(todasPessoas.filter(p => (p.fila || 1) === 1).map(p => [p.pessoa, p]));
    const pessoasFila3Atendidas = todasPessoas.filter(p => (p.fila || 1) === 3 && p.status === 'atendida' && p.atendimentoMs !== null && !p.ajuste);

    const temposTotalF1F2F3Seg = [];
    for (const p3 of pessoasFila3Atendidas) {
      const p1 = pessoasFila1Map.get(p3.pessoa);
      if (p1 && p1.chegadaMs && !p1.ajuste) {
        const deltaSeg = Math.max(0, p3.atendimentoMs - p1.chegadaMs) / 1000;
        temposTotalF1F2F3Seg.push(deltaSeg);
      }
    }
    tempoTotalF1F2F3 = calcularEstatisticas(temposTotalF1F2F3Seg);
    if (tempoTotalF1F2F3 && tempoTotalF1F2F3.qtd > 0) {
      transitoSaida = {
        count: tempoTotalF1F2F3.qtd,
        mediaSeg: tempoTotalF1F2F3.media,
        medianaSeg: tempoTotalF1F2F3.mediana,
        p90Seg: tempoTotalF1F2F3.p90
      };
    }
  }

  // Qualidade dos dados
  const eventosTardios = eventos.filter(e => e.tardio).length;
  const eventosPorAparelho = {};
  for (const ev of eventos) {
    const nome = ev.dispositivoNome || 'Servidor';
    eventosPorAparelho[nome] = (eventosPorAparelho[nome] || 0) + 1;
  }

  // Estatísticas globais de preenchimento das Mesas (216 cadeiras em 4 fileiras de 9 mesas)
  const CAPACIDADE_MESAS_TOTAL = 216;
  const eventosMesas = eventos
    .filter(e => (e.tipo === 'atendimento' && (e.fila === 2 || (!filasAtivas.includes(2) && e.fila === 1))) ||
                 (e.tipo === 'atendimento' && e.fila === 3))
    .sort((a, b) => a.t - b.t);

  let picoMesas = 0;
  let instantePicoMesas = inicioMs;
  let contagemAtualMesas = 0;
  let somaPonderadaMesas = 0;
  let ultimoTMesas = inicioMs;

  for (const ev of eventosMesas) {
    const delta = Math.max(0, ev.t - ultimoTMesas);
    somaPonderadaMesas += contagemAtualMesas * delta;
    ultimoTMesas = ev.t;

    if (ev.tipo === 'atendimento' && (ev.fila === 2 || (!filasAtivas.includes(2) && ev.fila === 1))) {
      contagemAtualMesas++;
      if (contagemAtualMesas > picoMesas) {
        picoMesas = contagemAtualMesas;
        instantePicoMesas = ev.t;
      }
    } else if (ev.tipo === 'atendimento' && ev.fila === 3) {
      contagemAtualMesas = Math.max(0, contagemAtualMesas - 1);
    }
  }

  const deltaFinal = Math.max(0, (fimMs || Date.now()) - ultimoTMesas);
  somaPonderadaMesas += contagemAtualMesas * deltaFinal;
  const duracaoTotalMesas = Math.max(1000, (fimMs || Date.now()) - inicioMs);
  const mediaCadeirasOcupadas = Math.round((somaPonderadaMesas / duracaoTotalMesas) * 10) / 10;
  const picoPercentual = Math.round((Math.min(CAPACIDADE_MESAS_TOTAL, picoMesas) / CAPACIDADE_MESAS_TOTAL) * 100);

  let statusPico = 'Tranquilo';
  if (picoPercentual >= 90) {
    statusPico = 'Lotado';
  } else if (picoPercentual >= 75) {
    statusPico = 'Quase Cheio';
  } else if (picoPercentual >= 50) {
    statusPico = 'Moderado';
  }

  const totalEventosEntrada = eventosMesas.filter(e => e.tipo === 'atendimento' && (e.fila === 2 || (!filasAtivas.includes(2) && e.fila === 1))).length;

  const estatisticasMesas = {
    capacidadeTotal: CAPACIDADE_MESAS_TOTAL,
    fileiras: 4,
    mesasPorFileira: 9,
    totalMesas: 36,
    cadeirasPorMesa: 6,
    picoOcupadas: Math.min(CAPACIDADE_MESAS_TOTAL, picoMesas),
    instantePicoMs: instantePicoMesas,
    picoPercentual,
    mediaOcupadas: Math.min(CAPACIDADE_MESAS_TOTAL, mediaCadeirasOcupadas),
    mediaPercentual: Math.round((Math.min(CAPACIDADE_MESAS_TOTAL, mediaCadeirasOcupadas) / CAPACIDADE_MESAS_TOTAL) * 100),
    statusPico,
    totalEventosEntrada
  };

  // Compatibilidade com raiz: se Fila 1 foi calculada, suas métricas preenchem a raiz
  const mF1 = metricasPorFila[1] || {};

  return {
    inicioMs,
    fimMs,
    duracaoTotalMs,
    duracaoMin,
    filasAtivas,
    filas: metricasPorFila,
    tempoChegadaAteMesas,
    transitoMesas,
    tempoMesasAteSaida,
    tempoTotalF1F2F3,
    transitoSaida,
    estatisticasMesas,
    // Propriedades raiz compatíveis com Fila 1:
    n_chegadas: mF1.n_chegadas ?? 0,
    n_atendimentos: mF1.n_atendimentos ?? 0,
    n_anuladas: mF1.n_anuladas ?? 0,
    n_revertidas: mF1.n_revertidas ?? 0,
    n_na_fila: mF1.n_na_fila ?? 0,
    lambda: mF1.lambda ?? 0,
    muPorServidor: mF1.muPorServidor ?? 0,
    utilizacao: mF1.utilizacao ?? 0,
    vazaoGlobalPorMin: mF1.vazaoGlobalPorMin ?? 0,
    vazaoOperacionalPorMin: mF1.vazaoOperacionalPorMin ?? 0,
    statsEspera: mF1.statsEspera ?? calcularEstatisticas([]),
    statsIntervalosAtend: mF1.statsIntervalosAtend ?? calcularEstatisticas([]),
    statsIntervalosCheg: mF1.statsIntervalosCheg ?? calcularEstatisticas([]),
    filaTempo: mF1.filaTempo ?? { mediaPonderada: 0, max: 0, instanteMaxMs: inicioMs, timeline: [] },
    vazaoBlocos: mF1.vazaoBlocos ?? { blocos: [], mediaVazao: 0, maxVazao: 0, minVazao: 0, blocoPico: null },
    ociosidade: mF1.ociosidade ?? { qtdPausas: 0, tempoOciosoTotalMs: 0, percentualOcioso: 0, pausas: [] },
    little: mF1.little ?? { L_observado: 0, L_calculado_lambda_W: 0, diffAbs: 0, diffPerc: 0, consistente: true },
    teorico: mF1.teorico ?? { aplicavel: false, motivo: 'Nenhum dado' },
    qualidade: {
      eventosTardios,
      totalEventos: eventos.length,
      eventosPorAparelho
    },
    pessoas: todasPessoas
  };
}

/**
 * Catálogo e registro formal de IDs estáveis das métricas do sistema (conforme METRICAS.md).
 */
export const METRICAS = {
  // 2.1 Contagens e tempos de referência
  'M-01': { id: 'M-01', nome: 'Entradas (n_e)', unidade: 'pessoas' },
  'M-02': { id: 'M-02', nome: 'Saídas (n_s)', unidade: 'pessoas' },
  'M-03': { id: 'M-03', nome: 'Anuladas', unidade: 'pessoas' },
  'M-04': { id: 'M-04', nome: 'Revertidas', unidade: 'eventos' },
  'M-05': { id: 'M-05', nome: 'Ajustes', unidade: 'eventos' },
  'M-06': { id: 'M-06', nome: 'Pessoas na fila ao encerrar', unidade: 'pessoas' },
  'M-07': { id: 'M-07', nome: 'Duração observada (T)', unidade: 's' },
  'M-08': { id: 'M-08', nome: 'Tempo até a primeira saída', unidade: 's' },
  'M-09': { id: 'M-09', nome: 'Tempo após a última saída', unidade: 's' },

  // 2.2 Taxas e vazão
  'M-10': { id: 'M-10', nome: 'Taxa de entrada (lambda)', unidade: 'pessoas/min' },
  'M-11': { id: 'M-11', nome: 'Vazão global', unidade: 'pessoas/min' },
  'M-12': { id: 'M-12', nome: 'Vazão em operação', unidade: 'pessoas/min' },
  'M-13': { id: 'M-13', nome: 'Taxa de serviço efetiva (mu agregada)', unidade: 'pessoas/min' },
  'M-14': { id: 'M-14', nome: 'Taxa de serviço em ocupação (mu ocupada)', unidade: 'pessoas/min' },
  'M-15': { id: 'M-15', nome: 'Taxa de serviço por servidor (mu_c)', unidade: 'pessoas/min' },
  'M-16': { id: 'M-16', nome: 'Fator de utilização (rho)', unidade: '' },
  'M-17': { id: 'M-17', nome: 'Saídas por bloco', unidade: 'pessoas' },
  'M-18': { id: 'M-18', nome: 'Entradas por bloco', unidade: 'pessoas' },
  'M-19': { id: 'M-19', nome: 'Resumo por bloco', unidade: 'pessoas' },

  // 2.3 Tempo na fila (por pessoa)
  'M-20': { id: 'M-20', nome: 'Tempo de espera médio (Wq)', unidade: 's' },
  'M-21': { id: 'M-21', nome: 'Tempo de espera mediana', unidade: 's' },
  'M-22': { id: 'M-22', nome: 'Tempo de espera desvio padrão', unidade: 's' },
  'M-23': { id: 'M-23', nome: 'Tempo de espera mínimo', unidade: 's' },
  'M-24': { id: 'M-24', nome: 'Tempo de espera máximo', unidade: 's' },
  'M-25': { id: 'M-25', nome: 'Tempo de espera P90', unidade: 's' },
  'M-26': { id: 'M-26', nome: 'Tempo de espera P95', unidade: 's' },
  'M-27': { id: 'M-27', nome: 'Pessoas sem saída ao final', unidade: 'pessoas' },

  // 2.4 Intervalos
  'M-30': { id: 'M-30', nome: 'Intervalo entre saídas: média', unidade: 's' },
  'M-31': { id: 'M-31', nome: 'Intervalo entre saídas: mediana', unidade: 's' },
  'M-32': { id: 'M-32', nome: 'Intervalo entre saídas: desvio padrão', unidade: 's' },
  'M-33': { id: 'M-33', nome: 'Intervalo entre saídas: CV', unidade: '' },
  'M-34': { id: 'M-34', nome: 'Intervalo entre saídas: mínimo', unidade: 's' },
  'M-35': { id: 'M-35', nome: 'Intervalo entre saídas: máximo', unidade: 's' },
  'M-36': { id: 'M-36', nome: 'Intervalo entre saídas: P90', unidade: 's' },
  'M-37': { id: 'M-37', nome: 'Intervalo entre saídas: P95', unidade: 's' },
  'M-38': { id: 'M-38', nome: 'Intervalos entre entradas', unidade: 's' },

  // 2.5 Comprimento da fila
  'M-40': { id: 'M-40', nome: 'Comprimento médio (Lq)', unidade: 'pessoas' },
  'M-41': { id: 'M-41', nome: 'Comprimento máximo', unidade: 'pessoas' },
  'M-42': { id: 'M-42', nome: 'Tempo com a fila vazia', unidade: 's e %' },
  'M-43': { id: 'M-43', nome: 'Série temporal do comprimento', unidade: 'pessoas' },

  // 2.5.1 Ociosidade e demanda
  'M-50': { id: 'M-50', nome: 'Pausas de serviço parado', unidade: 'pausas' },
  'M-51': { id: 'M-51', nome: 'Tempo de serviço parado', unidade: 's e %' },
  'M-52': { id: 'M-52', nome: 'Maior pausa com fila não vazia', unidade: 's' },
  'M-53': { id: 'M-53', nome: 'Tempo sem demanda', unidade: 's e %' },
  'M-54': { id: 'M-54', nome: 'Tempo sem cobertura', unidade: 's e %' },

  // 2.6 Little e teórico
  'M-60': { id: 'M-60', nome: 'Verificação da Lei de Little', unidade: '%' },
  'M-61': { id: 'M-61', nome: 'Modelo Teórico M/M/c (Erlang C)', unidade: '' },

  // 3. Tabela analítica por blocos
  'M-70': { id: 'M-70', nome: 'Início-Fim do bloco', unidade: '' },
  'M-71': { id: 'M-71', nome: 'Entradas no bloco', unidade: 'pessoas' },
  'M-72': { id: 'M-72', nome: 'Saídas no bloco', unidade: 'pessoas' },
  'M-73': { id: 'M-73', nome: 'Comprimento médio no bloco', unidade: 'pessoas' },
  'M-74': { id: 'M-74', nome: 'Cobertura do bloco (%)', unidade: '%' },
  'M-75': { id: 'M-75', nome: 'Pausas longas no bloco', unidade: 'pausas' },

  // 4. Métricas combinadas e encadeamentos
  'M-80': { id: 'M-80', nome: 'Tempo total até as mesas (Fila 1 + Fila 2)', unidade: 's' },
  'M-81': { id: 'M-81', nome: 'Tempo total no restaurante (Fila 1 + Fila 2 + Fila 3)', unidade: 's' },
  'M-82': { id: 'M-82', nome: 'Participação de cada fila no tempo total', unidade: '%' },
  'M-83': { id: 'M-83', nome: 'Ranking de gargalo', unidade: '' },
  'M-84': { id: 'M-84', nome: 'Pessoas no sistema', unidade: 'pessoas' },
  'M-85': { id: 'M-85', nome: 'Balanço de consistência de fluxo', unidade: '' },
  'M-86': { id: 'M-86', nome: 'Tempo Mesas até a Saída (Fila 2 + Fila 3)', unidade: 's' },
  'M-87': { id: 'M-87', nome: 'Resumo de trânsito até as mesas (transitoMesas)', unidade: '' },
  'M-88': { id: 'M-88', nome: 'Resumo de trânsito até a saída (transitoSaida)', unidade: '' },

  // 5. Ocupação do Salão e Mesas (216 cadeiras)
  'M-110': { id: 'M-110', nome: 'Capacidade total de assentos das mesas', unidade: 'cadeiras' },
  'M-111': { id: 'M-111', nome: 'Cadeiras ocupadas em tempo real', unidade: 'cadeiras' },
  'M-112': { id: 'M-112', nome: 'Cadeiras livres em tempo real', unidade: 'cadeiras' },
  'M-113': { id: 'M-113', nome: 'Taxa de ocupação instantânea das mesas', unidade: '%' },
  'M-114': { id: 'M-114', nome: 'Mesas ocupadas estimadas', unidade: 'mesas' },
  'M-115': { id: 'M-115', nome: 'Status de ocupação instantâneo', unidade: 'rótulo' },
  'M-116': { id: 'M-116', nome: 'Pico de cadeiras ocupadas', unidade: 'cadeiras e horário' },
  'M-117': { id: 'M-117', nome: 'Taxa de ocupação no pico', unidade: '%' },
  'M-118': { id: 'M-118', nome: 'Cadeiras livres no pico', unidade: 'cadeiras' },
  'M-119': { id: 'M-119', nome: 'Status no pico', unidade: 'rótulo' },
  'M-120': { id: 'M-120', nome: 'Média de cadeiras ocupadas ponderada', unidade: 'cadeiras' },
  'M-121': { id: 'M-121', nome: 'Taxa média de ocupação das mesas', unidade: '%' },
  'M-122': { id: 'M-122', nome: 'Total de entradas nas mesas', unidade: 'pessoas' },

  // 6. Cobertura e qualidade dos dados
  'M-90': { id: 'M-90', nome: 'Cobertura por fila (%)', unidade: '%' },
  'M-91': { id: 'M-91', nome: 'Lacunas de cobertura', unidade: 'intervalos' },
  'M-92': { id: 'M-92', nome: 'Pessoas afetadas por lacuna', unidade: 'pessoas' },
  'M-93': { id: 'M-93', nome: 'Eventos tardios', unidade: 'eventos' },
  'M-94': { id: 'M-94', nome: 'Comandos rejeitados', unidade: 'comandos' },
  'M-95': { id: 'M-95', nome: 'Auditoria de anulações, reversões e ajustes', unidade: 'eventos' },
  'M-96': { id: 'M-96', nome: 'Desconexões por aparelho', unidade: 'desconexões' },
  'M-97': { id: 'M-97', nome: 'Eventos por aparelho', unidade: 'eventos' },
  'M-98': { id: 'M-98', nome: 'Histórico de aparelhos por fila', unidade: '' },

  // 7. Comparação
  'M-100': { id: 'M-100', nome: 'Comparação lado a lado multi-sessão', unidade: '' }
};
