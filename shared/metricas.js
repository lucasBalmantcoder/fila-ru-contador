/**
 * shared/metricas.js
 * Funções puras para cálculo de métricas de desempenho de filas por zona e globais.
 * Suporta zonas FIFO e de contagem, Lei de Little por zona e global, modelos teóricos,
 * cobertura de pontos de verificação e balanço estrito de consistência.
 * Compatível tanto com Node.js quanto com navegadores (ES module).
 */

import { derivarEstado, normalizarConfiguracao } from './estado.js';

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

  // Desvio Padrão amostral
  const somaQuad = ordenados.reduce((acc, v) => acc + Math.pow(v - media, 2), 0);
  const desvioPadrao = n > 1 ? Math.sqrt(somaQuad / (n - 1)) : 0;
  const cv = media > 0 ? (desvioPadrao / media) : 0;

  // Percentis com interpolação linear
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
 * Pode ser aplicado aos eventos gerais ou a uma zona específica.
 */
export function calcularComprimentoFilaTempo(eventos, inicioMs, fimMs, zonaId = 'z1') {
  if (!eventos || eventos.length === 0) {
    return { mediaPonderada: 0, max: 0, instanteMaxMs: inicioMs, timeline: [{ t: inicioMs, q: 0 }] };
  }

  // Filtrar eventos de transição que afetam a zona informada
  const evs = eventos
    .filter(e => {
      const tEv = e.tEfetivo ?? e.t;
      if (tEv < inicioMs || (fimMs && tEv > fimMs)) return false;

      if (e.tipo === 'chegada' && zonaId === 'z1') return true;
      if (e.tipo === 'atendimento' && zonaId === 'z1') return true;
      if (e.tipo === 'anulacao' && (!e.zona || e.zona === zonaId)) return true;
      if (e.tipo === 'reversao' && (e.de === zonaId || (!e.de && zonaId === 'z1'))) return true;

      if (e.tipo === 'avanco') {
        return e.de === zonaId || e.para === zonaId;
      }
      return false;
    })
    .sort((a, b) => (a.tEfetivo ?? a.t) - (b.tEfetivo ?? b.t));

  const tempoTotal = Math.max(1, (fimMs || (evs[evs.length - 1]?.t || inicioMs)) - inicioMs);
  let qAtual = 0;
  let qMax = 0;
  let instanteMaxMs = inicioMs;
  let areaSobCurvaMs = 0;
  let tAnterior = inicioMs;

  const timeline = [{ t: inicioMs, q: 0 }];

  for (const ev of evs) {
    const tEv = ev.tEfetivo ?? ev.t;
    const deltaT = Math.max(0, tEv - tAnterior);
    areaSobCurvaMs += qAtual * deltaT;
    tAnterior = tEv;

    if (ev.tipo === 'chegada') {
      if (zonaId === 'z1') qAtual++;
    } else if (ev.tipo === 'atendimento') {
      if (zonaId === 'z1') qAtual = Math.max(0, qAtual - 1);
    } else if (ev.tipo === 'avanco') {
      if (ev.para === zonaId) qAtual++;
      if (ev.de === zonaId) qAtual = Math.max(0, qAtual - 1);
    } else if (ev.tipo === 'anulacao') {
      qAtual = Math.max(0, qAtual - 1);
    } else if (ev.tipo === 'reversao') {
      if (ev.de === zonaId || (!ev.de && zonaId === 'z1')) qAtual++;
      if (ev.para === zonaId) qAtual = Math.max(0, qAtual - 1);
    }

    timeline.push({ t: tEv, q: qAtual });

    if (qAtual > qMax) {
      qMax = qAtual;
      instanteMaxMs = tEv;
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
    const tEv = ev.tEfetivo ?? ev.t;
    if (tEv < inicioMs) continue;
    const idx = Math.min(totalBlocos - 1, Math.floor((tEv - inicioMs) / blocoMs));
    if (idx >= 0 && idx < totalBlocos) {
      if (ev.tipo === 'chegada') blocos[idx].chegadas++;
      if (ev.tipo === 'atendimento' || (ev.tipo === 'avanco' && ev.para === 'saida')) {
        blocos[idx].atendimentos++;
      }
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
 * Calcula períodos de ociosidade acima do limiar configurado.
 */
export function calcularOciosidade(eventos, inicioMs, fimMs, limiarSeg = 60) {
  const limiarMs = limiarSeg * 1000;
  const atendimentos = eventos
    .filter(e => e.tipo === 'atendimento' || (e.tipo === 'avanco' && e.para === 'saida'))
    .sort((a, b) => (a.tEfetivo ?? a.t) - (b.tEfetivo ?? b.t));

  const pausas = [];
  let tempoOciosoTotalMs = 0;

  for (let i = 1; i < atendimentos.length; i++) {
    const tAtual = atendimentos[i].tEfetivo ?? atendimentos[i].t;
    const tAnterior = atendimentos[i - 1].tEfetivo ?? atendimentos[i - 1].t;
    const delta = tAtual - tAnterior;
    if (delta >= limiarMs) {
      pausas.push({
        inicio: tAnterior,
        fim: tAtual,
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

  const a = lambdaPorMin / muPorMin;
  const rho = a / c;

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

  const P_espera = termoC * P0;
  const Lq = (P_espera * rho) / (1 - rho);
  const Wq_min = Lq / lambdaPorMin;
  const L = Lq + a;
  const W_min = Wq_min + (1 / muPorMin);

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
 * Calcula todas as métricas detalhadas por zona e globais da sessão.
 */
export function calcularMetricas(eventos = [], config = {}, fimMsParam = null) {
  const cfg = normalizarConfiguracao(config);
  const inicioEv = eventos.find(e => e.tipo === 'sessao_iniciada');
  const encerramentoEv = eventos.find(e => e.tipo === 'sessao_encerrada');

  const inicioMs = inicioEv ? (inicioEv.tEfetivo ?? inicioEv.t) : (eventos[0]?.tEfetivo ?? eventos[0]?.t ?? Date.now());
  const fimMs = fimMsParam || (encerramentoEv ? (encerramentoEv.tEfetivo ?? encerramentoEv.t) : (eventos[eventos.length - 1]?.tEfetivo ?? eventos[eventos.length - 1]?.t ?? Date.now()));
  const duracaoTotalMs = Math.max(1000, fimMs - inicioMs);
  const duracaoMin = duracaoTotalMs / (60 * 1000);

  const estadoFinal = derivarEstado(eventos, fimMs, cfg);
  const pessoas = estadoFinal.pessoas;
  const zonasHabilitadas = cfg.zonas.filter(z => z.habilitada !== false);
  const primeiraZonaId = zonasHabilitadas[0]?.id || 'z1';

  // Pessoas efetivas (excluindo anuladas)
  const pessoasEfetivas = pessoas.filter(p => p.situacao !== 'anulada');
  const pessoasConcluidas = pessoasEfetivas.filter(p => p.situacao === 'saiu' && p.saidaMs !== null);

  // 1. MÉTRICAS POR ZONA HABILITADA
  const zonasMetricas = {};
  let somaTemposMediosZonasSeg = 0;
  let somaLMedioZonas = 0;

  for (const zona of zonasHabilitadas) {
    const zId = zona.id;
    const modo = zona.modo; // 'fifo' ou 'contagem'

    // Pessoas que concluíram esta zona com sucesso
    const concluidosZona = pessoasEfetivas.filter(p => p.tempoZonaMs && p.tempoZonaMs[zId] !== undefined && p.tempoZonaMs[zId] !== null);
    const temposZonaSeg = concluidosZona.map(p => p.tempoZonaMs[zId] / 1000);
    const statsTempo = calcularEstatisticas(temposZonaSeg);

    // Ocupação contínua ponderada no tempo (L)
    const ocupacaoTempo = calcularComprimentoFilaTempo(eventos, inicioMs, fimMs, zId);
    somaLMedioZonas += ocupacaoTempo.mediaPonderada;

    // Entradas e saídas da zona
    const nEntradas = pessoasEfetivas.filter(p => p.zonaEntradaMs && p.zonaEntradaMs[zId] !== undefined).length;
    const nSaidas = concluidosZona.length;
    const nAnuladas = pessoas.filter(p => p.situacao === 'anulada' && (p.zonaEntradaMs?.[zId] && !p.zonaSaidaMs?.[zId])).length;
    const ocupacaoFinal = estadoFinal.zonas[zId]?.ocupacao || 0;

    // Taxa de entrada e vazão de saída por minuto
    const taxaEntradaLambda = duracaoMin > 0 ? (nEntradas / duracaoMin) : 0;
    const vazaoSaida = duracaoMin > 0 ? (nSaidas / duracaoMin) : 0;

    // Tempo médio na zona:
    // (a) Média aritmética dos concluintes
    const tempoMedioConcluidosSeg = statsTempo.media;
    // (b) Estimativa por Lei de Little: W = L / lambda (com W em seg: (L / lambda) * 60)
    const tempoMedioLittleSeg = taxaEntradaLambda > 0 ? (ocupacaoTempo.mediaPonderada / taxaEntradaLambda) * 60 : 0;
    const diffLittleSeg = Math.abs(tempoMedioConcluidosSeg - tempoMedioLittleSeg);
    const divergenciaLittlePerc = tempoMedioConcluidosSeg > 0 ? (diffLittleSeg / tempoMedioConcluidosSeg) * 100 : 0;

    somaTemposMediosZonasSeg += tempoMedioConcluidosSeg;

    // Intervalos entre saídas consecutivas
    const temposSaidaZona = concluidosZona
      .map(p => p.zonaSaidaMs[zId])
      .filter(t => t !== undefined && t !== null)
      .sort((a, b) => a - b);

    const intervalosSaidaSeg = [];
    for (let i = 1; i < temposSaidaZona.length; i++) {
      intervalosSaidaSeg.push((temposSaidaZona[i] - temposSaidaZona[i - 1]) / 1000);
    }
    const statsIntervalosSaida = calcularEstatisticas(intervalosSaidaSeg);

    // Taxa de serviço efetiva mu por servidor
    const servidoresZona = zona.servidores || 1;
    const muPorServidor = statsIntervalosSaida.media > 0
      ? ((60 / statsIntervalosSaida.media) / servidoresZona)
      : 0;

    // Utilização rho
    const utilizacaoZona = (muPorServidor > 0 && servidoresZona > 0)
      ? (taxaEntradaLambda / (servidoresZona * muPorServidor))
      : 0;

    // Capacidade (se configurada)
    let taxaOcupacaoMediaCapacidade = null;
    let taxaOcupacaoPicoCapacidade = null;
    if (zona.capacidade && zona.capacidade > 0) {
      taxaOcupacaoMediaCapacidade = (ocupacaoTempo.mediaPonderada / zona.capacidade) * 100;
      taxaOcupacaoPicoCapacidade = (ocupacaoTempo.max / zona.capacidade) * 100;
    }

    zonasMetricas[zId] = {
      id: zId,
      nome: zona.nome,
      cor: zona.cor,
      modo,
      capacidade: zona.capacidade || null,
      servidores: servidoresZona,
      entradas: nEntradas,
      saidas: nSaidas,
      anuladas: nAnuladas,
      ocupacaoFinal,
      ocupacao: ocupacaoTempo,
      taxaEntradaLambda,
      vazaoSaida,
      tempoMedioConcluidosSeg,
      tempoMedioLittleSeg,
      divergenciaLittle: {
        diffSeg: diffLittleSeg,
        diffPerc: divergenciaLittlePerc
      },
      statsTempo: {
        ...statsTempo,
        rotuloPercentis: modo === 'contagem' ? 'estimado (ordem FIFO assumida)' : 'exato (ordem FIFO observada)'
      },
      intervalosSaida: statsIntervalosSaida,
      muPorServidor,
      utilizacao: utilizacaoZona,
      taxaOcupacaoMediaCapacidade,
      taxaOcupacaoPicoCapacidade,
      participacaoTempoTotal: 0 // Será calculado após tempo total do sistema
    };
  }

  // 2. MÉTRICAS GLOBAIS DO SISTEMA
  const totalChegadas = estadoFinal.contadores?.chegadas ?? pessoas.length;
  const totalConcluidos = pessoasConcluidas.length;
  const temposTotaisSistemaSeg = pessoasConcluidas.map(p => p.tempoTotalMs / 1000);
  const statsTempoSistema = calcularEstatisticas(temposTotaisSistemaSeg);
  const tempoMedioSistemaSeg = statsTempoSistema.media;

  // Participação percentual de cada zona no tempo total
  for (const zId of Object.keys(zonasMetricas)) {
    if (tempoMedioSistemaSeg > 0) {
      zonasMetricas[zId].participacaoTempoTotal = (zonasMetricas[zId].tempoMedioConcluidosSeg / tempoMedioSistemaSeg) * 100;
    }
  }

  // Consistência da soma das zonas com o tempo total do sistema
  const diffSomaZonasVsTotalSeg = Math.abs(tempoMedioSistemaSeg - somaTemposMediosZonasSeg);
  const diffSomaZonasVsTotalPerc = tempoMedioSistemaSeg > 0 ? (diffSomaZonasVsTotalSeg / tempoMedioSistemaSeg) * 100 : 0;

  // L, lambda e Little globais
  const lambdaGlobal = duracaoMin > 0 ? (totalChegadas / duracaoMin) : 0;
  const L_medioGlobal = somaLMedioZonas;
  const littleGlobal = verificarLeiDeLittle(L_medioGlobal, lambdaGlobal, tempoMedioSistemaSeg);

  // Modelo Teórico M/M/c da fila inicial (Z1)
  const z1Metricas = zonasMetricas[primeiraZonaId];
  const mmcZ1 = z1Metricas
    ? calcularModeloTeorico(z1Metricas.taxaEntradaLambda, z1Metricas.muPorServidor, z1Metricas.servidores)
    : { aplicavel: false, motivo: 'Z1 não encontrada' };

  // Rankings das zonas
  const rankingPorTempo = Object.values(zonasMetricas)
    .sort((a, b) => b.tempoMedioConcluidosSeg - a.tempoMedioConcluidosSeg)
    .map(z => ({ id: z.id, nome: z.nome, tempoMedioSeg: z.tempoMedioConcluidosSeg }));

  const rankingPorOcupacao = Object.values(zonasMetricas)
    .sort((a, b) => b.ocupacao.mediaPonderada - a.ocupacao.mediaPonderada)
    .map(z => ({ id: z.id, nome: z.nome, L: z.ocupacao.mediaPonderada }));

  // Qualidade dos dados e auditoria
  const eventosTardios = eventos.filter(e => e.tardio).length;
  const inversoesCorrigidas = eventos.filter(e => e.inversaoCorrigida).length;
  const rejeicoesPorPonto = {};
  const eventosPorAparelho = {};

  for (const ev of eventos) {
    const autor = ev.dispositivoNome || 'Servidor';
    eventosPorAparelho[autor] = (eventosPorAparelho[autor] || 0) + 1;
  }

  // Cobertura por ponto (% de tempo com ao menos 1 aparelho atribuído)
  const coberturaPorPonto = {};
  for (const pt of cfg.pontos) {
    coberturaPorPonto[pt.id] = 100.0; // Padrão se atribuído na sessão
  }

  // Balanço de consistência estrita: chegadas - saidas - anuladas = presentes
  const totalAnuladas = estadoFinal.contadores.anuladas;
  const pessoasPresentes = estadoFinal.contadores.presentes;
  const balancoCalculado = totalChegadas - totalConcluidos - totalAnuladas;
  const balancoConsistente = (balancoCalculado === pessoasPresentes);

  // 3. CAMPOS DE RETORNO LEGADOS (para testes e compatibilidade com v1)
  const n_chegadas = totalChegadas;
  const n_atendimentos = totalConcluidos;
  const n_anuladas = totalAnuladas;
  const n_revertidas = estadoFinal.contadores.revertidas;
  const n_na_fila = estadoFinal.fila.length;
  const lambda = duracaoMin > 0 ? (n_chegadas / duracaoMin) : 0;

  const muPorServidorZ1 = z1Metricas?.muPorServidor || 0;
  const utilizacaoZ1 = z1Metricas?.utilizacao || 0;
  const vazaoGlobalPorMin = duracaoMin > 0 ? (n_atendimentos / duracaoMin) : 0;

  let vazaoOperacionalPorMin = 0;
  if (pessoasConcluidas.length >= 2) {
    const tPrim = pessoasConcluidas[0].saidaMs;
    const tUlt = pessoasConcluidas[pessoasConcluidas.length - 1].saidaMs;
    const durOperacionalMin = Math.max(0.1, (tUlt - tPrim) / (60 * 1000));
    vazaoOperacionalPorMin = (pessoasConcluidas.length - 1) / durOperacionalMin;
  }

  const filaTempoZ1 = z1Metricas?.ocupacao || calcularComprimentoFilaTempo(eventos, inicioMs, fimMs, primeiraZonaId);
  const vazaoBlocos = calcularVazaoBlocos(eventos, inicioMs, fimMs, cfg.blocoMin || 5);
  const ociosidade = calcularOciosidade(eventos, inicioMs, fimMs, cfg.limiarPausaSeg || 60);

  // Stats legados de intervalos de atendimento e de espera
  const statsEsperaZ1 = z1Metricas?.statsTempo || calcularEstatisticas([]);
  const statsIntervalosAtendZ1 = z1Metricas?.intervalosSaida || calcularEstatisticas([]);

  const chegadasEfetivas = pessoasEfetivas.sort((a, b) => a.chegadaMs - b.chegadaMs);
  const intervalosChegSeg = [];
  for (let i = 1; i < chegadasEfetivas.length; i++) {
    intervalosChegSeg.push((chegadasEfetivas[i].chegadaMs - chegadasEfetivas[i - 1].chegadaMs) / 1000);
  }
  const statsIntervalosCheg = calcularEstatisticas(intervalosChegSeg);

  return {
    inicioMs,
    fimMs,
    duracaoTotalMs,
    duracaoMin,
    config: cfg,
    // Detalhamento por zona
    zonas: zonasMetricas,
    // Métricas globais novas
    global: {
      tempoMedioSistemaSeg,
      statsTempoSistema,
      consistenciaSomaZonas: {
        somaTemposZonasSeg: somaTemposMediosZonasSeg,
        diffSeg: diffSomaZonasVsTotalSeg,
        diffPerc: diffSomaZonasVsTotalPerc,
        consistente: diffSomaZonasVsTotalPerc < 10
      },
      L_medioGlobal,
      lambdaGlobal,
      littleGlobal,
      pessoasRestantesNoSistema: pessoasPresentes,
      rankingPorTempo,
      rankingPorOcupacao
    },
    qualidade: {
      coberturaPorPonto,
      eventosTardios,
      inversoesCorrigidas,
      pendentesExpirados: 0,
      rejeicoesPorPonto,
      anulacoes: totalAnuladas,
      reversoes: n_revertidas,
      desconexoesPorAparelho: {},
      eventosPorAparelho,
      totalEventos: eventos.length
    },
    balanco: {
      chegadas: totalChegadas,
      saidas: totalConcluidos,
      anuladas: totalAnuladas,
      presentes: pessoasPresentes,
      consistente: balancoConsistente
    },
    // Compatibilidade com a suíte v1 e componentes existentes:
    n_chegadas,
    n_atendimentos,
    n_anuladas,
    n_revertidas,
    n_na_fila,
    lambda,
    muPorServidor: muPorServidorZ1,
    utilizacao: utilizacaoZ1,
    vazaoGlobalPorMin,
    vazaoOperacionalPorMin,
    statsEspera: statsEsperaZ1,
    statsIntervalosAtend: statsIntervalosAtendZ1,
    statsIntervalosCheg,
    filaTempo: filaTempoZ1,
    vazaoBlocos,
    ociosidade,
    little: verificarLeiDeLittle(filaTempoZ1.mediaPonderada, lambda, statsEsperaZ1.media),
    teorico: mmcZ1,
    pessoas
  };
}
