/**
 * shared/simulador.js
 * Motor Isomórfico de Simulação de Eventos Discretos Guiada por Traço Histórico (Trace-Driven DES).
 * Avalia cenários hipotéticos ("What-If") para dimensionamento de catracas, buffets e salão de mesas.
 * Compatível tanto com Node.js (ES Module) quanto com Navegadores (ES Module).
 */

import { calcularMetricas } from './metricas.js';
import { derivarEstado } from './estado.js';

/**
 * Simula uma sessão completa a partir do traço histórico de eventos reais.
 *
 * @param {Array<Object>} eventosReais - Lista ordenada de eventos da sessão real.
 * @param {Object} [configSessao={}] - Configuração da sessão original.
 * @param {Object} [paramsSimulacao={}] - Parâmetros do cenário "What-If":
 *        - c1: número de catracas em paralelo (Fila 1, padrão: 1).
 *        - modoF1: 'taxa' ou 'tempoFixo' (padrão: 'taxa').
 *        - fatorF1: variação percentual na taxa (-50 a +100, padrão: 0).
 *        - tempoFixoF1: tempo de serviço fixo em segundos (2 a 30, padrão: 5).
 *        - c2: número de linhas de buffet em paralelo (Fila 2, padrão: 1).
 *        - fatorF2: variação percentual na taxa da Fila 2 (-50 a +100, padrão: 0).
 *        - capacidadeMesas: capacidade nominal de assentos (padrão: 216).
 *        - deltaMinutosMesas: deslocamento em minutos no tempo de refeição (-10 a +15, padrão: 0).
 * @param {number} [seed=12345] - Semente para determinismo (LCG).
 * @returns {Object} Resultado com eventos simulados, métricas simuladas, métricas reais, calibração e diagnóstico.
 */
export function simularSessao(eventosReais = [], configSessao = {}, paramsSimulacao = {}, seed = 12345) {
  if (!Array.isArray(eventosReais) || eventosReais.length === 0) {
    return {
      sucesso: false,
      motivo: 'Sessão sem eventos registrados.',
      eventosSimulados: [],
      metricasSimuladas: null,
      metricasReais: null,
      calibracao: null,
      diagnostico: null
    };
  }

  // 1. Identificar eventos estruturais da sessão original
  const evInicio = eventosReais.find(e => e.tipo === 'sessao_iniciada');
  const evFim = eventosReais.find(e => e.tipo === 'sessao_encerrada');
  const tInicio = evInicio?.t || eventosReais[0].t;
  const tFimReal = evFim?.t || eventosReais[eventosReais.length - 1].t;

  const cfgOrig = {
    servidores: 1,
    filasAtivas: [1, 2, 3],
    ...configSessao,
    ...(evInicio?.config?.config || evInicio?.config || {})
  };

  // Parâmetros normalizados da simulação
  const c1 = Math.max(1, parseInt(paramsSimulacao.c1, 10) || cfgOrig.servidores || 1);
  const c2 = Math.max(1, parseInt(paramsSimulacao.c2, 10) || 1);
  const modoF1 = paramsSimulacao.modoF1 === 'tempoFixo' ? 'tempoFixo' : 'taxa';
  const fatorF1 = Number(paramsSimulacao.fatorF1 || 0); // ex: +20% ou -20%
  const tempoFixoF1Ms = Math.max(2000, (Number(paramsSimulacao.tempoFixoF1) || 5) * 1000);
  const fatorF2 = Number(paramsSimulacao.fatorF2 || 0);
  const capacidadeMesas = Math.max(1, parseInt(paramsSimulacao.capacidadeMesas, 10) || cfgOrig.capacidadeMesas || 216);
  const deltaMinutosMesasMs = (Number(paramsSimulacao.deltaMinutosMesas) || 0) * 60 * 1000;

  // 2. Extrair estado consolidado da sessão original
  const estadoOriginal = derivarEstado(eventosReais);
  const todasPessoasOrig = estadoOriginal.pessoas || [];

  // Pessoas efetivas da Fila 1 (exclui anulações reais)
  const pessoasF1Originais = todasPessoasOrig
    .filter(p => (p.fila || 1) === 1 && p.status !== 'anulada')
    .sort((a, b) => (a.chegadaMs ?? tInicio) - (b.chegadaMs ?? tInicio) || a.pessoa - b.pessoa);

  if (pessoasF1Originais.length === 0) {
    return {
      sucesso: false,
      motivo: 'Nenhuma chegada válida registrada na Fila 1.',
      eventosSimulados: [],
      metricasSimuladas: null,
      metricasReais: null,
      calibracao: null,
      diagnostico: null
    };
  }

  // 3. Dedução dos tempos de serviço puros observados na Fila 1 e Fila 2
  const atendimentosF1 = pessoasF1Originais
    .filter(p => p.atendimentoMs !== null)
    .sort((a, b) => a.atendimentoMs - b.atendimentoMs);

  let ultimoAtendF1 = tInicio;
  const mapServicoPuroF1 = new Map();
  const servicosF1Validos = [];

  for (const p of atendimentosF1) {
    const iniServ = Math.max(p.chegadaMs ?? tInicio, ultimoAtendF1);
    const dur = p.atendimentoMs - iniServ;
    if (dur > 0) {
      mapServicoPuroF1.set(p.pessoa, dur);
      if (dur <= 45000) {
        servicosF1Validos.push(dur);
      }
    }
    ultimoAtendF1 = p.atendimentoMs;
  }

  servicosF1Validos.sort((a, b) => a - b);
  const medianaS1 = servicosF1Validos.length > 0
    ? servicosF1Validos[Math.floor(servicosF1Validos.length / 2)]
    : 4000;

  // Instante de abertura das catracas
  const primeiroAlunoF1 = atendimentosF1[0];
  const esperaPrimeiroF1 = primeiroAlunoF1 ? (primeiroAlunoF1.atendimentoMs - (primeiroAlunoF1.chegadaMs ?? tInicio)) : 0;
  // Se o primeiro aluno aguardou > 45s antes da catraca abrir, o início de operação coincide com o primeiro atendimento menos a mediana de serviço
  const tAberturaF1 = (esperaPrimeiroF1 > 45000)
    ? Math.max(tInicio, primeiroAlunoF1.atendimentoMs - medianaS1)
    : tInicio;

  // Multiplicadores da taxa: taxa + X% => tempo * (1 / (1 + X/100))
  const multTempoF1 = 1 / (1 + (fatorF1 / 100));
  const multTempoF2 = 1 / (1 + (fatorF2 / 100));

  // Mapa de tempos de serviço observados F2
  const pessoasF2Orig = todasPessoasOrig.filter(p => p.fila === 2 && p.status === 'atendida');
  const mapServicoPuroF2 = new Map();
  const servicosF2Validos = [];

  for (const p of pessoasF2Orig) {
    const intv = p.intervaloAtendimentoMs;
    if (typeof intv === 'number' && intv > 0 && intv <= 60000) {
      mapServicoPuroF2.set(p.pessoa, intv);
      servicosF2Validos.push(intv);
    } else if (p.atendimentoMs && p.chegadaMs && (p.atendimentoMs - p.chegadaMs) > 0) {
      const dur = Math.min(60000, p.atendimentoMs - p.chegadaMs);
      mapServicoPuroF2.set(p.pessoa, dur);
      servicosF2Validos.push(dur);
    }
  }

  servicosF2Validos.sort((a, b) => a - b);
  const medianaS2 = servicosF2Validos.length > 0
    ? servicosF2Validos[Math.floor(servicosF2Validos.length / 2)]
    : 7000;

  // Duração empírica nas mesas (F3)
  const pessoasF3Orig = todasPessoasOrig.filter(p => p.fila === 3 && p.status === 'atendida');
  const mapPermanenciaMesas = new Map();
  const permanenciasValidas = [];

  for (const p of pessoasF3Orig) {
    if (p.atendimentoMs && p.chegadaMs && p.atendimentoMs > p.chegadaMs) {
      const dur = p.atendimentoMs - p.chegadaMs;
      mapPermanenciaMesas.set(p.pessoa, dur);
      permanenciasValidas.push(dur);
    }
  }

  permanenciasValidas.sort((a, b) => a - b);
  const medianaMesas = permanenciasValidas.length > 0
    ? permanenciasValidas[Math.floor(permanenciasValidas.length / 2)]
    : 20 * 60 * 1000; // 20 min padrão

  // 4. Simulação da Fila 1 (M/G/c1 FIFO compartilhada com despacho paralelo)
  const servidoresF1 = new Array(c1).fill(tAberturaF1);
  const alunosSimulados = [];

  for (const ch of pessoasF1Originais) {
    const pId = ch.pessoa;
    const tChegada = ch.chegadaMs ?? tInicio;

    // Obter tempo de serviço simulado
    let s1Sim;
    if (modoF1 === 'tempoFixo') {
      s1Sim = tempoFixoF1Ms;
    } else {
      let s1Real = mapServicoPuroF1.get(pId) || medianaS1;
      // Em simulação com múltiplas catracas ou aceleração, pausas extremas são limitadas à mediana
      if ((c1 > 1 || fatorF1 !== 0) && s1Real > 45000) {
        s1Real = medianaS1;
      }
      // Primeiro aluno na abertura das portas tem tempo puro igual à mediana
      if (primeiroAlunoF1 && pId === primeiroAlunoF1.pessoa && s1Real > 45000) {
        s1Real = medianaS1;
      }
      s1Sim = Math.max(2000, Math.round(s1Real * multTempoF1));
    }

    // Alocar servidor de F1 com menor tempo livre (desempate determinístico pelo menor índice k)
    let kMin = 0;
    for (let k = 1; k < c1; k++) {
      if (servidoresF1[k] < servidoresF1[kMin]) {
        kMin = k;
      }
    }

    const tIniServF1 = Math.max(tChegada, servidoresF1[kMin]);
    const tFimServF1 = tIniServF1 + s1Sim;
    servidoresF1[kMin] = tFimServF1;

    // Tempo de serviço F2
    const s2Real = mapServicoPuroF2.get(pId) || medianaS2;
    const s2Sim = Math.max(3000, Math.round(s2Real * multTempoF2));

    // Tempo nas mesas
    const sMesasReal = mapPermanenciaMesas.get(pId) || medianaMesas;
    const sMesasSim = Math.max(60000, Math.round(sMesasReal + deltaMinutosMesasMs));

    alunosSimulados.push({
      pessoa: pId,
      tCheg1: tChegada,
      tIni1: tIniServF1,
      tAtend1: tFimServF1,
      s1: s1Sim,
      s2: s2Sim,
      sMesas: sMesasSim,
      ajuste: !!ch.ajuste,
      // Fila 2 e Mesas a preencher na simulação encadeada
      tCheg2: tFimServF1,
      tIni2: null,
      tFimPreparo2: null,
      tAtend2: null,
      tCheg3: null,
      tAtend3: null,
      bloqueadoMesasMs: 0
    });
  }

  // 4. Simulação Encadeada da Fila 2 e Salão de Mesas com Service Blocking
  // Ordenar chegadas na F2 pelo término da F1 (preservando consistência temporal)
  alunosSimulados.sort((a, b) => a.tCheg2 - b.tCheg2 || a.pessoa - b.pessoa);

  // Estruturas de simulação para F2 e Salão
  const servidoresF2 = Array.from({ length: c2 }, (_, i) => ({
    id: i + 1,
    livreEm: tInicio,
    bloqueadoPor: null
  }));

  // Fila de mesas ocupadas ordenada por tDesocupacao
  const mesasOcupadas = [];
  const filaEsperaF2 = [];
  let filaEsperaHead = 0;
  const filaBloqueadosMesas = [];

  let tempoTotalBloqueioMs = 0;
  let alunosBloqueadosCount = 0;
  let picoOcupacaoMesas = 0;

  const eventosSimF2 = [];
  for (const a of alunosSimulados) {
    eventosSimF2.push({ tipo: 'CHEGADA_F2', t: a.tCheg2, aluno: a });
  }
  eventosSimF2.sort((a, b) => a.t - b.t);

  function inserirEvento(ev) {
    let low = evHead, high = eventosSimF2.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (eventosSimF2[mid].t <= ev.t) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    eventosSimF2.splice(low, 0, ev);
  }

  function inserirMesa(item) {
    let low = 0, high = mesasOcupadas.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (mesasOcupadas[mid].tDesocupacao <= item.tDesocupacao) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    mesasOcupadas.splice(low, 0, item);
    if (mesasOcupadas.length > picoOcupacaoMesas) {
      picoOcupacaoMesas = mesasOcupadas.length;
    }
  }

  function despacharProximoF2(servId, tAtual) {
    const serv = servidoresF2.find(s => s.id === servId);
    if (!serv || serv.bloqueadoPor !== null) return;

    if (filaEsperaHead < filaEsperaF2.length) {
      const proxAluno = filaEsperaF2[filaEsperaHead++];
      const tIni = Math.max(tAtual, serv.livreEm);
      const tFim = tIni + proxAluno.s2;
      proxAluno.tIni2 = tIni;
      proxAluno.tFimPreparo2 = tFim;
      serv.livreEm = tFim;

      inserirEvento({ tipo: 'FIM_PREPARO_F2', t: tFim, aluno: proxAluno, servId });
    }
  }

  let evHead = 0;
  while (evHead < eventosSimF2.length) {
    const ev = eventosSimF2[evHead++];
    if (evHead > 2000 && evHead > eventosSimF2.length / 2) {
      eventosSimF2.splice(0, evHead);
      evHead = 0;
    }
    const tAtual = ev.t;

    // Atualizar liberação de mesas anteriores a tAtual
    while (mesasOcupadas.length > 0 && mesasOcupadas[0].tDesocupacao <= tAtual) {
      const mSaindo = mesasOcupadas.shift();
      mSaindo.aluno.tAtend3 = mSaindo.tDesocupacao;

      // Se havia alguém bloqueado esperando mesa, alocar a cadeira imediatamente (FIFO de bloqueio)
      if (filaBloqueadosMesas.length > 0) {
        const itemBloq = filaBloqueadosMesas.shift();
        const aBloq = itemBloq.aluno;
        const sBloq = servidoresF2.find(s => s.id === itemBloq.servId);

        const durBloq = mSaindo.tDesocupacao - aBloq.tFimPreparo2;
        aBloq.bloqueadoMesasMs = Math.max(0, durBloq);
        tempoTotalBloqueioMs += aBloq.bloqueadoMesasMs;

        aBloq.tAtend2 = mSaindo.tDesocupacao;
        aBloq.tCheg3 = mSaindo.tDesocupacao;
        const tFimMesaBloq = aBloq.tCheg3 + aBloq.sMesas;

        inserirMesa({ aluno: aBloq, tDesocupacao: tFimMesaBloq });
        inserirEvento({ tipo: 'LIBERA_MESA', t: tFimMesaBloq, aluno: aBloq });

        if (sBloq) {
          sBloq.bloqueadoPor = null;
          sBloq.livreEm = mSaindo.tDesocupacao;
          despacharProximoF2(sBloq.id, mSaindo.tDesocupacao);
        }
      }
    }

    if (ev.tipo === 'CHEGADA_F2') {
      const aluno = ev.aluno;
      let servLivre = null;
      for (const s of servidoresF2) {
        if (s.bloqueadoPor === null && s.livreEm <= tAtual) {
          servLivre = s;
          break;
        }
      }

      if (servLivre) {
        const tIni = Math.max(tAtual, servLivre.livreEm);
        const tFim = tIni + aluno.s2;
        aluno.tIni2 = tIni;
        aluno.tFimPreparo2 = tFim;
        servLivre.livreEm = tFim;
        inserirEvento({ tipo: 'FIM_PREPARO_F2', t: tFim, aluno, servId: servLivre.id });
      } else {
        filaEsperaF2.push(aluno);
      }
    } else if (ev.tipo === 'FIM_PREPARO_F2') {
      const aluno = ev.aluno;
      const servId = ev.servId;
      const serv = servidoresF2.find(s => s.id === servId);

      if (mesasOcupadas.length < capacidadeMesas) {
        aluno.tAtend2 = tAtual;
        aluno.tCheg3 = tAtual;
        const tFimMesa = tAtual + aluno.sMesas;

        inserirMesa({ aluno, tDesocupacao: tFimMesa });
        inserirEvento({ tipo: 'LIBERA_MESA', t: tFimMesa, aluno });

        if (serv) {
          serv.bloqueadoPor = null;
          serv.livreEm = tAtual;
          despacharProximoF2(servId, tAtual);
        }
      } else {
        alunosBloqueadosCount++;
        if (serv) {
          serv.bloqueadoPor = aluno.pessoa;
        }
        filaBloqueadosMesas.push({ aluno, servId });
      }
    } else if (ev.tipo === 'LIBERA_MESA') {
      // Tratado no início do loop
    }
  }

  // Descarregar mesas restantes para garantir término de refeição
  while (mesasOcupadas.length > 0) {
    const m = mesasOcupadas.shift();
    m.aluno.tAtend3 = m.tDesocupacao;
  }

  // 5. Construção do Log de Eventos Simulados conforme o contrato estrito
  const eventosGerados = [];

  // Início da sessão
  eventosGerados.push({
    seq: 1,
    t: tInicio,
    tipo: 'sessao_iniciada',
    fila: 1,
    pessoa: null,
    origem: 'simulado',
    config: {
      ...cfgOrig,
      servidoresPorFila: { 1: c1, 2: c2, 3: 1 },
      capacidadeMesas
    }
  });

  for (const a of alunosSimulados) {
    // 1. Chegada Fila 1
    eventosGerados.push({
      t: a.tCheg1,
      tipo: 'chegada',
      fila: 1,
      pessoa: a.pessoa,
      encadeado: false,
      ajuste: a.ajuste || false,
      origem: 'simulado'
    });

    // 2. Atendimento Fila 1 (saída da catraca)
    eventosGerados.push({
      t: a.tAtend1,
      tipo: 'atendimento',
      fila: 1,
      pessoa: a.pessoa,
      encadeado: false,
      ajuste: a.ajuste || false,
      origem: 'simulado'
    });

    // 3. Chegada Fila 2 (encadeada atômica)
    eventosGerados.push({
      t: a.tCheg2,
      tipo: 'chegada',
      fila: 2,
      pessoa: a.pessoa,
      encadeado: true,
      origem: 'simulado'
    });

    // 4. Atendimento Fila 2 (conclusão do prato / liberação para mesas)
    if (a.tAtend2) {
      eventosGerados.push({
        t: a.tAtend2,
        tipo: 'atendimento',
        fila: 2,
        pessoa: a.pessoa,
        encadeado: false,
        origem: 'simulado'
      });

      // 5. Chegada Fila 3 (Salão de Mesas)
      eventosGerados.push({
        t: a.tCheg3,
        tipo: 'chegada',
        fila: 3,
        pessoa: a.pessoa,
        encadeado: true,
        origem: 'simulado'
      });

      // 6. Atendimento Fila 3 (saída final após refeição)
      if (a.tAtend3) {
        eventosGerados.push({
          t: a.tAtend3,
          tipo: 'atendimento',
          fila: 3,
          pessoa: a.pessoa,
          encadeado: false,
          origem: 'simulado'
        });
      }
    }
  }

  // Ordenação estrita por tempo (t) e atribuição de seq monotônico
  eventosGerados.sort((x, y) => x.t - y.t);

  const tUltimo = eventosGerados[eventosGerados.length - 1]?.t || tFimReal;
  const tFimSimulado = Math.max(tFimReal, tUltimo + 1000);

  // Encerramento da sessão
  eventosGerados.push({
    t: tFimSimulado,
    tipo: 'sessao_encerrada',
    fila: 1,
    pessoa: null,
    origem: 'simulado'
  });

  // Atribuir seq monotônico estrito
  for (let idx = 0; idx < eventosGerados.length; idx++) {
    eventosGerados[idx].seq = idx + 1;
  }

  // 6. Cálculo das Métricas Simuladas e Reais através de shared/metricas.js
  const configSimuladaCalc = {
    ...cfgOrig,
    servidores: c1,
    servidoresPorFila: { 1: c1, 2: c2, 3: 1 },
    capacidadeMesas
  };

  const metricasSimuladas = calcularMetricas(eventosGerados, configSimuladaCalc, tFimSimulado);
  const metricasReais = calcularMetricas(eventosReais, cfgOrig, tFimReal);

  // 7. Cálculo da Calibração do Baseline
  const wq1Real = metricasReais?.filas?.[1]?.statsEspera?.media || 0;
  const wq1Sim = metricasSimuladas?.filas?.[1]?.statsEspera?.media || 0;
  const diffAbs = Math.abs(wq1Sim - wq1Real);
  const diffPercCalibracao = wq1Real > 0 ? (diffAbs / wq1Real) * 100 : 0;

  // 8. Diagnóstico de Bloqueio e Gargalos
  let diagnosticoStatus = 'verde';
  let diagnosticoMensagem = 'Fluxo equilibrado sem retenção crítica.';

  if (alunosBloqueadosCount > 0) {
    diagnosticoStatus = 'vermelho';
    diagnosticoMensagem = `Gargalo no Salão de Mesas: ${alunosBloqueadosCount} alunos retidos de pé com bandeja por falta de assento livre (tempo total retido: ${Math.round(tempoTotalBloqueioMs / 60000)} min).`;
  } else if (metricasSimuladas?.filas?.[2]?.filaTempo?.max > 20) {
    diagnosticoStatus = 'amarelo';
    diagnosticoMensagem = `Atenção: Aceleração na entrada elevou o acúmulo na Fila do Buffet (pico de ${metricasSimuladas.filas[2].filaTempo.max} alunos).`;
  }

  return {
    sucesso: true,
    parametros: {
      c1,
      modoF1,
      fatorF1,
      tempoFixoF1: tempoFixoF1Ms / 1000,
      c2,
      fatorF2,
      capacidadeMesas,
      deltaMinutosMesas: deltaMinutosMesasMs / 60000,
      seed
    },
    calibracao: {
      wq1RealSeg: wq1Real,
      wq1SimSeg: wq1Sim,
      diffPerc: diffPercCalibracao,
      aderente: diffPercCalibracao <= 5.0
    },
    diagnostico: {
      status: diagnosticoStatus,
      mensagem: diagnosticoMensagem,
      alunosBloqueadosCount,
      tempoTotalBloqueioMs,
      picoOcupacaoMesas,
      capacidadeMesas
    },
    eventosSimulados: eventosGerados,
    metricasSimuladas,
    metricasReais
  };
}
