/**
 * shared/movimento.js
 * Modelo puro e motor de movimento para animação da fila no Restaurante Universitário.
 * Módulo isomórfico (Node.js e Navegadores), sem acesso ao DOM.
 * 
 * Responsabilidades:
 * - Geometria estática: caixas físicas, rotas (polilinhas), conectores e enquadramento.
 * - Interpolação contínua e discretização de posições/slots.
 * - Geração e fila de deslocamentos a partir de eventos e diffs de estado.
 * - Execução temporal determinística por passo dt (60 fps).
 */

// 1. Geometria das Caixas Físicas do RU conforme o esboço (imagem 1)
export const CAIXAS = {
  catraca: {
    id: 'catraca',
    x: 543,
    y: 173,
    w: 94,
    h: 83,
    cx: 590,
    cy: 214.5,
    label: 'catraca'
  },
  atendimento: {
    id: 'atendimento',
    x: 414,
    y: 216,
    w: 74,
    h: 142,
    cx: 451,
    cy: 287,
    label: ['Atendi', 'mento']
  },
  mesas: {
    id: 'mesas',
    x: 139,
    y: 172,
    w: 99,
    h: 84,
    cx: 188.5,
    cy: 214,
    label: 'Mesas'
  },
  saida: {
    id: 'saida',
    x: 139,
    y: 462,
    w: 99,
    h: 86,
    cx: 188.5,
    cy: 505,
    label: 'Saída'
  }
};

// 2. Rotas do Esboço: Polilinhas no sentido de avanço da fila (do início até a cabeça/caixa de destino)
export const ROTAS = {
  // Fila 1: (783,42) desce até (783,212) e segue à esquerda até (650,212), junto à catraca
  1: [
    { x: 783, y: 42 },
    { x: 783, y: 212 },
    { x: 650, y: 212 }
  ],
  // Fila 2: (521,215) desce até (521,376), segue à esquerda até (368,376), sobe até (368,214)
  // e segue à esquerda até (252,214), junto a "Mesas". Contorna a caixa "Atendimento" (414,216)-(488,358).
  2: [
    { x: 521, y: 215 },
    { x: 521, y: 376 },
    { x: 368, y: 376 },
    { x: 368, y: 214 },
    { x: 252, y: 214 }
  ],
  // Fila 3: (192,268) desce até (192,432), junto a "Saída"
  3: [
    { x: 192, y: 268 },
    { x: 192, y: 432 }
  ]
};

// 3. Conectores que ligam as filas através das caixas
export const CONECTORES = {
  // Fim da Fila 1 (650, 212) -> através da Catraca -> Início da Fila 2 (521, 215)
  '1>2': [
    { x: 650, y: 212 },
    { x: 585, y: 212 },
    { x: 521, y: 215 }
  ],
  // Fim da Fila 2 (252, 214) -> através de Mesas -> Início da Fila 3 (192, 268)
  '2>3': [
    { x: 252, y: 214 },
    { x: 192, y: 214 },
    { x: 192, y: 268 }
  ],
  // Fim da Fila 3 (192, 432) -> Saída do Restaurante (188.5, 505)
  '3>saida': [
    { x: 192, y: 432 },
    { x: 192, y: 505 }
  ]
};

// Cores padrão definidas na especificação
export const CORES = {
  fila1: '#FF3333',     // Vermelho
  fila2: '#00C060',     // Verde
  fila3: '#FF66C4',     // Rosa
  recemCriado: '#C000FF', // Roxo
  cabecaFila3: '#FF9955', // Laranja
  cabecaF1: '#00C060',  // Verde (etapa seguinte: catraca)
  cabecaF2: '#FF66C4',  // Rosa (etapa seguinte: mesas)
  cabecaF3: '#FF9955'   // Laranja (etapa seguinte: saída)
};

/**
 * Calcula o comprimento total de uma polilinha.
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
 * Interpola uma polilinha na distância d (a partir do início da polilinha).
 * Retorna coordenadas, orientação e dimensões do bloco perpendicular ao trajeto.
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

      // Orientação: perpendicular ao sentido do trajeto
      // Em trecho vertical (|dy| >= |dx|): barra horizontal (w=24, h=10)
      // Em trecho horizontal (|dx| > |dy|): barra vertical (w=10, h=24)
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
 * Constrói a rota contínua completa para encadeamentos.
 */
export function construirRotaCompleta(filaOrigem, encadeadaCom = null) {
  const fOrigem = Number(filaOrigem);
  const rotaOrig = ROTAS[fOrigem] ? [...ROTAS[fOrigem]] : [];

  if (!encadeadaCom) return rotaOrig;

  const fDest = Number(encadeadaCom);
  const chaveConector = `${fOrigem}>${fDest}`;
  const conector = CONECTORES[chaveConector] || [];
  const rotaDest = ROTAS[fDest] ? [...ROTAS[fDest]] : [];

  // Concatena eliminando pontos duplicados nas junções
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
 * Calcula o slot/posição estático para uma pessoa na fila.
 * Posição 0 é a cabeça (no fim da rota, junto à caixa de destino).
 * Posições 1..N vão em direção ao início da rota.
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
    // Excedente no badge +N
    const distFim = (maxRenderizados - 1) * espacamento;
    const distDoInicio = Math.max(0, compTotal - distFim);
    const pt = interpolarPolilinha(rota, distDoInicio);
    return {
      ...pt,
      distDoInicio,
      distDaCabeca: distFim,
      agrupado: true,
      excedente: totalFila - maxRenderizados
    };
  }

  // Posição 0 (cabeça) fica no fim da rota (distDoInicio = compTotal)
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
 * Motor de Movimento puro (sem DOM).
 * Gerencia blocos, rotas, interpolação temporal e deslocamentos.
 */
export class MotorMovimento {
  constructor(opcoes = {}) {
    this.velocidadePadrao = opcoes.velocidade || 140; // 140 px/s
    this.velocidadeMax = opcoes.velocidadeMax || 1200; // limite em replay
    this.tempoMinMs = opcoes.tempoMinMs || 250;
    this.tempoMaxMs = opcoes.tempoMaxMs || 4000;
    this.intervaloCascataMs = opcoes.intervaloCascataMs || 100; // 80-120 ms
    this.limitePendentes = 20;

    // Mapa de blocos ativos: chave (`f{fila}_p{pessoa}`) -> Objeto Bloco
    this.blocos = new Map();
    // Fila de deslocamentos agendados
    this.deslocamentos = [];
    this.estadoAlvo = null;
    this.encadeamentos = opcoes.encadeamentos || ['1>2', '2>3'];
    this.tempoDesdeUltimoEventoMs = 0;
  }

  /**
   * Sincroniza o motor instantaneamente com o estado (snapshot).
   * Sem animação (ideal para carga inicial, saltos de replay ou recuperação).
   */
  aplicarSnapshot(estado) {
    if (!estado) return;
    this.estadoAlvo = estado;
    this.deslocamentos = [];
    this.tempoDesdeUltimoEventoMs = 0;

    const filasAtivas = estado.filasAtivas || [1];
    const chavesValidas = new Set();

    for (const fNum of [1, 2, 3]) {
      if (!filasAtivas.includes(fNum)) continue;
      const fo = estado.filas?.[fNum];
      if (fo?.ativa === false) continue;
      const fila = fo?.fila || (fNum === 1 ? estado.fila : []) || [];

      for (let i = 0; i < fila.length; i++) {
        const pessoa = fila[i];
        const chave = `f${fNum}_p${pessoa}`;
        chavesValidas.add(chave);

        const slot = obterPosicaoSlot(fNum, i, fila.length);
        const ehCabeca = (i === 0);

        let cor = CORES[`fila${fNum}`];
        if (ehCabeca) {
          if (fNum === 1) cor = CORES.cabecaF1;
          else if (fNum === 2) cor = CORES.cabecaF2;
          else if (fNum === 3) cor = CORES.cabecaF3;
        }

        const bloco = {
          chave,
          fila: fNum,
          pessoa,
          x: slot.x,
          y: slot.y,
          w: slot.w,
          h: slot.h,
          orientacao: slot.orientacao,
          cor,
          opacidade: 1,
          escala: 1,
          indiceFila: i,
          ehCabeca,
          emMovimento: false,
          tempoNaCabecaMs: ehCabeca ? (fo?.esperaNaCabecaMs || 0) : 0,
          trajeto: null
        };

        this.blocos.set(chave, bloco);
      }
    }

    // Remove blocos que não constam no estado
    for (const [chave] of this.blocos) {
      if (!chavesValidas.has(chave)) {
        this.blocos.delete(chave);
      }
    }
  }

  /**
   * Processa novo evento incremental e agenda os deslocamentos necessários.
   */
  processarEvento(evento, estadoNovo) {
    if (!evento || !estadoNovo) return;
    this.estadoAlvo = estadoNovo;
    this.tempoDesdeUltimoEventoMs = 0;

    // Se houver mais de 20 deslocamentos pendentes acumulados, aplica snapshot direto
    if (this.deslocamentos.length >= this.limitePendentes) {
      this.aplicarSnapshot(estadoNovo);
      return;
    }

    const tipo = evento.tipo;
    const fNum = Number(evento.fila || 1);

    if (tipo === 'chegada') {
      const pessoa = evento.pessoa;
      const chave = `f${fNum}_p${pessoa}`;
      const filaNova = estadoNovo.filas?.[fNum]?.fila || [];
      const indiceFinal = filaNova.indexOf(pessoa);
      const idx = indiceFinal >= 0 ? indiceFinal : filaNova.length - 1;

      // Rota e slots
      const slotFinal = obterPosicaoSlot(fNum, idx, filaNova.length);
      const rota = ROTAS[fNum];
      const compTotal = calcularComprimentoPolilinha(rota);

      // Bloco surge no início da rota (s = 0) com cor roxa
      const ptInicio = interpolarPolilinha(rota, 0);

      const bloco = {
        chave,
        fila: fNum,
        pessoa,
        x: ptInicio.x,
        y: ptInicio.y,
        w: ptInicio.w,
        h: ptInicio.h,
        orientacao: ptInicio.orientacao,
        cor: CORES.recemCriado, // roxo
        opacidade: 1,
        escala: 1,
        indiceFila: idx,
        ehCabeca: (idx === 0),
        emMovimento: true,
        tempoNaCabecaMs: 0
      };
      this.blocos.set(chave, bloco);

      // Trajeto da origem até o slot final
      const distFinal = slotFinal.distDoInicio;
      const duracaoSeg = Math.max(0.25, Math.min(4.0, distFinal / this.velocidadePadrao));

      this.deslocamentos.push({
        chave,
        tipo: 'entrada',
        rota,
        distInicio: 0,
        distFim: distFinal,
        distAtual: 0,
        duracaoMs: duracaoSeg * 1000,
        decorridoMs: 0,
        corFinal: (idx === 0 && fNum === 1) ? CORES.cabecaF1 : CORES[`fila${fNum}`],
        delayMs: 0
      });

    } else if (tipo === 'atendimento') {
      const pessoa = evento.pessoa;
      const chave = `f${fNum}_p${pessoa}`;
      const ehEncadeado = (fNum === 1 && this.encadeamentos.includes('1>2') && estadoNovo.filasAtivas?.includes(2)) ||
                          (fNum === 2 && this.encadeamentos.includes('2>3') && estadoNovo.filasAtivas?.includes(3));

      if (ehEncadeado) {
        const proxFila = fNum + 1;
        const chaveDest = `f${proxFila}_p${pessoa}`;
        // Rota contínua através do conector
        const rotaCompleta = construirRotaCompleta(fNum, proxFila);
        const compTotal = calcularComprimentoPolilinha(rotaCompleta);

        // Bloco sai da cabeça da fila anterior e percorre até a cauda da próxima fila
        const filaDest = estadoNovo.filas?.[proxFila]?.fila || [];
        const idxDest = filaDest.indexOf(pessoa);
        const slotDest = obterPosicaoSlot(proxFila, idxDest >= 0 ? idxDest : filaDest.length - 1, filaDest.length);

        const compFilaOrigem = calcularComprimentoPolilinha(ROTAS[fNum]);
        const compConector = calcularComprimentoPolilinha(CONECTORES[`${fNum}>${proxFila}`]);
        const distFinal = compFilaOrigem + compConector + slotDest.distDoInicio;

        const duracaoSeg = Math.max(0.25, Math.min(4.0, (distFinal - compFilaOrigem) / this.velocidadePadrao));

        // Transfere chave do bloco
        const bloco = this.blocos.get(chave);
        if (bloco) {
          this.blocos.delete(chave);
          bloco.chave = chaveDest;
          bloco.fila = proxFila;
          this.blocos.set(chaveDest, bloco);
        }

        this.deslocamentos.push({
          chave: chaveDest,
          tipo: 'transferir',
          rota: rotaCompleta,
          distInicio: compFilaOrigem,
          distFim: distFinal,
          distAtual: compFilaOrigem,
          duracaoMs: duracaoSeg * 1000,
          decorridoMs: 0,
          corFinal: CORES[`fila${proxFila}`],
          delayMs: 0
        });

      } else {
        // Saída definitiva: move para dentro da caixa de destino e desaparece
        const caixaDest = fNum === 1 ? CAIXAS.catraca : (fNum === 2 ? CAIXAS.mesas : CAIXAS.saida);
        this.deslocamentos.push({
          chave,
          tipo: 'saida',
          xDest: caixaDest.cx,
          yDest: caixaDest.cy,
          duracaoMs: 600,
          decorridoMs: 0,
          delayMs: 0
        });
      }

      // Avanço em cascata dos demais blocos da fila
      const filaRestante = estadoNovo.filas?.[fNum]?.fila || [];
      for (let i = 0; i < filaRestante.length; i++) {
        const pNum = filaRestante[i];
        const ch = `f${fNum}_p${pNum}`;
        const slotNovo = obterPosicaoSlot(fNum, i, filaRestante.length);
        const slotAnterior = obterPosicaoSlot(fNum, i + 1, filaRestante.length + 1);

        const deltaDist = Math.abs(slotNovo.distDoInicio - slotAnterior.distDoInicio);
        const durSeg = Math.max(0.2, deltaDist / this.velocidadePadrao);

        this.deslocamentos.push({
          chave: ch,
          tipo: 'avanco',
          rota: ROTAS[fNum],
          distInicio: slotAnterior.distDoInicio,
          distFim: slotNovo.distDoInicio,
          distAtual: slotAnterior.distDoInicio,
          duracaoMs: durSeg * 1000,
          decorridoMs: 0,
          delayMs: i * this.intervaloCascataMs, // cascata de 80 a 120 ms
          corFinal: (i === 0) ? (fNum === 1 ? CORES.cabecaF1 : (fNum === 2 ? CORES.cabecaF2 : CORES.cabecaF3)) : CORES[`fila${fNum}`]
        });
      }

    } else if (tipo === 'anulacao') {
      const pessoa = evento.pessoa;
      const chave = `f${fNum}_p${pessoa}`;
      this.deslocamentos.push({
        chave,
        tipo: 'anular',
        duracaoMs: 400,
        decorridoMs: 0,
        delayMs: 0
      });

      // Blocos atrás fecham a lacuna
      const filaRestante = estadoNovo.filas?.[fNum]?.fila || [];
      for (let i = 0; i < filaRestante.length; i++) {
        const pNum = filaRestante[i];
        const ch = `f${fNum}_p${pNum}`;
        const slotNovo = obterPosicaoSlot(fNum, i, filaRestante.length);
        this.deslocamentos.push({
          chave: ch,
          tipo: 'fechar_lacuna',
          rota: ROTAS[fNum],
          distFim: slotNovo.distDoInicio,
          duracaoMs: 400,
          decorridoMs: 0,
          delayMs: i * 60
        });
      }

    } else if (tipo === 'reversao') {
      // Reversão de atendimento: o bloco retorna à cabeça da fila
      const pessoa = evento.pessoa;
      const chave = `f${fNum}_p${pessoa}`;
      const slotCabeca = obterPosicaoSlot(fNum, 0, estadoNovo.filas?.[fNum]?.fila?.length || 1);
      const caixaOrig = fNum === 1 ? CAIXAS.catraca : (fNum === 2 ? CAIXAS.mesas : CAIXAS.saida);

      const bloco = {
        chave,
        fila: fNum,
        pessoa,
        x: caixaOrig.cx,
        y: caixaOrig.cy,
        w: slotCabeca.w,
        h: slotCabeca.h,
        orientacao: slotCabeca.orientacao,
        cor: fNum === 1 ? CORES.cabecaF1 : (fNum === 2 ? CORES.cabecaF2 : CORES.cabecaF3),
        opacidade: 0.8,
        escala: 1,
        indiceFila: 0,
        ehCabeca: true,
        emMovimento: true,
        tempoNaCabecaMs: 0
      };
      this.blocos.set(chave, bloco);

      this.deslocamentos.push({
        chave,
        tipo: 'reversao',
        xOrig: caixaOrig.cx,
        yOrig: caixaOrig.cy,
        xDest: slotCabeca.x,
        yDest: slotCabeca.y,
        duracaoMs: 500,
        decorridoMs: 0,
        delayMs: 0
      });

      // Empurra os demais blocos 1 posição para trás
      const fila = estadoNovo.filas?.[fNum]?.fila || [];
      for (let i = 1; i < fila.length; i++) {
        const pNum = fila[i];
        const ch = `f${fNum}_p${pNum}`;
        const slotNovo = obterPosicaoSlot(fNum, i, fila.length);
        this.deslocamentos.push({
          chave: ch,
          tipo: 'recuo',
          rota: ROTAS[fNum],
          distFim: slotNovo.distDoInicio,
          duracaoMs: 400,
          decorridoMs: 0,
          delayMs: (i - 1) * 60
        });
      }
    } else {
      // Outros eventos (ex: ajuste_fila): sincroniza slots
      this.aplicarSnapshot(estadoNovo);
    }
  }

  /**
   * Redireciona um bloco que já estava em movimento para um novo destino na rota sem saltos.
   */
  redirecionarBloco(chave, rota, distFimNova) {
    const bloco = this.blocos.get(chave);
    if (!bloco) return;

    // Encontra deslocamento ativo
    const dIdx = this.deslocamentos.findIndex(d => d.chave === chave);
    if (dIdx >= 0) {
      const d = this.deslocamentos[dIdx];
      const distAtual = d.distAtual ?? d.distInicio ?? 0;
      const delta = Math.abs(distFimNova - distAtual);
      d.rota = rota;
      d.distInicio = distAtual;
      d.distFim = distFimNova;
      d.decorridoMs = 0;
      d.duracaoMs = Math.max(200, Math.min(3000, (delta / this.velocidadePadrao) * 1000));
    }
  }

  /**
   * Passo de tempo temporal dtMs (em milissegundos).
   * Atualiza posições, interpolações e limpa deslocamentos concluídos.
   */
  avancar(dtMs = 16.67, fatorVelocidade = 1) {
    const dt = dtMs * fatorVelocidade;
    this.tempoDesdeUltimoEventoMs += dt;

    // Se passou mais de 5s desde o último evento, garante assentamento total
    if (this.deslocamentos.length > 0 && this.tempoDesdeUltimoEventoMs > 5000) {
      if (this.estadoAlvo) this.aplicarSnapshot(this.estadoAlvo);
      this.deslocamentos = [];
      return;
    }

    const deslocamentosRestantes = [];

    for (const d of this.deslocamentos) {
      if (d.delayMs > 0) {
        d.delayMs -= dt;
        deslocamentosRestantes.push(d);
        continue;
      }

      d.decorridoMs += dt;
      const u = Math.min(1, d.decorridoMs / Math.max(1, d.duracaoMs));
      // Curva de aceleração/desaceleração suave (ease-out cúbico)
      const prog = 1 - Math.pow(1 - u, 3);

      const bloco = this.blocos.get(d.chave);
      if (!bloco) continue;

      if (d.tipo === 'entrada' || d.tipo === 'avanco' || d.tipo === 'transferir' || d.tipo === 'fechar_lacuna' || d.tipo === 'recuo') {
        const rota = d.rota || ROTAS[bloco.fila];
        const distIni = d.distInicio ?? 0;
        const distFim = d.distFim ?? 0;
        const distAtual = distIni + prog * (distFim - distIni);
        d.distAtual = distAtual;

        const pt = interpolarPolilinha(rota, distAtual);
        bloco.x = pt.x;
        bloco.y = pt.y;
        bloco.w = pt.w;
        bloco.h = pt.h;
        bloco.orientacao = pt.orientacao;

        // Transição de cor (se entrada, roxo nos primeiros pixels)
        if (d.tipo === 'entrada') {
          if (distAtual > 25 && d.corFinal) {
            bloco.cor = d.corFinal;
          }
        } else if (d.corFinal) {
          bloco.cor = d.corFinal;
        }

        if (u >= 1) {
          bloco.emMovimento = false;
        } else {
          bloco.emMovimento = true;
          deslocamentosRestantes.push(d);
        }

      } else if (d.tipo === 'saida') {
        const xIni = bloco.x;
        const yIni = bloco.y;
        bloco.x = xIni + prog * (d.xDest - xIni);
        bloco.y = yIni + prog * (d.yDest - yIni);
        bloco.opacidade = Math.max(0, 1 - prog);

        if (u >= 1) {
          this.blocos.delete(d.chave);
        } else {
          deslocamentosRestantes.push(d);
        }

      } else if (d.tipo === 'anular') {
        bloco.escala = Math.max(0.1, 1 - prog * 0.8);
        bloco.opacidade = Math.max(0, 1 - prog);

        if (u >= 1) {
          this.blocos.delete(d.chave);
        } else {
          deslocamentosRestantes.push(d);
        }

      } else if (d.tipo === 'reversao') {
        bloco.x = d.xOrig + prog * (d.xDest - d.xOrig);
        bloco.y = d.yOrig + prog * (d.yDest - d.yOrig);
        bloco.opacidade = Math.min(1, 0.8 + prog * 0.2);

        if (u >= 1) {
          bloco.emMovimento = false;
        } else {
          deslocamentosRestantes.push(d);
        }
      }
    }

    this.deslocamentos = deslocamentosRestantes;

    // Atualiza tempos na cabeça para efeito de pulso após 10s
    for (const bloco of this.blocos.values()) {
      if (bloco.ehCabeca && !bloco.emMovimento) {
        bloco.tempoNaCabecaMs = (bloco.tempoNaCabecaMs || 0) + dt;
        bloco.devePulsar = bloco.tempoNaCabecaMs >= 10000;
      } else {
        bloco.devePulsar = false;
      }
    }
  }

  /**
   * Retorna os dados renderizáveis para o componente visual desenhar no SVG.
   */
  obterDadosRenderizacao() {
    const listaBlocos = [];
    for (const bloco of this.blocos.values()) {
      listaBlocos.push({
        chave: bloco.chave,
        fila: bloco.fila,
        pessoa: bloco.pessoa,
        x: Math.round(bloco.x * 10) / 10,
        y: Math.round(bloco.y * 10) / 10,
        w: bloco.w,
        h: bloco.h,
        orientacao: bloco.orientacao,
        cor: bloco.cor,
        opacidade: bloco.opacidade ?? 1,
        escala: bloco.escala ?? 1,
        ehCabeca: bloco.ehCabeca,
        devePulsar: bloco.devePulsar || false,
        emMovimento: bloco.emMovimento || false
      });
    }

    // Calcula badges +N para filas que excederem o trajeto
    const badges = [];
    if (this.estadoAlvo) {
      for (const fNum of [1, 2, 3]) {
        const fila = this.estadoAlvo.filas?.[fNum]?.fila || [];
        if (fila.length > 0) {
          const slot = obterPosicaoSlot(fNum, fila.length - 1, fila.length);
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
      blocos: listaBlocos,
      badges,
      assentado: this.deslocamentos.length === 0
    };
  }

  /**
   * Verifica o invariante de que a contagem de blocos bate exatamente com o estado.
   */
  invarianteContagem(estado) {
    if (!estado) return true;
    for (const fNum of [1, 2, 3]) {
      const fila = estado.filas?.[fNum]?.fila || (fNum === 1 ? estado.fila : []) || [];
      const blocosDestaFila = Array.from(this.blocos.values()).filter(b => b.fila === fNum);
      if (blocosDestaFila.length !== fila.length) {
        return false;
      }
    }
    return true;
  }
}

