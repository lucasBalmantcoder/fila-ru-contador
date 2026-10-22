/**
 * shared/metricas.js
 * Funções puras para cálculo de métricas de desempenho de filas.
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
 * Calcula o comprimento da fila ponderado no tempo (área contínua sob o gráfico / duração).
 */
export function calcularComprimentoFilaTempo(eventos, inicioMs, fimMs) {
  if (!eventos || eventos.length === 0) {
    return { mediaPonderada: 0, max: 0, instanteMaxMs: inicioMs, timeline: [] };
  }

  const evs = eventos
    .filter(e => e.tipo === 'chegada' || e.tipo === 'atendimento' || e.tipo === 'anulacao' || e.tipo === 'reversao')
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
 * Vazão e chegadas divididas por blocos temporais (ex: blocos de 5 min).
 */
export function calcularVazaoBlocos(eventos, inicioMs, fimMs, blocoMin = 5) {
  const blocoMs = blocoMin * 60 * 1000;
  const fimEfetivo = fimMs || Date.now();
  const duracaoTotal = Math.max(blocoMs, fimEfetivo - inicioMs);
  const totalBlocos = Math.max(1, Math.ceil(duracaoTotal / blocoMs));

  const blocos = [];
  for (let i = 0; i < totalBlocos; i++) {
    const tIniBloco = inicioMs + i * blocoMs;
    const tFimBloco = tIniBloco + blocoMs;
    blocos.push({
      indice: i + 1,
      rotulo: `${i * blocoMin}-${(i + 1) * blocoMin}m`,
      tInicio: tIniBloco,
      tFim: tFimBloco,
      chegadas: 0,
      atendimentos: 0,
      vazaoPorMin: 0
    });
  }

  for (const ev of eventos) {
    if (ev.t < inicioMs) continue;
    const idx = Math.min(totalBlocos - 1, Math.floor((ev.t - inicioMs) / blocoMs));
    if (idx >= 0 && idx < totalBlocos) {
      if (ev.tipo === 'chegada') blocos[idx].chegadas++;
      if (ev.tipo === 'atendimento') blocos[idx].atendimentos++;
    }
  }

  for (const b of blocos) {
    b.vazaoPorMin = b.atendimentos / blocoMin;
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
 * Calcula períodos de ociosidade da catraca acima do limiar configurado,
 * considerando somente períodos em que havia fila aguardando.
 */
export function calcularOciosidade(eventos, inicioMs, fimMs, limiarSeg = 60) {
  const limiarMs = limiarSeg * 1000;
  const atendimentos = eventos
    .filter(e => e.tipo === 'atendimento')
    .sort((a, b) => a.t - b.t);

  const pausas = [];
  let tempoOciosoTotalMs = 0;

  for (let i = 1; i < atendimentos.length; i++) {
    const delta = atendimentos[i].t - atendimentos[i - 1].t;
    if (delta >= limiarMs) {
      pausas.push({
        inicio: atendimentos[i - 1].t,
        fim: atendimentos[i].t,
        duracaoMs: delta
      });
      tempoOciosoTotalMs += delta;
    }
  }

  const duracaoTotal = Math.max(1, (fimMs || Date.now()) - inicioMs);
  const percentualOcioso = (tempoOciosoTotalMs / duracaoTotal) * 100;

  return {
    qtdPausas: pausas.length,
    tempoOciosoTotalMs,
    percentualOcioso,
    pausas
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
 * Calcula todas as métricas analíticas e estatísticas da sessão.
 */
export function calcularMetricas(eventos = [], config = {}, fimMsParam = null) {
  const inicioEv = eventos.find(e => e.tipo === 'sessao_iniciada');
  const encerramentoEv = eventos.find(e => e.tipo === 'sessao_encerrada');

  const inicioMs = inicioEv ? inicioEv.t : (eventos[0]?.t || Date.now());
  const fimMs = fimMsParam || (encerramentoEv ? encerramentoEv.t : (eventos[eventos.length - 1]?.t || Date.now()));
  const duracaoTotalMs = Math.max(1000, fimMs - inicioMs);
  const duracaoMin = duracaoTotalMs / (60 * 1000);

  const estadoFinal = derivarEstado(eventos, fimMs);
  const pessoas = estadoFinal.pessoas;

  // Filtrar pessoas efetivas (excluindo anuladas)
  const pessoasEfetivas = pessoas.filter(p => p.status !== 'anulada');
  const pessoasAtendidas = pessoasEfetivas.filter(p => p.status === 'atendida' && p.atendimentoMs !== null);

  const n_chegadas = pessoasEfetivas.length;
  const n_atendimentos = pessoasAtendidas.length;
  const n_anuladas = estadoFinal.contadores.anuladas;
  const n_revertidas = estadoFinal.contadores.revertidas;
  const n_na_fila = estadoFinal.fila.length;

  // Taxa de Chegada efetiva lambda (pessoas/minuto)
  const lambda = duracaoMin > 0 ? (n_chegadas / duracaoMin) : 0;

  // Intervalos de atendimento e Taxa de Serviço mu
  const intervalosAtendSeg = pessoasAtendidas
    .filter(p => p.intervaloAtendimentoMs !== null)
    .map(p => p.intervaloAtendimentoMs / 1000);
  const statsIntervalosAtend = calcularEstatisticas(intervalosAtendSeg);

  const servidores = config.servidores || 1;
  const mediaIntervaloSeg = statsIntervalosAtend.media;
  const muPorServidor = mediaIntervaloSeg > 0 ? ((60 / mediaIntervaloSeg) / servidores) : 0;

  // Fator de utilização rho
  const utilizacao = (muPorServidor > 0 && servidores > 0)
    ? (lambda / (servidores * muPorServidor))
    : 0;

  // Vazão Global e Operacional
  const vazaoGlobalPorMin = duracaoMin > 0 ? (n_atendimentos / duracaoMin) : 0;
  let vazaoOperacionalPorMin = 0;
  if (pessoasAtendidas.length >= 2) {
    const tPrim = pessoasAtendidas[0].atendimentoMs;
    const tUlt = pessoasAtendidas[pessoasAtendidas.length - 1].atendimentoMs;
    const durOperacionalMin = Math.max(0.1, (tUlt - tPrim) / (60 * 1000));
    vazaoOperacionalPorMin = (pessoasAtendidas.length - 1) / durOperacionalMin;
  }

  // Tempos de Espera
  const temposEsperaSeg = pessoasAtendidas
    .filter(p => p.esperaMs !== null)
    .map(p => p.esperaMs / 1000);
  const statsEspera = calcularEstatisticas(temposEsperaSeg);

  // Intervalos entre Chegadas
  const chegadasEfetivas = pessoasEfetivas.sort((a, b) => a.chegadaMs - b.chegadaMs);
  const intervalosChegSeg = [];
  for (let i = 1; i < chegadasEfetivas.length; i++) {
    intervalosChegSeg.push((chegadasEfetivas[i].chegadaMs - chegadasEfetivas[i - 1].chegadaMs) / 1000);
  }
  const statsIntervalosCheg = calcularEstatisticas(intervalosChegSeg);

  // Comprimento da Fila no Tempo
  const filaTempo = calcularComprimentoFilaTempo(eventos, inicioMs, fimMs);

  // Agregação por Blocos
  const vazaoBlocos = calcularVazaoBlocos(eventos, inicioMs, fimMs, config.blocoMin || 5);

  // Ociosidade
  const ociosidade = calcularOciosidade(eventos, inicioMs, fimMs, config.limiarPausaSeg || 60);

  // Lei de Little
  const little = verificarLeiDeLittle(filaTempo.mediaPonderada, lambda, statsEspera.media);

  // Modelo Teórico
  const teorico = calcularModeloTeorico(lambda, muPorServidor, servidores);

  // Qualidade dos dados
  const eventosTardios = eventos.filter(e => e.tardio).length;
  const eventosPorAparelho = {};
  for (const ev of eventos) {
    const nome = ev.dispositivoNome || 'Servidor';
    eventosPorAparelho[nome] = (eventosPorAparelho[nome] || 0) + 1;
  }

  return {
    inicioMs,
    fimMs,
    duracaoTotalMs,
    duracaoMin,
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
    qualidade: {
      eventosTardios,
      totalEventos: eventos.length,
      eventosPorAparelho
    },
    pessoas
  };
}

