/**
 * shared/movimento.js
 * Modelo puro e motor de movimento para animação determinística da fila no Restaurante Universitário.
 * Módulo isomórfico (compatível com Node.js e Navegadores modernos), sem dependência direta do DOM.
 * 
 * Responsabilidades:
 * - Geometria estática do layout: caixas físicas, rotas (polilinhas) e conectores inter-filas.
 * - Interpolação contínua ao longo de polilinhas (coordenadas x, y, orientação, dimensões do bloco).
 * - TimelineAnimada: Pré-cálculo e interpolação contínua e determinística das trajetórias de cada
 *   bloco a partir do instante t (1x, 5x, 10x, 60x, scrubbing e reinício idênticos).
 * - MotorMovimento: Motor incremental para compatibilidade com outros módulos.
 */

// 1. Geometria das Caixas Físicas do RU conforme o esboço oficial
export const CAIXAS = {
  catraca: {
    id: 'catraca',
    x: 527,
    y: 173,
    w: 95,
    h: 85,
    cx: 585,
    cy: 212,
    label: 'catraca'
  },
  atendimento: {
    id: 'atendimento',
    x: 390,
    y: 221,
    w: 75,
    h: 142,
    cx: 427.5,
    cy: 292,
    label: ['Atendi', 'mento']
  },
  mesas: {
    id: 'mesas',
    x: 123,
    y: 172,
    w: 99,
    h: 86,
    cx: 192,
    cy: 214,
    label: 'Mesas'
  },
  saida: {
    id: 'saida',
    x: 123,
    y: 462,
    w: 99,
    h: 86,
    cx: 192,
    cy: 505,
    label: 'Saída'
  }
};

// 2. Rotas do Esboço: Polilinhas no sentido de avanço da fila (do ponto de entrada até a cabeça)
export const ROTAS = {
  // Fila 1: Ponto de entrada (783, 42) desce verticalmente até (783, 212) e segue à esquerda até (650, 212) [catraca]
  1: [
    { x: 783, y: 42 },
    { x: 783, y: 212 },
    { x: 650, y: 212 }
  ],
  // Fila 2: Sai da catraca em (521, 215), desce até (521, 376), segue à esquerda até (368, 376), sobe até (368, 214)
  // e segue à esquerda até (252, 214) [mesas]. Contorna perfeitamente a caixa Atendimento conforme as setas.
  2: [
    { x: 521, y: 215 },
    { x: 521, y: 376 },
    { x: 368, y: 376 },
    { x: 368, y: 214 },
    { x: 252, y: 214 }
  ],
  // Fila 3: Sai das mesas em (192, 268) e desce verticalmente até (192, 432) [saída]
  3: [
    { x: 192, y: 268 },
    { x: 192, y: 432 }
  ]
};

// 3. Conectores que ligam as etapas através das caixas físicas
export const CONECTORES = {
  // Cabeça da Fila 1 (650, 212) -> Catraca (585, 212) -> Início da Fila 2 (521, 215)
  '1>2': [
    { x: 650, y: 212 },
    { x: 585, y: 212 },
    { x: 521, y: 215 }
  ],
  // Cabeça da Fila 2 (252, 214) -> Mesas (192, 214) -> Início da Fila 3 (192, 268)
  '2>3': [
    { x: 252, y: 214 },
    { x: 192, y: 214 },
    { x: 192, y: 268 }
  ],
  // Cabeça da Fila 3 (192, 432) -> Saída do Restaurante (192, 505)
  '3>saida': [
    { x: 192, y: 432 },
    { x: 192, y: 505 }
  ]
};

// 4. Cores oficiais de estado dos blocos
export const CORES = {
  fila1: '#ef4444',       // Vermelho padrão (Fila 1)
  fila2: '#16a34a',       // Verde padrão (Fila 2)
  fila3: '#ec4899',       // Rosa padrão (Fila 3)
  recemCriado: '#a855f7', // Roxo (bloco acabou de nascer na origem)
  cabecaF1: '#22c55e',    // Verde vivo (pronto para catraca)
  cabecaF2: '#ec4899',    // Rosa vivo (pronto para mesas)
  cabecaF3: '#f97316',    // Laranja vivo (pronto para saída)
  saida: '#64748b'        // Cinza de transição final
};

/**
 * Calcula o comprimento total de uma polilinha.
 * @param {Array<{x: number, y: number}>} pontos
 * @returns {number} Comprimento em pixels.
 */
export function calcularComprimentoPolilinha(pontos = []) {
  if (!pontos || pontos.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < pontos.length - 1; i++) {
    const dx = pontos[i + 1].x - pontos[i].x;
    const dy = pontos[i + 1].y - pontos[i].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/**
 * Interpola uma polilinha na distância d (a partir do início da rota).
 * Retorna as coordenadas (x, y), a orientação do bloco (perpendicular ao trajeto) e suas dimensões.
 * @param {Array<{x: number, y: number}>} pontos
 * @param {number} dist Distância acumulada a partir do ponto inicial.
 */
export function interpolarPolilinha(pontos = [], dist = 0) {
  if (!pontos || pontos.length === 0) {
    return { x: 0, y: 0, orientacao: 'horizontal', w: 10, h: 24, dx: 0, dy: 0, progresso: 0 };
  }
  if (pontos.length === 1) {
    return { x: pontos[0].x, y: pontos[0].y, orientacao: 'horizontal', w: 10, h: 24, dx: 0, dy: 0, progresso: 1 };
  }

  const totalLen = calcularComprimentoPolilinha(pontos);
  const dEfetivo = Math.max(0, Math.min(totalLen, dist));

  let acumulado = 0;
  for (let i = 0; i < pontos.length - 1; i++) {
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (segLen === 0) continue;

    if (dEfetivo <= acumulado + segLen || i === pontos.length - 2) {
      const u = Math.max(0, Math.min(1, (dEfetivo - acumulado) / segLen));
      const x = p1.x + u * dx;
      const y = p1.y + u * dy;

      // Orientação: perpendicular ao sentido do movimento
      // Trecho vertical (|dy| >= |dx|): barra horizontal (w=24, h=10)
      // Trecho horizontal (|dx| > |dy|): barra vertical (w=10, h=24)
      const ehVertical = Math.abs(dy) >= Math.abs(dx);
      const orientacao = ehVertical ? 'vertical' : 'horizontal';
      const w = ehVertical ? 24 : 10;
      const h = ehVertical ? 10 : 24;

      return {
        x,
        y,
        orientacao,
        w,
        h,
        dx: segLen > 0 ? dx / segLen : 0,
        dy: segLen > 0 ? dy / segLen : 0,
        segIndice: i,
        progresso: totalLen > 0 ? dEfetivo / totalLen : 1
      };
    }
    acumulado += segLen;
  }

  const ult = pontos[pontos.length - 1];
  return { x: ult.x, y: ult.y, orientacao: 'horizontal', w: 10, h: 24, dx: 0, dy: 0, progresso: 1 };
}

/**
 * Constrói a rota contínua concatenando fila de origem, conector e fila de destino.
 */
export function construirRotaCompleta(filaOrigem, encadeadaCom = null) {
  const fOrigem = Number(filaOrigem);
  const rotaOrig = ROTAS[fOrigem] ? [...ROTAS[fOrigem]] : [];

  if (!encadeadaCom) return rotaOrig;

  const fDest = Number(encadeadaCom);
  const chaveConector = `${fOrigem}>${fDest}`;
  const conector = CONECTORES[chaveConector] || [];
  const rotaDest = ROTAS[fDest] ? [...ROTAS[fDest]] : [];

  const res = [...rotaOrig];
  for (const pt of conector) {
    const ult = res[res.length - 1];
    if (!ult || Math.abs(ult.x - pt.x) > 0.01 || Math.abs(ult.y - pt.y) > 0.01) {
      res.push(pt);
    }
  }
  for (const pt of rotaDest) {
    const ult = res[res.length - 1];
    if (!ult || Math.abs(ult.x - pt.x) > 0.01 || Math.abs(ult.y - pt.y) > 0.01) {
      res.push(pt);
    }
  }
  return res;
}

/**
 * Calcula a posição e geometria do slot para uma pessoa na fila.
 * Índice 0 é a cabeça da fila (no final da rota, junto à caixa de destino).
 * Índices 1..N vão em direção ao início da rota, sem sobreposição.
 */
export function obterPosicaoSlot(filaNum, indice, totalFila, opcoes = {}) {
  const rota = ROTAS[Number(filaNum)] || [];
  const compTotal = calcularComprimentoPolilinha(rota);

  const espacoPadrao = opcoes.espacoPadrao || 16;
  const espacoMin = opcoes.espacoMin || 9;

  let espacamento = espacoPadrao;
  let maxCabem = Math.floor(compTotal / espacamento);

  if (totalFila > maxCabem) {
    espacamento = Math.max(espacoMin, compTotal / Math.max(1, totalFila));
    maxCabem = Math.floor(compTotal / espacamento);
  }

  const precisaAgrupar = totalFila > maxCabem;
  const maxRenderizados = precisaAgrupar ? Math.max(1, maxCabem - 1) : totalFila;

  if (indice >= maxRenderizados && precisaAgrupar) {
    const distFim = (maxRenderizados - 1) * espacamento;
    const distDoInicio = Math.max(0, compTotal - distFim);
    const pt = interpolarPolilinha(rota, distDoInicio);
    return {
      ...pt,
      distDoInicio,
      distDaCabeca: distFim,
      agrupado: true,
      excedente: totalFila - maxRenderizados,
      espacamento
    };
  }

  const distDaCabeca = indice * espacamento;
  const distDoInicio = Math.max(0, compTotal - distDaCabeca);
  const pt = interpolarPolilinha(rota, distDoInicio);

  return {
    ...pt,
    distDoInicio,
    distDaCabeca,
    agrupado: false,
    espacamento,
    maxRenderizados
  };
}

/**
 * Função de easing suave cúbica (ease-out) para desaceleração natural ao parar na fila.
 */
function easeOutCubic(u) {
  const t = Math.max(0, Math.min(1, u));
  return 1 - Math.pow(1 - t, 3);
}

// ============================================================================
// TIMELINE ANIMADA DETERMINÍSTICA (VERSÃO OTIMIZADA E CONTÍNUA)
// ============================================================================

/**
 * Constrói a timeline contínua de movimento determinístico de todos os blocos.
 * Permite obter a posição e estado exato de cada pessoa em qualquer instante t,
 * com interpolação contínua e suave, sem sobreposição, sem buracos temporais
 * e com rastreamento contínuo de identidade dos blocos através das etapas.
 */
export class TimelineAnimada {
  constructor(eventos = [], config = {}) {
    this.eventos = Array.isArray(eventos) ? [...eventos] : [];
    this.config = config || {};
    this.tInicio = 0;
    this.tFim = 0;
    this.duracaoTotalMs = 0;

    // Mapa de segmentos de trajetória: chavePessoa -> Array<Segmento>
    this.trajetorias = new Map();
    // Cache de filas ativas da sessão
    this.filasAtivas = [1];

    this.construirTimeline();
  }

  /**
   * Constrói os segmentos de interpolação contínua para todas as pessoas da sessão.
   */
  construirTimeline() {
    const evs = this.eventos
      .filter(e => e && e.t !== undefined && typeof e.t === 'number')
      .sort((a, b) => a.t - b.t || (a.seq || 0) - (b.seq || 0));

    if (evs.length === 0) return;

    this.tInicio = evs[0].t;
    this.tFim = evs[evs.length - 1].t;
    this.duracaoTotalMs = Math.max(1000, this.tFim - this.tInicio);

    const evInicio = evs.find(e => e.tipo === 'sessao_iniciada');
    const cfg = {
      filasAtivas: [1],
      ...this.config,
      ...(evInicio?.config?.config || evInicio?.config || {})
    };
    this.filasAtivas = (Array.isArray(cfg.filasAtivas) && cfg.filasAtivas.length > 0)
      ? cfg.filasAtivas.map(Number)
      : [1];

    // Constantes de duração visual fluida
    const DUR_CHEGADA = 1800;   // Tempo para deslizar suavemente da entrada física até o slot
    const DUR_AVANCO = 600;     // Tempo para avançar 1 posição na fila
    const DUR_CONECTOR = 700;   // Tempo atravessando a caixa intermediária (Catraca ou Mesas)
    const DUR_ROTA_F2 = 1400;   // Tempo contornando a caixa Atendimento até o slot na Fila 2
    const DUR_SAIDA = 900;      // Tempo entrando na caixa terminal e sumindo
    const DUR_ANULACAO = 400;   // Tempo de encolhimento e fade out por anulação
    const DUR_REVERSAO = 700;   // Tempo recuando de volta para a cabeça da fila

    // Estruturas de controle
    const estadoFilas = { 1: [], 2: [], 3: [] }; // arrays ordenados de pessoas em cada fila
    const infoPessoas = new Map(); // chavePessoa -> { pessoaId, chave, fila, segmentos: [] }
    const emTransitoEncadeado = new Set(); // conjunto de pessoas que já transitaram para a fila seguinte

    // Auxiliar para adicionar segmento garantindo continuidade temporal perfeita (0 buracos negros)
    const adicionarSegmento = (pDados, seg) => {
      if (pDados.segmentos.length > 0) {
        const ult = pDados.segmentos[pDados.segmentos.length - 1];
        if (ult.t1 > seg.t0) {
          ult.t1 = seg.t0;
        }
      }
      if (seg.t1 !== Infinity && seg.t1 <= seg.t0) {
        seg.t1 = seg.t0 + 1;
      }
      pDados.segmentos.push(seg);
    };

    const obterOuCriarPessoa = (pId, fNum) => {
      const chave = `p_${pId}`;
      if (!infoPessoas.has(chave)) {
        infoPessoas.set(chave, {
          pessoaId: pId,
          chave,
          fila: fNum,
          segmentos: []
        });
      }
      return infoPessoas.get(chave);
    };

    for (let k = 0; k < evs.length; k++) {
      const ev = evs[k];
      const tEv = ev.t;
      const fNum = Number(ev.fila || 1);
      const pId = ev.pessoa;

      if (pId === undefined || pId === null) continue;

      if (ev.tipo === 'chegada') {
        // Se a chegada for encadeada (ou seja, gerada pela saída da fila anterior),
        // ela já foi integrada na transição contínua do evento de atendimento anterior
        if (ev.encadeado || ev.origem === 'encadeada' || emTransitoEncadeado.has(pId)) {
          emTransitoEncadeado.delete(pId);
          continue;
        }

        const pDados = obterOuCriarPessoa(pId, fNum);
        pDados.fila = fNum;

        const filaAtual = estadoFilas[fNum];
        const novoIdx = filaAtual.length;
        filaAtual.push(pId);

        const slotAlvo = obterPosicaoSlot(fNum, novoIdx, filaAtual.length);
        const rota = ROTAS[fNum];

        // Segmento 1: Bloco nasce na origem física da fila e desliza suavemente até o slot
        adicionarSegmento(pDados, {
          t0: tEv,
          t1: tEv + DUR_CHEGADA,
          tipo: 'rota',
          fila: fNum,
          rota,
          dist0: 0,
          dist1: slotAlvo.distDoInicio,
          cor0: CORES.recemCriado,
          cor1: (novoIdx === 0 && fNum === 1) ? CORES.cabecaF1 : CORES[`fila${fNum}`],
          ehCabeca: (novoIdx === 0),
          opacidade0: 0.9,
          opacidade1: 1,
          escala0: 0.9,
          escala1: 1
        });

        // Segmento 2: Repousa estaticamente no slot até que outro evento futuro o mova
        adicionarSegmento(pDados, {
          t0: tEv + DUR_CHEGADA,
          t1: Infinity,
          tipo: 'parado',
          fila: fNum,
          rota,
          dist: slotAlvo.distDoInicio,
          cor: (novoIdx === 0 && fNum === 1) ? CORES.cabecaF1 : CORES[`fila${fNum}`],
          ehCabeca: (novoIdx === 0),
          opacidade: 1,
          escala: 1
        });

      } else if (ev.tipo === 'atendimento') {
        const pDados = obterOuCriarPessoa(pId, fNum);
        const filaAtual = estadoFilas[fNum];
        const idxFila = filaAtual.indexOf(pId);
        if (idxFila !== -1) {
          filaAtual.splice(idxFila, 1);
        }

        const ehEncadeada = (fNum === 1 && this.filasAtivas.includes(2)) ||
                            (fNum === 2 && this.filasAtivas.includes(3));

        if (ehEncadeada) {
          const proxFila = fNum + 1;
          const filaDestino = estadoFilas[proxFila];
          const slotDestIdx = filaDestino.length;
          filaDestino.push(pId);
          emTransitoEncadeado.add(pId);

          pDados.fila = proxFila;

          const chaveConector = `${fNum}>${proxFila}`;
          const rotaConector = CONECTORES[chaveConector] || [];
          const rotaDestino = ROTAS[proxFila];
          const slotDest = obterPosicaoSlot(proxFila, slotDestIdx, filaDestino.length);

          const durBox = DUR_CONECTOR;
          const durRotaDest = (proxFila === 2) ? DUR_ROTA_F2 : DUR_CHEGADA;

          // Segmento A: Atravessa a caixa intermediária (Catraca ou Mesas)
          adicionarSegmento(pDados, {
            t0: tEv,
            t1: tEv + durBox,
            tipo: 'conector',
            fila: fNum,
            conector: rotaConector,
            cor: (fNum === 1) ? CORES.cabecaF1 : CORES.cabecaF2,
            ehCabeca: false,
            opacidade0: 1,
            opacidade1: 1,
            escala0: 1,
            escala1: 1
          });

          // Segmento B: Percorre a rota da próxima fila contornando caixas até o slot
          adicionarSegmento(pDados, {
            t0: tEv + durBox,
            t1: tEv + durBox + durRotaDest,
            tipo: 'rota',
            fila: proxFila,
            rota: rotaDestino,
            dist0: 0,
            dist1: slotDest.distDoInicio,
            cor0: CORES[`fila${proxFila}`],
            cor1: (slotDestIdx === 0) ? (proxFila === 2 ? CORES.cabecaF2 : CORES.cabecaF3) : CORES[`fila${proxFila}`],
            ehCabeca: (slotDestIdx === 0),
            opacidade0: 1,
            opacidade1: 1,
            escala0: 1,
            escala1: 1
          });

          // Segmento C: Repousa no slot da nova fila
          adicionarSegmento(pDados, {
            t0: tEv + durBox + durRotaDest,
            t1: Infinity,
            tipo: 'parado',
            fila: proxFila,
            rota: rotaDestino,
            dist: slotDest.distDoInicio,
            cor: (slotDestIdx === 0) ? (proxFila === 2 ? CORES.cabecaF2 : CORES.cabecaF3) : CORES[`fila${proxFila}`],
            ehCabeca: (slotDestIdx === 0),
            opacidade: 1,
            escala: 1
          });

        } else {
          // Saída definitiva: entra na caixa física correspondente e desvanece
          const caixaAlvo = fNum === 1 ? CAIXAS.catraca : (fNum === 2 ? CAIXAS.mesas : CAIXAS.saida);
          const rotaFila = ROTAS[fNum];
          const ptSaida = interpolarPolilinha(rotaFila, calcularComprimentoPolilinha(rotaFila));

          adicionarSegmento(pDados, {
            t0: tEv,
            t1: tEv + DUR_SAIDA,
            tipo: 'saida',
            fila: fNum,
            x0: ptSaida.x,
            y0: ptSaida.y,
            x1: caixaAlvo.cx,
            y1: caixaAlvo.cy,
            cor: (fNum === 3) ? CORES.cabecaF3 : CORES[`fila${fNum}`],
            ehCabeca: false,
            opacidade0: 1,
            opacidade1: 0,
            escala0: 1,
            escala1: 0.6
          });
        }

        // Avanço em cascata (efeito sanfona) dos demais blocos da fila que abriram espaço
        const rotaFila = ROTAS[fNum];
        for (let i = 0; i < filaAtual.length; i++) {
          const pessoaSeguinteId = filaAtual[i];
          const segDados = obterOuCriarPessoa(pessoaSeguinteId, fNum);

          const slotAnterior = obterPosicaoSlot(fNum, i + 1, filaAtual.length + 1);
          const slotNovo = obterPosicaoSlot(fNum, i, filaAtual.length);

          const delayCascata = i * 90;

          // Se houver delay, aguarda na posição anterior
          if (delayCascata > 0) {
            adicionarSegmento(segDados, {
              t0: tEv,
              t1: tEv + delayCascata,
              tipo: 'parado',
              fila: fNum,
              rota: rotaFila,
              dist: slotAnterior.distDoInicio,
              cor: CORES[`fila${fNum}`],
              ehCabeca: false,
              opacidade: 1,
              escala: 1
            });
          }

          // Deslocamento contínuo para o slot à frente
          adicionarSegmento(segDados, {
            t0: tEv + delayCascata,
            t1: tEv + delayCascata + DUR_AVANCO,
            tipo: 'rota',
            fila: fNum,
            rota: rotaFila,
            dist0: slotAnterior.distDoInicio,
            dist1: slotNovo.distDoInicio,
            cor0: CORES[`fila${fNum}`],
            cor1: (i === 0) ? (fNum === 1 ? CORES.cabecaF1 : (fNum === 2 ? CORES.cabecaF2 : CORES.cabecaF3)) : CORES[`fila${fNum}`],
            ehCabeca: (i === 0),
            opacidade0: 1,
            opacidade1: 1,
            escala0: 1,
            escala1: 1
          });

          // Repouso na nova posição até o próximo evento
          adicionarSegmento(segDados, {
            t0: tEv + delayCascata + DUR_AVANCO,
            t1: Infinity,
            tipo: 'parado',
            fila: fNum,
            rota: rotaFila,
            dist: slotNovo.distDoInicio,
            cor: (i === 0) ? (fNum === 1 ? CORES.cabecaF1 : (fNum === 2 ? CORES.cabecaF2 : CORES.cabecaF3)) : CORES[`fila${fNum}`],
            ehCabeca: (i === 0),
            opacidade: 1,
            escala: 1
          });
        }

      } else if (ev.tipo === 'anulacao') {
        const pDados = obterOuCriarPessoa(pId, fNum);
        const filaAtual = estadoFilas[fNum];
        const idxFila = filaAtual.indexOf(pId);
        if (idxFila !== -1) {
          filaAtual.splice(idxFila, 1);
        }

        const rotaFila = ROTAS[fNum];
        const slotAtual = obterPosicaoSlot(fNum, idxFila >= 0 ? idxFila : 0, filaAtual.length + 1);

        adicionarSegmento(pDados, {
          t0: tEv,
          t1: tEv + DUR_ANULACAO,
          tipo: 'anulacao',
          fila: fNum,
          rota: rotaFila,
          dist: slotAtual.distDoInicio,
          cor: CORES[`fila${fNum}`],
          ehCabeca: false,
          opacidade0: 1,
          opacidade1: 0,
          escala0: 1,
          escala1: 0.2
        });

        // Pessoas atrás fecham a lacuna
        for (let i = idxFila; i < filaAtual.length; i++) {
          const pessoaSeguinteId = filaAtual[i];
          const segDados = obterOuCriarPessoa(pessoaSeguinteId, fNum);

          const slotAnterior = obterPosicaoSlot(fNum, i + 1, filaAtual.length + 1);
          const slotNovo = obterPosicaoSlot(fNum, i, filaAtual.length);

          adicionarSegmento(segDados, {
            t0: tEv,
            t1: tEv + DUR_AVANCO,
            tipo: 'rota',
            fila: fNum,
            rota: rotaFila,
            dist0: slotAnterior.distDoInicio,
            dist1: slotNovo.distDoInicio,
            cor0: CORES[`fila${fNum}`],
            cor1: (i === 0) ? (fNum === 1 ? CORES.cabecaF1 : (fNum === 2 ? CORES.cabecaF2 : CORES.cabecaF3)) : CORES[`fila${fNum}`],
            ehCabeca: (i === 0),
            opacidade0: 1,
            opacidade1: 1,
            escala0: 1,
            escala1: 1
          });

          adicionarSegmento(segDados, {
            t0: tEv + DUR_AVANCO,
            t1: Infinity,
            tipo: 'parado',
            fila: fNum,
            rota: rotaFila,
            dist: slotNovo.distDoInicio,
            cor: (i === 0) ? (fNum === 1 ? CORES.cabecaF1 : (fNum === 2 ? CORES.cabecaF2 : CORES.cabecaF3)) : CORES[`fila${fNum}`],
            ehCabeca: (i === 0),
            opacidade: 1,
            escala: 1
          });
        }

      } else if (ev.tipo === 'reversao') {
        const pDados = obterOuCriarPessoa(pId, fNum);
        const filaAtual = estadoFilas[fNum];
        filaAtual.unshift(pId);

        const rotaFila = ROTAS[fNum];
        const slotCabeca = obterPosicaoSlot(fNum, 0, filaAtual.length);
        const caixaOrig = fNum === 1 ? CAIXAS.catraca : (fNum === 2 ? CAIXAS.mesas : CAIXAS.saida);

        adicionarSegmento(pDados, {
          t0: tEv,
          t1: tEv + DUR_REVERSAO,
          tipo: 'reversao',
          fila: fNum,
          x0: caixaOrig.cx,
          y0: caixaOrig.cy,
          x1: slotCabeca.x,
          y1: slotCabeca.y,
          cor: (fNum === 1 ? CORES.cabecaF1 : (fNum === 2 ? CORES.cabecaF2 : CORES.cabecaF3)),
          ehCabeca: true,
          opacidade0: 0.8,
          opacidade1: 1,
          escala0: 1,
          escala1: 1
        });

        adicionarSegmento(pDados, {
          t0: tEv + DUR_REVERSAO,
          t1: Infinity,
          tipo: 'parado',
          fila: fNum,
          rota: rotaFila,
          dist: slotCabeca.distDoInicio,
          cor: (fNum === 1 ? CORES.cabecaF1 : (fNum === 2 ? CORES.cabecaF2 : CORES.cabecaF3)),
          ehCabeca: true,
          opacidade: 1,
          escala: 1
        });

        // Pessoas de trás recuam 1 posição
        for (let i = 1; i < filaAtual.length; i++) {
          const pessoaSeguinteId = filaAtual[i];
          const segDados = obterOuCriarPessoa(pessoaSeguinteId, fNum);

          const slotAnterior = obterPosicaoSlot(fNum, i - 1, filaAtual.length - 1);
          const slotNovo = obterPosicaoSlot(fNum, i, filaAtual.length);

          adicionarSegmento(segDados, {
            t0: tEv,
            t1: tEv + DUR_REVERSAO,
            tipo: 'rota',
            fila: fNum,
            rota: rotaFila,
            dist0: slotAnterior.distDoInicio,
            dist1: slotNovo.distDoInicio,
            cor0: CORES[`fila${fNum}`],
            cor1: CORES[`fila${fNum}`],
            ehCabeca: false,
            opacidade0: 1,
            opacidade1: 1,
            escala0: 1,
            escala1: 1
          });

          adicionarSegmento(segDados, {
            t0: tEv + DUR_REVERSAO,
            t1: Infinity,
            tipo: 'parado',
            fila: fNum,
            rota: rotaFila,
            dist: slotNovo.distDoInicio,
            cor: CORES[`fila${fNum}`],
            ehCabeca: false,
            opacidade: 1,
            escala: 1
          });
        }
      }
    }

    // Fechamento temporal perfeito: estende o repouso das pessoas ainda no sistema até além do fim da sessão
    const tMargemFinal = this.tFim + 3600000;
    for (const pDados of infoPessoas.values()) {
      if (pDados.segmentos.length > 0) {
        const ultSeg = pDados.segmentos[pDados.segmentos.length - 1];
        if (ultSeg.t1 === Infinity) {
          ultSeg.t1 = tMargemFinal;
        }
      }
      this.trajetorias.set(pDados.chave, pDados.segmentos);
    }
  }

  /**
   * Obtém os dados de renderização determinística de todos os blocos no instante t exato.
   * Interpola suavemente as coordenadas e atributos sem saltos e sem efeitos colaterais.
   * @param {number} t Timestamp em epoch milissegundos.
   * @param {Object} [estadoDerivado=null] Opcional, estado já derivado de derivarEstado.
   * @returns {{ blocos: Array<Object>, badges: Array<Object>, t: number }}
   */
  obterEstado(t, estadoDerivado = null) {
    const blocos = [];

    for (const [chavePessoa, segmentos] of this.trajetorias.entries()) {
      if (!segmentos || segmentos.length === 0) continue;
      if (t < segmentos[0].t0 || t > segmentos[segmentos.length - 1].t1) continue;

      let seg = null;
      for (let i = 0; i < segmentos.length; i++) {
        const s = segmentos[i];
        if (t >= s.t0 && t <= s.t1) {
          seg = s;
          break;
        }
      }
      if (!seg) continue;

      const duracaoSeg = Math.max(1, seg.t1 - seg.t0);
      const u = Math.max(0, Math.min(1, (t - seg.t0) / duracaoSeg));
      const prog = easeOutCubic(u);

      let pt = null;
      let cor = seg.cor || CORES[`fila${seg.fila}`];
      let opacidade = (seg.opacidade !== undefined) ? seg.opacidade : (seg.opacidade0 !== undefined ? (seg.opacidade0 + prog * (seg.opacidade1 - seg.opacidade0)) : 1);
      let escala = (seg.escala !== undefined) ? seg.escala : (seg.escala0 !== undefined ? (seg.escala0 + prog * (seg.escala1 - seg.escala0)) : 1);

      if (seg.tipo === 'parado') {
        const rota = seg.rota || ROTAS[seg.fila];
        pt = interpolarPolilinha(rota, seg.dist);
        cor = seg.cor;

      } else if (seg.tipo === 'rota') {
        const rota = seg.rota || ROTAS[seg.fila];
        const distAtual = seg.dist0 + prog * (seg.dist1 - seg.dist0);
        pt = interpolarPolilinha(rota, distAtual);
        if (seg.cor0 && seg.cor1) {
          cor = (u < 0.3) ? seg.cor0 : seg.cor1;
        }

      } else if (seg.tipo === 'conector') {
        const rotaConector = seg.conector || [];
        const compConector = calcularComprimentoPolilinha(rotaConector);
        pt = interpolarPolilinha(rotaConector, prog * compConector);

      } else if (seg.tipo === 'saida') {
        const x = seg.x0 + prog * (seg.x1 - seg.x0);
        const y = seg.y0 + prog * (seg.y1 - seg.y0);
        pt = { x, y, w: 24, h: 10, orientacao: 'vertical' };

      } else if (seg.tipo === 'anulacao') {
        const rota = seg.rota || ROTAS[seg.fila];
        pt = interpolarPolilinha(rota, seg.dist);

      } else if (seg.tipo === 'reversao') {
        const x = seg.x0 + prog * (seg.x1 - seg.x0);
        const y = seg.y0 + prog * (seg.y1 - seg.y0);
        pt = { x, y, w: 10, h: 24, orientacao: 'horizontal' };
      }

      if (pt && opacidade > 0.02) {
        // Extrai o ID numérico da pessoa a partir da chave estável p_X
        const pessoaId = parseInt(chavePessoa.replace('p_', ''), 10);

        blocos.push({
          chave: chavePessoa, // Identidade estável única
          pessoa: isNaN(pessoaId) ? chavePessoa : pessoaId,
          fila: seg.fila,
          x: Math.round(pt.x * 10) / 10,
          y: Math.round(pt.y * 10) / 10,
          w: pt.w,
          h: pt.h,
          orientacao: pt.orientacao,
          cor,
          opacidade: Math.max(0, Math.min(1, opacidade)),
          escala: Math.max(0.1, Math.min(1.2, escala)),
          ehCabeca: seg.ehCabeca || false
        });
      }
    }

    // Calcula badges +N para filas que excederem o trajeto visual
    const badges = [];
    if (estadoDerivado && estadoDerivado.filas) {
      for (const fNum of [1, 2, 3]) {
        const fObj = estadoDerivado.filas[fNum];
        const filaArr = fObj?.fila || [];
        if (filaArr.length > 0) {
          const slot = obterPosicaoSlot(fNum, filaArr.length - 1, filaArr.length);
          if (slot.agrupado && slot.excedente > 0) {
            badges.push({
              fila: fNum,
              excedente: slot.excedente,
              x: slot.x,
              y: slot.y
            });
          }
        }
      }
    }

    return {
      blocos,
      badges,
      t
    };
  }
}

// 5. MotorMovimento para compatibilidade retroativa
export class MotorMovimento {
  constructor(opcoes = {}) {
    this.velocidadePadrao = opcoes.velocidade || 140;
    this.blocos = new Map();
    this.deslocamentos = [];
  }

  aplicarSnapshot(estado) {
    if (!estado) return;
    this.blocos.clear();
    for (const fNum of [1, 2, 3]) {
      const fila = estado.filas?.[fNum]?.fila || (fNum === 1 ? estado.fila : []) || [];
      for (let i = 0; i < fila.length; i++) {
        const pessoa = fila[i];
        const slot = obterPosicaoSlot(fNum, i, fila.length);
        this.blocos.set(`f${fNum}_p${pessoa}`, {
          chave: `f${fNum}_p${pessoa}`,
          fila: fNum,
          pessoa,
          x: slot.x,
          y: slot.y,
          w: slot.w,
          h: slot.h,
          orientacao: slot.orientacao,
          cor: CORES[`fila${fNum}`],
          ehCabeca: i === 0
        });
      }
    }
  }

  processarEvento() {}
  avancar() {}
  obterDadosRenderizacao() {
    return { blocos: Array.from(this.blocos.values()), badges: [] };
  }
}
