/**
 * shared/estado.js
 * Funções puras para derivação e comparação de estado do percurso do restaurante universitário.
 * Suporta zonas configuráveis (FIFO e contagem), pontos de verificação, detecção de inversões
 * e compatibilidade retroativa total com sessões legadas (somente fila).
 * Compatível tanto com Node.js quanto com navegadores modernos (ES module).
 */

/**
 * Retorna o modelo padrão de zonas completas do RU.
 */
export function obterZonasPadrao() {
  return [
    {
      id: 'z1',
      nome: 'Fila inicial',
      cor: '#dc2626',
      modo: 'fifo',
      habilitada: true,
      capacidade: null,
      servidores: 1
    },
    {
      id: 'z2',
      nome: 'Atendimento',
      cor: '#16a34a',
      modo: 'fifo',
      habilitada: true,
      capacidade: null,
      servidores: 1
    },
    {
      id: 'z3',
      nome: 'Mesas',
      cor: '#ec4899',
      modo: 'contagem',
      habilitada: true,
      capacidade: 120,
      servidores: null
    }
  ];
}

/**
 * Gera a lista ordenada de pontos de verificação a partir das zonas habilitadas.
 * Cadeia: [Origem, zonas habilitadas, Saída].
 * Com k zonas habilitadas há k+1 pontos.
 * @param {Array<Object>} zonas - Lista de zonas configuradas.
 * @param {Object} [nomesCustom={}] - Dicionário de nomes customizados por id do ponto ('de->para').
 * @returns {Array<Object>} Lista de pontos com { id, de, para, nome, indice, modoOrigem }.
 */
export function gerarPontosDeZonas(zonas = [], nomesCustom = {}) {
  const zonasHabilitadas = zonas.filter(z => z.habilitada !== false);
  const cadeia = ['origem', ...zonasHabilitadas.map(z => z.id), 'saida'];
  const zonasMap = new Map(zonasHabilitadas.map(z => [z.id, z]));

  const pontos = [];
  for (let i = 0; i < cadeia.length - 1; i++) {
    const de = cadeia[i];
    const para = cadeia[i + 1];
    const id = `${de}->${para}`;

    // Nome padrão baseado na regra do projeto
    let nomePadrao = `${de} → ${para}`;
    if (de === 'origem') {
      nomePadrao = 'Chegada';
    } else if (de === 'z1') {
      nomePadrao = 'Catraca';
    } else if (de === 'z2') {
      nomePadrao = 'Saída do atendimento';
    } else if (de === 'z3') {
      nomePadrao = 'Saída das mesas';
    } else {
      const zOrigem = zonasMap.get(de);
      const zDestino = zonasMap.get(para);
      if (para === 'saida') {
        nomePadrao = `Saída de ${zOrigem ? zOrigem.nome : de}`;
      } else {
        nomePadrao = `${zOrigem ? zOrigem.nome : de} → ${zDestino ? zDestino.nome : para}`;
      }
    }

    const nome = nomesCustom[id] || nomePadrao;
    const modoOrigem = de === 'origem' ? 'origem' : (zonasMap.get(de)?.modo || 'fifo');

    pontos.push({
      id,
      indice: i,
      de,
      para,
      nome,
      modoOrigem
    });
  }

  return pontos;
}

/**
 * Normaliza e preenche zonas e pontos padrão caso a configuração seja parcial ou legada.
 */
export function normalizarConfiguracao(config = {}) {
  let zonas = Array.isArray(config.zonas) && config.zonas.length > 0
    ? config.zonas.map(z => ({ ...z }))
    : null;

  if (!zonas) {
    // Configuração padrão legada (quando não especificado explicitamente): Somente fila
    zonas = [
      { id: 'z1', nome: 'Fila inicial', cor: '#dc2626', modo: 'fifo', habilitada: true, capacidade: null, servidores: config.servidores || 1 }
    ];
  }

  const nomesPontos = config.nomesPontos || {};
  const pontos = gerarPontosDeZonas(zonas, nomesPontos);

  return {
    ...config,
    zonas,
    pontos,
    nomesPontos,
    janelaInversaoS: config.janelaInversaoS || 20,
    limiarAlertaOciosoSeg: config.limiarAlertaOciosoSeg || 120
  };
}

/**
 * Deriva o estado completo das zonas, pessoas e pontos a partir do log de eventos até o instante t.
 * @param {Array<Object>} eventos - Lista ordenada de eventos da sessão.
 * @param {number} [t=Infinity] - Instante limite (epoch ms). Padrão: Infinity.
 * @param {Object} [configParam=null] - Configuração explícita de zonas/pontos (opcional).
 * @returns {Object} Estado derivado completo.
 */
export function derivarEstado(eventos = [], t = Infinity, configParam = null) {
  // 1. Identificar configuração de zonas da sessão
  let config = configParam;
  if (!config) {
    const evInicio = eventos.find(e => e.tipo === 'sessao_iniciada');
    if (evInicio && evInicio.config && evInicio.config.zonas) {
      config = evInicio.config;
    } else {
      // Sessão antiga sem zonas: equivale a "Somente fila"
      config = {
        zonas: [
          { id: 'z1', nome: 'Fila inicial', cor: '#dc2626', modo: 'fifo', habilitada: true, capacidade: null, servidores: 1 }
        ]
      };
    }
  }

  const cfg = normalizarConfiguracao(config);
  const zonasHabilitadas = cfg.zonas.filter(z => z.habilitada !== false);
  const zonasMap = new Map(zonasHabilitadas.map(z => [z.id, z]));
  const primeiraZonaId = zonasHabilitadas.length > 0 ? zonasHabilitadas[0].id : 'z1';

  // Dicionário de pontos
  const pontosMap = {};
  for (const p of cfg.pontos) {
    pontosMap[p.id] = {
      id: p.id,
      indice: p.indice,
      nome: p.nome,
      de: p.de,
      para: p.para,
      modoOrigem: p.modoOrigem,
      totalPassagens: 0,
      ultimoEventoMs: null,
      ultimoIntervaloSeg: null,
      historicoPassagens: []
    };
  }

  // Dicionário de estados das zonas
  const zonasEstado = {};
  for (const z of zonasHabilitadas) {
    zonasEstado[z.id] = {
      id: z.id,
      nome: z.nome,
      cor: z.cor,
      modo: z.modo,
      capacidade: z.capacidade || null,
      servidores: z.servidores || 1,
      fila: [], // IDs das pessoas presentes ordenadas
      cabeca: null,
      ocupacao: 0,
      entradas: 0,
      saidas: 0,
      anuladas: 0
    };
  }

  const pessoas = new Map();
  let totalChegadas = 0;
  let totalSaidas = 0;
  let totalAnuladas = 0;
  let totalRevertidas = 0;

  // Filtrar eventos até t considerando tEfetivo (se houver inversão corrigida) ou t
  const eventosValidos = eventos.filter(ev => {
    const tEvento = (ev.tEfetivo !== undefined && ev.tEfetivo !== null) ? ev.tEfetivo : ev.t;
    return tEvento <= t;
  });

  // Ordenar estritamente por (tEfetivo, seq)
  eventosValidos.sort((a, b) => {
    const ta = (a.tEfetivo !== undefined && a.tEfetivo !== null) ? a.tEfetivo : a.t;
    const tb = (b.tEfetivo !== undefined && b.tEfetivo !== null) ? b.tEfetivo : b.t;
    if (ta !== tb) return ta - tb;
    return (a.seq || 0) - (b.seq || 0);
  });

  for (const ev of eventosValidos) {
    const tEv = (ev.tEfetivo !== undefined && ev.tEfetivo !== null) ? ev.tEfetivo : ev.t;

    if (ev.tipo === 'chegada') {
      totalChegadas++;
      const pId = ev.pessoa;
      const pontoId = ev.ponto || `origem->${primeiraZonaId}`;

      pessoas.set(pId, {
        pessoa: pId,
        situacao: 'em_zona',
        zonaAtual: primeiraZonaId,
        chegadaMs: tEv,
        saidaMs: null,
        tempoTotalMs: null,
        anulacaoMs: null,
        zonaEntradaMs: { [primeiraZonaId]: tEv },
        zonaSaidaMs: {},
        tempoZonaMs: {},
        identidadeSaida: {},
        dispositivosPorPonto: { [pontoId]: ev.dispositivoNome || 'Desconhecido' },
        // Campos de compatibilidade para código e testes existentes:
        status: 'esperando',
        dispositivoChegada: ev.dispositivoNome || 'Desconhecido',
        dispositivoAtendimento: null,
        esperaMs: null,
        intervaloAtendimentoMs: null
      });

      if (zonasEstado[primeiraZonaId]) {
        zonasEstado[primeiraZonaId].fila.push(pId);
        zonasEstado[primeiraZonaId].entradas++;
      }

      if (pontosMap[pontoId]) {
        const pt = pontosMap[pontoId];
        pt.totalPassagens++;
        if (pt.ultimoEventoMs !== null) {
          pt.ultimoIntervaloSeg = Math.max(0, tEv - pt.ultimoEventoMs) / 1000;
        }
        pt.ultimoEventoMs = tEv;
        pt.historicoPassagens.push({ pessoa: pId, t: tEv });
      }
    } else if (ev.tipo === 'avanco' || ev.tipo === 'atendimento') {
      // Normalização: evento legado 'atendimento' vira avanço da primeira zona para a saída (ou seguinte)
      let de = ev.de;
      let para = ev.para;
      let pontoId = ev.ponto;
      let identidade = ev.identidade;

      if (ev.tipo === 'atendimento') {
        de = primeiraZonaId;
        para = zonasHabilitadas.length > 1 ? zonasHabilitadas[1].id : 'saida';
        pontoId = `z1->${para}`;
        identidade = 'confirmada';
      } else {
        if (!pontoId) pontoId = `${de}->${para}`;
        if (!identidade) {
          identidade = (zonasMap.get(de)?.modo === 'contagem') ? 'estimada' : 'confirmada';
        }
      }

      const pId = ev.pessoa;

      // Remove da fila da zona de origem
      if (de && zonasEstado[de]) {
        const idx = zonasEstado[de].fila.indexOf(pId);
        if (idx !== -1) {
          zonasEstado[de].fila.splice(idx, 1);
        }
        zonasEstado[de].saidas++;
      }

      const p = pessoas.get(pId);
      if (p) {
        p.zonaSaidaMs[de] = tEv;
        const tEntradaZona = p.zonaEntradaMs[de] || p.chegadaMs;
        p.tempoZonaMs[de] = Math.max(0, tEv - tEntradaZona);
        p.identidadeSaida[de] = identidade;
        p.dispositivosPorPonto[pontoId] = ev.dispositivoNome || 'Desconhecido';

        if (para === 'saida') {
          p.situacao = 'saiu';
          p.zonaAtual = null;
          p.saidaMs = tEv;
          p.tempoTotalMs = Math.max(0, tEv - p.chegadaMs);
          totalSaidas++;

          // Compatibilidade legado:
          p.status = 'atendida';
          p.atendimentoMs = tEv;
          p.dispositivoAtendimento = ev.dispositivoNome || 'Desconhecido';
          p.esperaMs = p.tempoZonaMs[primeiraZonaId] ?? Math.max(0, tEv - p.chegadaMs);
        } else {
          p.situacao = 'em_zona';
          p.zonaAtual = para;
          p.zonaEntradaMs[para] = tEv;
          if (zonasEstado[para]) {
            zonasEstado[para].fila.push(pId);
            zonasEstado[para].entradas++;
          }
        }
      }

      if (pontosMap[pontoId]) {
        const pt = pontosMap[pontoId];
        pt.totalPassagens++;
        if (pt.ultimoEventoMs !== null) {
          const deltaMs = Math.max(0, tEv - pt.ultimoEventoMs);
          pt.ultimoIntervaloSeg = deltaMs / 1000;
          if (p && para === 'saida') {
            p.intervaloAtendimentoMs = deltaMs;
          }
        } else {
          pt.ultimoIntervaloSeg = null;
          if (p && para === 'saida') {
            p.intervaloAtendimentoMs = null;
          }
        }
        pt.ultimoEventoMs = tEv;
        pt.historicoPassagens.push({ pessoa: pId, t: tEv });
      }
    } else if (ev.tipo === 'anulacao') {
      const pId = ev.pessoa;
      const zonaAlvo = ev.zona;

      if (zonaAlvo && zonasEstado[zonaAlvo]) {
        const idx = zonasEstado[zonaAlvo].fila.indexOf(pId);
        if (idx !== -1) zonasEstado[zonaAlvo].fila.splice(idx, 1);
        zonasEstado[zonaAlvo].anuladas++;
      } else {
        // Se a zona não foi informada, remove de qualquer zona em que a pessoa estiver
        for (const z of Object.values(zonasEstado)) {
          const idx = z.fila.indexOf(pId);
          if (idx !== -1) {
            z.fila.splice(idx, 1);
            z.anuladas++;
            break;
          }
        }
      }

      const p = pessoas.get(pId);
      if (p) {
        p.situacao = 'anulada';
        p.zonaAtual = null;
        p.anulacaoMs = tEv;
        p.status = 'anulada';
        totalAnuladas++;
      }
    } else if (ev.tipo === 'reversao') {
      const pId = ev.pessoa;
      const de = ev.de;
      const para = ev.para;
      const p = pessoas.get(pId);

      if (p) {
        if (ev.reverteChegada || de === 'origem') {
          // Reversão de chegada equivale a anulação
          if (zonasEstado[primeiraZonaId]) {
            const idx = zonasEstado[primeiraZonaId].fila.indexOf(pId);
            if (idx !== -1) zonasEstado[primeiraZonaId].fila.splice(idx, 1);
          }
          p.situacao = 'anulada';
          p.zonaAtual = null;
          p.anulacaoMs = tEv;
          p.status = 'anulada';
          totalRevertidas++;
        } else {
          // Reversão de avanço / atendimento: retira da zona de destino e devolve à cabeça da zona anterior
          const zonaDe = de || primeiraZonaId;
          const zonaPara = para || 'saida';

          if (zonaPara && zonaPara !== 'saida' && zonasEstado[zonaPara]) {
            const idx = zonasEstado[zonaPara].fila.indexOf(pId);
            if (idx !== -1) zonasEstado[zonaPara].fila.splice(idx, 1);
            zonasEstado[zonaPara].entradas = Math.max(0, zonasEstado[zonaPara].entradas - 1);
          }

          if (zonaDe && zonasEstado[zonaDe]) {
            if (!zonasEstado[zonaDe].fila.includes(pId)) {
              zonasEstado[zonaDe].fila.unshift(pId);
            }
            zonasEstado[zonaDe].saidas = Math.max(0, zonasEstado[zonaDe].saidas - 1);
          }

          p.situacao = 'em_zona';
          p.zonaAtual = zonaDe;
          delete p.zonaSaidaMs[zonaDe];
          delete p.tempoZonaMs[zonaDe];
          delete p.identidadeSaida[zonaDe];

          if (zonaPara === 'saida') {
            p.saidaMs = null;
            p.tempoTotalMs = null;
            p.status = 'esperando';
            p.atendimentoMs = null;
            p.dispositivoAtendimento = null;
            p.esperaMs = null;
            p.intervaloAtendimentoMs = null;
            totalSaidas = Math.max(0, totalSaidas - 1);
          }

          const pontoId = ev.ponto || `${zonaDe}->${zonaPara}`;
          if (pontosMap[pontoId]) {
            pontosMap[pontoId].totalPassagens = Math.max(0, pontosMap[pontoId].totalPassagens - 1);
            const idxHist = pontosMap[pontoId].historicoPassagens.map(h => h.pessoa).lastIndexOf(pId);
            if (idxHist !== -1) pontosMap[pontoId].historicoPassagens.splice(idxHist, 1);
          }

          totalRevertidas++;
        }
      }
    }
  }

  // Atualizar contadores derivados de cada zona
  for (const z of Object.values(zonasEstado)) {
    z.ocupacao = z.fila.length;
    z.cabeca = z.fila.length > 0 ? z.fila[0] : null;
  }

  // Compatibilidade com lógica legada de catraca e fila principal
  const filaPrincipal = zonasEstado[primeiraZonaId] ? zonasEstado[primeiraZonaId].fila : [];
  for (let i = 0; i < filaPrincipal.length; i++) {
    const p = pessoas.get(filaPrincipal[i]);
    if (p) {
      p.status = (i === 0) ? 'na_catraca' : 'esperando';
    }
  }
  const primeiraDaFila = filaPrincipal.length > 0 ? filaPrincipal[0] : null;

  // Tempo de espera na catraca
  const tReferencia = (t !== Infinity && t !== null && !isNaN(t))
    ? t
    : (eventosValidos.length > 0 ? (eventosValidos[eventosValidos.length - 1].tEfetivo || eventosValidos[eventosValidos.length - 1].t) : Date.now());

  let esperaNaCatracaMs = 0;
  if (primeiraDaFila !== null) {
    const pCatraca = pessoas.get(primeiraDaFila);
    if (pCatraca) {
      esperaNaCatracaMs = Math.max(0, tReferencia - pCatraca.chegadaMs);
    }
  }

  // Vazão recente dos últimos 5 minutos no ponto de saída da primeira zona
  const pontoSaidaZ1 = pontosMap[`${primeiraZonaId}->z2`] || pontosMap[`${primeiraZonaId}->saida`];
  let vazaoRecente = 0;
  if (pontoSaidaZ1) {
    const cincoMinAtras = tReferencia - (5 * 60 * 1000);
    const passagens5Min = pontoSaidaZ1.historicoPassagens.filter(h => h.t >= cincoMinAtras && h.t <= tReferencia).length;
    vazaoRecente = passagens5Min / 5;
  }

  const pessoasArray = Array.from(pessoas.values());
  const pessoasPresentes = pessoasArray.filter(p => p.situacao === 'em_zona').length;

  return {
    pessoas: pessoasArray,
    zonas: zonasEstado,
    pontos: pontosMap,
    config: cfg,
    // Campos legados para compatibilidade com testes e painéis existentes:
    fila: filaPrincipal,
    primeiraDaFila,
    esperaNaCatracaMs,
    contadores: {
      chegadas: totalChegadas,
      atendidas: totalSaidas,
      saidas: totalSaidas,
      anuladas: totalAnuladas,
      revertidas: totalRevertidas,
      naFila: filaPrincipal.length,
      presentes: pessoasPresentes
    },
    vazaoRecente,
    ultimoIntervaloSeg: pontoSaidaZ1?.ultimoIntervaloSeg ?? null
  };
}

/**
 * Calcula a diferença operacional de animação entre dois estados consecutivos.
 * Retorna operações granulares: entrar, mover, sair, anular, reverter.
 * @param {Object|null} anterior - Estado anterior retornado por derivarEstado.
 * @param {Object} novo - Novo estado retornado por derivarEstado.
 * @returns {Array<Object>} Lista de operações de animação.
 */
export function diffEstado(anterior, novo) {
  if (!novo) return [];
  if (!anterior) {
    // Estado inicial: gera entradas para quem está em cada zona
    const ops = [];
    for (const p of novo.pessoas || []) {
      if (p.situacao === 'em_zona') {
        ops.push({ op: 'entrar', pessoa: p.pessoa, zona: p.zonaAtual });
      }
    }
    return ops;
  }

  const operacoes = [];
  const pessoasAntigas = new Map((anterior.pessoas || []).map(p => [p.pessoa, p]));

  // 1. Checagem de novas pessoas ou transições de estado
  for (const pNovo of (novo.pessoas || [])) {
    const pAntigo = pessoasAntigas.get(pNovo.pessoa);

    if (!pAntigo) {
      // Nova chegada
      operacoes.push({
        op: 'entrar',
        pessoa: pNovo.pessoa,
        zona: pNovo.zonaAtual
      });
    } else {
      // Pessoa já existia: checar mudança de zona ou saída
      if (pAntigo.situacao === 'em_zona' && pNovo.situacao === 'em_zona' && pAntigo.zonaAtual !== pNovo.zonaAtual) {
        operacoes.push({
          op: 'mover',
          pessoa: pNovo.pessoa,
          de: pAntigo.zonaAtual,
          para: pNovo.zonaAtual,
          ponto: `${pAntigo.zonaAtual}->${pNovo.zonaAtual}`,
          identidade: pNovo.identidadeSaida?.[pAntigo.zonaAtual] || 'confirmada'
        });

        // Compatibilidade com animação legada (se saiu da Z1):
        if (pAntigo.zonaAtual === 'z1') {
          operacoes.push({ op: 'confirmar', pessoa: pNovo.pessoa });
          operacoes.push({ op: 'avancar' });
        }
      } else if (pAntigo.situacao === 'em_zona' && pNovo.situacao === 'saiu') {
        operacoes.push({
          op: 'sair',
          pessoa: pNovo.pessoa,
          de: pAntigo.zonaAtual,
          ponto: `${pAntigo.zonaAtual}->saida`
        });

        // Compatibilidade com animação legada:
        if (pAntigo.zonaAtual === 'z1') {
          operacoes.push({ op: 'confirmar', pessoa: pNovo.pessoa });
          operacoes.push({ op: 'avancar' });
        }
      } else if (pAntigo.situacao === 'em_zona' && pNovo.situacao === 'anulada') {
        operacoes.push({
          op: 'anular',
          pessoa: pNovo.pessoa,
          zona: pAntigo.zonaAtual
        });
      }
    }
  }

  // 2. Checagem de reversões
  if (novo.contadores.revertidas > (anterior.contadores.revertidas || 0)) {
    // Procura pessoas que voltaram de 'saiu' para 'em_zona' ou voltaram de zona
    for (const pNovo of (novo.pessoas || [])) {
      const pAntigo = pessoasAntigas.get(pNovo.pessoa);
      if (pAntigo && pAntigo.situacao === 'saiu' && pNovo.situacao === 'em_zona') {
        operacoes.push({
          op: 'reverter',
          pessoa: pNovo.pessoa,
          de: pNovo.zonaAtual,
          para: 'saida'
        });
      }
    }
  }

  return operacoes;
}
