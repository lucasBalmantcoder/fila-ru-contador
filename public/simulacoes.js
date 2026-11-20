/**
 * public/simulacoes.js
 * Controlador do módulo de Simulações What-If do Sistema Fila RU.
 * Alinhado com o menu de aferições e navegação por abas de Histórico & Análises.
 */

import { simularSessao } from '../shared/simulador.js';
import { formatarNumero, formatarDuracao, formatarHoraLocal } from '../shared/metricas.js';
import { derivarEstado } from '../shared/estado.js';

let chartFilaInstance = null;
let chartMesasInstance = null;
let chartAcumuladoInstance = null;
let sessoesDisponiveis = [];

export const SimulacoesApp = {
  sessoesDisponiveis: [],
  dadosSessaoAtual: null,
  resultadoAtual: null,
  paramsAtuais: null,
  filasAtivas: [1],
  abaAtual: 'geral',

  async init() {
    await this.carregarSessoes();
    this.aplicarTemaInicial();
  },

  aplicarTemaInicial() {
    const temaSalvo = localStorage.getItem('fila_ru_tema');
    if (temaSalvo === 'escuro' || (!temaSalvo && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.body.classList.add('dark-mode');
    }
  },

  async carregarSessoes() {
    const sel = document.getElementById('sel-sessao');
    try {
      const res = await fetch('/api/sessoes');
      if (!res.ok) throw new Error('Falha ao obter lista de sessões.');
      sessoesDisponiveis = await res.json();
      this.sessoesDisponiveis = sessoesDisponiveis;

      sel.innerHTML = '';
      if (!sessoesDisponiveis || sessoesDisponiveis.length === 0) {
        sel.innerHTML = '<option value="">Nenhuma sessão encontrada</option>';
        return;
      }

      for (const s of sessoesDisponiveis) {
        const opt = document.createElement('option');
        opt.value = s.id;
        const dataStr = s.inicioMs ? new Date(s.inicioMs).toLocaleDateString('pt-BR') : '';
        const statusLabel = s.status === 'encerrada' ? 'Finalizada' : 'Em andamento';
        opt.textContent = `${s.nome || 'Sessão'} (${dataStr}) — ${statusLabel}`;
        sel.appendChild(opt);
      }
    } catch (err) {
      sel.innerHTML = '<option value="">Erro ao carregar sessões</option>';
      console.error(err);
    }
  },

  alternarModoF1(modo) {
    const grpTaxa = document.getElementById('grp-fatorF1');
    const grpTempo = document.getElementById('grp-tempoFixoF1');
    if (modo === 'tempoFixo') {
      grpTaxa.style.display = 'none';
      grpTempo.style.display = 'flex';
    } else {
      grpTaxa.style.display = 'flex';
      grpTempo.style.display = 'none';
    }
  },

  atualizarLabelSlider(inpId, lblId, sulfixo = '', ehDelta = false) {
    const inp = document.getElementById(inpId);
    const lbl = document.getElementById(lblId);
    if (!inp || !lbl) return;
    const val = Number(inp.value);
    const prefixo = (ehDelta && val > 0) ? '+' : '';
    lbl.textContent = `${prefixo}${val}${sulfixo}`;
  },

  restaurarValoresPadrao() {
    document.getElementById('inp-c1').value = '1';
    document.querySelector('input[name="modoF1"][value="taxa"]').checked = true;
    this.alternarModoF1('taxa');
    document.getElementById('inp-fatorF1').value = '0';
    this.atualizarLabelSlider('inp-fatorF1', 'lbl-fatorF1', '%');
    document.getElementById('inp-tempoFixoF1').value = '4';

    document.getElementById('inp-c2').value = '1';
    document.getElementById('inp-fatorF2').value = '0';
    this.atualizarLabelSlider('inp-fatorF2', 'lbl-fatorF2', '%');

    document.getElementById('inp-capacidadeMesas').value = '216';
    document.getElementById('inp-deltaMesas').value = '0';
    this.atualizarLabelSlider('inp-deltaMesas', 'lbl-deltaMesas', ' min', true);
  },

  exibirStatus(msg, tipo = 'info') {
    const box = document.getElementById('box-status-msg');
    box.style.display = 'block';
    box.textContent = msg;
    box.className = `status-${tipo}`;
  },

  ocultarStatus() {
    const box = document.getElementById('box-status-msg');
    box.style.display = 'none';
  },

  async executarSimulacao() {
    const sessaoId = document.getElementById('sel-sessao').value;
    if (!sessaoId) {
      alert('Por favor, selecione uma sessão base para simular.');
      return;
    }

    this.exibirStatus('Carregando traço empírico e executando simulação...', 'amarelo');
    const containerResultados = document.getElementById('container-resultados');
    containerResultados.style.display = 'none';

    try {
      const res = await fetch(`/api/sessoes/${encodeURIComponent(sessaoId)}`);
      if (!res.ok) throw new Error('Não foi possível obter os dados da sessão selecionada.');
      const dadosSessao = await res.json();

      if (!dadosSessao.eventos || dadosSessao.eventos.length < 5) {
        this.exibirStatus('Esta sessão não possui dados suficientes para simulação.', 'vermelho');
        return;
      }

      // Parâmetros da simulação
      const params = {
        c1: parseInt(document.getElementById('inp-c1').value, 10) || 1,
        modoF1: document.querySelector('input[name="modoF1"]:checked')?.value || 'taxa',
        fatorF1: Number(document.getElementById('inp-fatorF1').value) || 0,
        tempoFixoF1: Number(document.getElementById('inp-tempoFixoF1').value) || 4,
        c2: parseInt(document.getElementById('inp-c2').value, 10) || 1,
        fatorF2: Number(document.getElementById('inp-fatorF2').value) || 0,
        capacidadeMesas: parseInt(document.getElementById('inp-capacidadeMesas').value, 10) || 216,
        deltaMinutosMesas: Number(document.getElementById('inp-deltaMesas').value) || 0
      };

      const resultado = simularSessao(dadosSessao.eventos, dadosSessao.meta?.config || {}, params);

      if (!resultado.sucesso) {
        this.exibirStatus(`Falha na simulação: ${resultado.motivo}`, 'vermelho');
        return;
      }

      this.resultadoAtual = resultado;
      this.dadosSessaoAtual = dadosSessao;
      this.paramsAtuais = params;

      // Identifica filas ativas
      let ativas = dadosSessao.filasAtivas || dadosSessao.meta?.filasAtivas;
      if (!ativas || ativas.length === 0) {
        const chavesReais = Object.keys(resultado.metricasReais?.filas || {});
        ativas = chavesReais.length > 0 ? chavesReais.map(Number) : [1];
      }
      this.filasAtivas = Array.from(new Set(ativas)).sort((a, b) => a - b);

      this.ocultarStatus();
      this.construirAbasFilas(this.filasAtivas);
      containerResultados.style.display = 'block';

      this.selecionarAba(this.abaAtual || 'geral');

    } catch (err) {
      this.exibirStatus(`Erro ao executar simulação: ${err.message}`, 'vermelho');
      console.error(err);
    }
  },

  construirAbasFilas(filasAtivas) {
    const nav = document.getElementById('tab-nav-filas-sim');
    if (!nav) return;
    nav.innerHTML = '';

    const btnGeral = document.createElement('button');
    btnGeral.type = 'button';
    btnGeral.className = 'tab-btn active';
    btnGeral.id = 'tab-sim-btn-geral';
    btnGeral.textContent = 'Visão Geral';
    btnGeral.onclick = () => this.selecionarAba('geral');
    nav.appendChild(btnGeral);

    const nomes = {
      1: 'Fila 1 (Entrada → Catraca)',
      2: 'Fila 2 (Atendimento → Mesas)',
      3: 'Fila 3 (Mesas → Saída)'
    };

    filasAtivas.forEach(f => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.id = `tab-sim-btn-${f}`;

      const mFila = this.resultadoAtual?.metricasReais?.filas?.[String(f)] || this.resultadoAtual?.metricasReais?.filas?.[f];
      const semDados = mFila?.semDados;

      btn.innerHTML = `${nomes[f] || `Fila ${f}`} ${semDados ? '<span class="badge-sem-dados">Sem dados</span>' : ''}`;
      if (semDados) btn.classList.add('sem-dados');

      btn.onclick = () => this.selecionarAba(String(f));
      nav.appendChild(btn);
    });
  },

  selecionarAba(abaId) {
    this.abaAtual = abaId;

    document.querySelectorAll('#tab-nav-filas-sim .tab-btn').forEach(b => {
      const targetId = abaId === 'geral' ? 'tab-sim-btn-geral' : `tab-sim-btn-${abaId}`;
      b.classList.toggle('active', b.id === targetId);
    });

    const abaGeral = document.getElementById('aba-sim-geral');
    const abaFila = document.getElementById('aba-sim-fila-detalhe');

    if (abaId === 'geral') {
      if (abaGeral) abaGeral.style.display = 'flex';
      if (abaFila) abaFila.style.display = 'none';
      this.renderizarVisaoGeral();
    } else {
      if (abaGeral) abaGeral.style.display = 'none';
      if (abaFila) abaFila.style.display = 'flex';
      this.renderizarAbaFila(Number(abaId));
    }
  },

  renderizarVisaoGeral() {
    if (!this.resultadoAtual || !this.dadosSessaoAtual) return;
    const { calibracao, diagnostico, metricasSimuladas, metricasReais } = this.resultadoAtual;

    // 1. Banner de Calibração
    const bannerCalib = document.getElementById('banner-calibracao');
    if (bannerCalib) {
      if (calibracao.aderente) {
        bannerCalib.className = 'status-verde';
        bannerCalib.innerHTML = `<strong>✔ Calibração do Modelo Aderente:</strong> Desvio de apenas <strong>${formatarNumero(calibracao.diffPerc, 1)}%</strong> no tempo de espera do baseline em relação aos dados empíricos observados.`;
      } else {
        bannerCalib.className = 'status-amarelo';
        bannerCalib.innerHTML = `<strong>⚠️ Calibração com Variação (${formatarNumero(calibracao.diffPerc, 1)}%):</strong> O traço histórico original apresentou pequenas oscilações operacionais de campo (atendimento não-FIFO ou pausas manuais).`;
      }
    }

    // 2. Card de Diagnóstico
    const cardDiag = document.getElementById('card-diagnostico');
    if (cardDiag) {
      cardDiag.className = `status-card status-${diagnostico.status}`;
      cardDiag.innerHTML = `<span><strong>Diagnóstico Operacional:</strong> ${diagnostico.mensagem}</span>`;
    }

    // 3. Cards Resumo das Filas Ativas
    const containerCards = document.getElementById('cards-resumo-filas-sim');
    if (containerCards) {
      containerCards.innerHTML = '';
      const nomes = {
        1: { titulo: 'Fila 1 (Entrada → Catraca)', cor: '#dc2626' },
        2: { titulo: 'Fila 2 (Atendimento → Mesas)', cor: '#16a34a' },
        3: { titulo: 'Fila 3 (Mesas → Saída)', cor: '#ec4899' }
      };

      this.filasAtivas.forEach(f => {
        const mReal = metricasReais?.filas?.[String(f)] || metricasReais?.filas?.[f] || {};
        const mSim = metricasSimuladas?.filas?.[String(f)] || metricasSimuladas?.filas?.[f] || {};
        const cfg = nomes[f] || { titulo: `Fila ${f}`, cor: 'var(--primary)' };

        const card = document.createElement('div');
        card.className = 'card';
        card.style.borderTop = `4px solid ${cfg.cor}`;

        if (mReal.semDados) {
          card.innerHTML = `
            <div class="card-title">
              <span style="color:${cfg.cor}; font-weight:800;">${cfg.titulo}</span>
              <span class="badge-sem-dados">Sem dados</span>
            </div>
            <p style="font-size:0.85rem; color:var(--text-muted); padding:10px 0;">Nenhum evento registrado nesta fila na sessão base.</p>
          `;
        } else {
          const chegReal = mReal.n_chegadas ?? 0;
          const chegSim = mSim.n_chegadas ?? 0;
          const atendReal = mReal.n_atendimentos ?? 0;
          const atendSim = mSim.n_atendimentos ?? 0;

          const espRealSeg = mReal.statsEspera?.media ?? 0;
          const espSimSeg = mSim.statsEspera?.media ?? 0;
          const diffEspSeg = espSimSeg - espRealSeg;
          const diffEspPerc = espRealSeg > 0 ? (diffEspSeg / espRealSeg) * 100 : 0;
          const deltaEspClass = diffEspSeg < -0.5 ? 'delta-melhoria' : (diffEspSeg > 0.5 ? 'delta-piora' : 'delta-neutro');

          const utilReal = (mReal.utilizacao ?? 0) * 100;
          const utilSim = (mSim.utilizacao ?? 0) * 100;
          const diffUtil = utilSim - utilReal;

          const lReal = mReal.filaTempo?.mediaPonderada ?? 0;
          const lSim = mSim.filaTempo?.mediaPonderada ?? 0;

          card.innerHTML = `
            <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:${cfg.cor}; font-weight:800;">${cfg.titulo}</span>
              <span style="font-size:0.75rem; color:var(--text-muted);">Simulado vs. Real</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-top:6px;">
              <div class="hud-stat" style="padding:6px 10px;">
                <span class="label">Passagens</span>
                <span class="value" style="font-size:1.15rem;">${atendSim}</span>
                <span style="font-size:0.72rem; color:var(--text-muted)">Real: ${atendReal}</span>
              </div>
              <div class="hud-stat" style="padding:6px 10px;">
                <span class="label">Espera Média</span>
                <span class="value" style="font-size:1.15rem;">${formatarDuracao(espSimSeg * 1000).substring(3)}</span>
                <span style="font-size:0.72rem;" class="${deltaEspClass}">${diffEspSeg > 0 ? '+' : ''}${formatarNumero(diffEspPerc, 1)}% (Real: ${formatarDuracao(espRealSeg * 1000).substring(3)})</span>
              </div>
              <div class="hud-stat" style="padding:6px 10px;">
                <span class="label">Fila Média (L)</span>
                <span class="value" style="font-size:1.15rem;">${formatarNumero(lSim, 1)}</span>
                <span style="font-size:0.72rem; color:var(--text-muted)">Real: ${formatarNumero(lReal, 1)} (Pico: ${mSim.filaTempo?.max ?? 0})</span>
              </div>
              <div class="hud-stat" style="padding:6px 10px;">
                <span class="label">Utilização (ρ)</span>
                <span class="value" style="font-size:1.15rem;">${formatarNumero(utilSim, 1)}%</span>
                <span style="font-size:0.72rem; color:var(--text-muted)">Real: ${formatarNumero(utilReal, 1)}%</span>
              </div>
            </div>
            <div style="margin-top:10px; display:flex; justify-content:flex-end;">
              <button type="button" class="btn btn-secondary" style="font-size:0.78rem; padding:3px 10px;" onclick="SimulacoesApp.selecionarAba('${f}')">Ver Aferições da Fila ${f} →</button>
            </div>
          `;
        }
        containerCards.appendChild(card);
      });
    }

    // 4. Card Percurso Completo até as Mesas (F1 + F2)
    const cardTransito = document.getElementById('card-transito-mesas-sim');
    const tmReal = metricasReais?.transitoMesas;
    const tmSim = metricasSimuladas?.transitoMesas;
    if ((tmReal && tmReal.count > 0) || (tmSim && tmSim.count > 0)) {
      if (cardTransito) cardTransito.style.display = 'block';
      this.preencherCardTransito(tmReal, tmSim, 'tm-sim');
    } else {
      if (cardTransito) cardTransito.style.display = 'none';
    }

    // 5. Card Percurso Completo até a Saída (F1 + F2 + F3)
    const cardTransitoSaida = document.getElementById('card-transito-saida-sim');
    const tsReal = metricasReais?.transitoSaida;
    const tsSim = metricasSimuladas?.transitoSaida;
    if ((tsReal && tsReal.count > 0) || (tsSim && tsSim.count > 0)) {
      if (cardTransitoSaida) cardTransitoSaida.style.display = 'block';
      this.preencherCardTransito(tsReal, tsSim, 'ts-sim');
    } else {
      if (cardTransitoSaida) cardTransitoSaida.style.display = 'none';
    }

    // 6. Card Ocupação do Salão e Mesas
    const cardMesas = document.getElementById('card-ocupacao-mesas-sim');
    if (cardMesas) {
      const capMesas = diagnostico.capacidadeMesas || 216;
      const picoCad = diagnostico.picoOcupacaoMesas || 0;
      const picoPerc = capMesas > 0 ? Math.round((picoCad / capMesas) * 100) : 0;
      const livresPico = Math.max(0, capMesas - picoCad);
      const mediaCad = metricasSimuladas?.estatisticasMesas?.mediaOcupadas ?? 0;
      const mediaPerc = capMesas > 0 ? (mediaCad / capMesas) * 100 : 0;

      const elCap = document.getElementById('mesas-sim-capacidade-info');
      if (elCap) elCap.textContent = `Capacidade configurada: ${capMesas} lugares`;

      const elPico = document.getElementById('mesas-sim-pico-cadeiras');
      if (elPico) elPico.textContent = `${picoCad} cad.`;

      const elPicoPerc = document.getElementById('mesas-sim-pico-perc');
      if (elPicoPerc) elPicoPerc.textContent = `${picoPerc}% da capacidade`;

      const elLivres = document.getElementById('mesas-sim-livres-pico');
      if (elLivres) elLivres.textContent = `${livresPico}`;

      const elTotalLugares = document.getElementById('mesas-sim-total-lugares');
      if (elTotalLugares) elTotalLugares.textContent = `de ${capMesas} lugares`;

      const elMedia = document.getElementById('mesas-sim-media-cadeiras');
      if (elMedia) elMedia.textContent = `${formatarNumero(mediaCad, 1)} cad.`;

      const elMediaPerc = document.getElementById('mesas-sim-media-perc');
      if (elMediaPerc) elMediaPerc.textContent = `${formatarNumero(mediaPerc, 1)}% em média`;

      const elBloqQtd = document.getElementById('mesas-sim-bloqueados-qtd');
      if (elBloqQtd) elBloqQtd.textContent = `${diagnostico.alunosBloqueadosCount || 0}`;

      const elBloqStatus = document.getElementById('mesas-sim-bloqueio-status');
      if (elBloqStatus) {
        if (diagnostico.alunosBloqueadosCount > 0) {
          elBloqStatus.className = 'delta-piora';
          elBloqStatus.textContent = `⚠️ Retenção total: ${formatarNumero(diagnostico.tempoTotalBloqueadoSeg, 0)}s`;
        } else {
          elBloqStatus.className = 'delta-melhoria';
          elBloqStatus.textContent = '✅ Salão absorveu todo o fluxo';
        }
      }
    }

    // 7. Tabela Comparativa Consolidada
    this.renderizarTabelaConsolidada();

    // 8. Gráficos Chart.js Gerais
    this.renderizarGraficosGerais(
      this.dadosSessaoAtual.eventos,
      this.resultadoAtual.eventosSimulados,
      diagnostico.capacidadeMesas
    );
  },

  preencherCardTransito(tReal, tSim, prefixo) {
    const countEl = document.getElementById(`${prefixo}-count`);
    const countComp = document.getElementById(`${prefixo}-count-comp`);
    const cSim = tSim?.count || 0;
    const cReal = tReal?.count || 0;
    if (countEl) countEl.textContent = `${cSim}`;
    if (countComp) countComp.textContent = `Real: ${cReal}`;

    const atualizarMétricaTempo = (idMedia, idReal, idDelta, segSim, segReal) => {
      const elVal = document.getElementById(idMedia);
      const elReal = document.getElementById(idReal);
      const elDelta = document.getElementById(idDelta);

      if (elVal) elVal.textContent = formatarDuracao(segSim * 1000).substring(3);
      if (elReal) elReal.textContent = `Real: ${formatarDuracao(segReal * 1000).substring(3)}`;

      if (elDelta) {
        const diff = segSim - segReal;
        const diffPerc = segReal > 0 ? (diff / segReal) * 100 : 0;
        let classe = 'delta-neutro';
        if (Math.abs(diff) > 0.5) {
          classe = diff < 0 ? 'delta-melhoria' : 'delta-piora';
        }
        elDelta.className = classe;
        elDelta.textContent = `${diff > 0 ? '+' : ''}${formatarNumero(diffPerc, 1)}%`;
      }
    };

    atualizarMétricaTempo(`${prefixo}-media`, `${prefixo}-media-real`, `${prefixo}-media-delta`, tSim?.mediaSeg || 0, tReal?.mediaSeg || 0);
    atualizarMétricaTempo(`${prefixo}-mediana`, `${prefixo}-mediana-real`, `${prefixo}-mediana-delta`, tSim?.medianaSeg || 0, tReal?.medianaSeg || 0);
    atualizarMétricaTempo(`${prefixo}-p90`, `${prefixo}-p90-real`, `${prefixo}-p90-delta`, tSim?.p90Seg || 0, tReal?.p90Seg || 0);
  },

  renderizarTabelaConsolidada() {
    const tbody = document.getElementById('tbody-metricas');
    if (!tbody) return;
    tbody.innerHTML = '';

    const { metricasSimuladas, metricasReais, diagnostico } = this.resultadoAtual;
    const mReal1 = metricasReais?.filas?.[1];
    const mSim1 = metricasSimuladas?.filas?.[1];
    const mReal2 = metricasReais?.filas?.[2];
    const mSim2 = metricasSimuladas?.filas?.[2];

    const linhas = [
      {
        nome: 'Alunos Atendidos na Catraca (n_s)',
        real: mReal1?.n_atendimentos || 0,
        sim: mSim1?.n_atendimentos || 0,
        tipo: 'int',
        inverterMelhoria: true
      },
      {
        nome: 'Tempo Médio de Espera na Fila 1 (Catraca)',
        real: mReal1?.statsEspera?.media || 0,
        sim: mSim1?.statsEspera?.media || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Mediana de Espera na Fila 1',
        real: mReal1?.statsEspera?.mediana || 0,
        sim: mSim1?.statsEspera?.mediana || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Percentil 95 (P95) de Espera Fila 1',
        real: mReal1?.statsEspera?.p95 || 0,
        sim: mSim1?.statsEspera?.p95 || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Fila Média Ponderada no Tempo (L_q1)',
        real: mReal1?.filaTempo?.mediaPonderada || 0,
        sim: mSim1?.filaTempo?.mediaPonderada || 0,
        tipo: 'num2'
      },
      {
        nome: 'Pico de Pessoas na Fila 1',
        real: mReal1?.filaTempo?.max || 0,
        sim: mSim1?.filaTempo?.max || 0,
        tipo: 'int'
      },
      {
        nome: 'Fator de Utilização das Catracas (ρ₁)',
        real: (mReal1?.utilizacao || 0) * 100,
        sim: (mSim1?.utilizacao || 0) * 100,
        tipo: 'perc'
      },
      {
        nome: 'Tempo Médio de Espera na Fila 2 (Buffet)',
        real: mReal2?.statsEspera?.media || 0,
        sim: mSim2?.statsEspera?.media || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Fator de Utilização do Buffet (ρ₂)',
        real: (mReal2?.utilizacao || 0) * 100,
        sim: (mSim2?.utilizacao || 0) * 100,
        tipo: 'perc'
      },
      {
        nome: 'Tempo Médio de Trânsito até as Mesas (F1 + F2)',
        real: metricasReais?.transitoMesas?.mediaSeg || 0,
        sim: metricasSimuladas?.transitoMesas?.mediaSeg || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Pico de Assentos Ocupados nas Mesas',
        real: metricasReais?.estatisticasMesas?.picoOcupadas || metricasReais?.mesas?.picoOcupacao || 0,
        sim: diagnostico.picoOcupacaoMesas || 0,
        tipo: 'int'
      },
      {
        nome: 'Alunos Bloqueados por Falta de Cadeiras',
        real: 0,
        sim: diagnostico.alunosBloqueadosCount || 0,
        tipo: 'int'
      }
    ];

    for (const item of linhas) {
      const tr = document.createElement('tr');
      const tdNome = document.createElement('td');
      tdNome.textContent = item.nome;

      const tdReal = document.createElement('td');
      tdReal.className = 'num';
      tdReal.textContent = this.formatarValorMetrica(item.real, item.tipo);

      const tdSim = document.createElement('td');
      tdSim.className = 'num';
      tdSim.textContent = this.formatarValorMetrica(item.sim, item.tipo);

      const tdDelta = document.createElement('td');
      tdDelta.className = 'num';

      const diff = item.sim - item.real;
      const diffPerc = item.real > 0 ? (diff / item.real) * 100 : (item.sim > 0 ? 100 : 0);

      let classeDelta = 'delta-neutro';
      if (Math.abs(diff) > 0.01) {
        const ehMelhor = item.inverterMelhoria ? diff > 0 : diff < 0;
        classeDelta = ehMelhor ? 'delta-melhoria' : 'delta-piora';
      }

      const sinal = diff > 0 ? '+' : '';
      tdDelta.className = `num ${classeDelta}`;
      tdDelta.textContent = `${sinal}${formatarNumero(diffPerc, 1)}%`;

      tr.appendChild(tdNome);
      tr.appendChild(tdReal);
      tr.appendChild(tdSim);
      tr.appendChild(tdDelta);
      tbody.appendChild(tr);
    }
  },

  renderizarAbaFila(fNum) {
    if (!this.resultadoAtual) return;
    const { metricasSimuladas, metricasReais, diagnostico, params } = this.resultadoAtual;

    const mReal = metricasReais?.filas?.[String(fNum)] || metricasReais?.filas?.[fNum] || {};
    const mSim = metricasSimuladas?.filas?.[String(fNum)] || metricasSimuladas?.filas?.[fNum] || {};

    const boxSemDados = document.getElementById('box-sim-sem-dados');
    const containerKpis = document.getElementById('container-sim-kpis-fila');

    const toggleSection = (id, show) => {
      const el = document.getElementById(id);
      if (el) {
        const container = el.closest('.chart-container') || el.closest('.card') || el.parentElement;
        if (container) container.style.display = show ? '' : 'none';
      }
    };

    if (mReal.semDados) {
      if (boxSemDados) boxSemDados.style.display = 'block';
      if (containerKpis) containerKpis.style.display = 'none';
      toggleSection('box-sim-ociosidade', false);
      toggleSection('box-sim-postos-info', false);
      toggleSection('box-sim-little', false);
      toggleSection('box-sim-teorico', false);
      const tblB = document.getElementById('tabela-sim-blocos-corpo');
      if (tblB && tblB.parentElement?.parentElement?.parentElement) {
        tblB.parentElement.parentElement.parentElement.style.display = 'none';
      }
      toggleSection('chart-sim-fila-acumulado', false);
      return;
    }

    if (boxSemDados) boxSemDados.style.display = 'none';
    if (containerKpis) containerKpis.style.display = 'grid';
    toggleSection('box-sim-ociosidade', true);
    toggleSection('box-sim-postos-info', true);
    toggleSection('box-sim-little', true);
    toggleSection('box-sim-teorico', true);
    const tblB = document.getElementById('tabela-sim-blocos-corpo');
    if (tblB && tblB.parentElement?.parentElement?.parentElement) {
      tblB.parentElement.parentElement.parentElement.style.display = 'block';
    }
    toggleSection('chart-sim-fila-acumulado', true);

    // 1. Grid de 8 KPIs da Fila
    this.renderizarKpisFila(mReal, mSim, fNum, params);

    // 2. Ociosidade Segmentada & Bloqueio Operacional
    this.renderizarOciosidadeEBloqueio(mReal, mSim, fNum, diagnostico);

    // 3. Equipe & Postos Ativos
    this.renderizarEquipeEPostos(mReal, mSim, fNum, params);

    // 4. Lei de Little (L = λ · W)
    this.renderizarLeiDeLittle(mReal, mSim);

    // 5. Modelo Teórico Erlang C
    this.renderizarModeloTeorico(mReal, mSim);

    // 6. Tabela de Blocos de Tempo (Janelas de 5 minutos)
    this.renderizarTabelaBlocosSimulada(mReal, mSim);

    // 7. Gráficos Acumulados da Fila
    this.renderizarGraficoAcumuladoFila(mReal, mSim, fNum);
  },

  renderizarKpisFila(mReal, mSim, fNum, params) {
    const container = document.getElementById('container-sim-kpis-fila');
    if (!container) return;
    container.innerHTML = '';

    const criarCard = (label, valSim, valReal, tipo, subTexto, inverterMelhoria = false) => {
      const diff = valSim - valReal;
      const diffPerc = valReal > 0 ? (diff / valReal) * 100 : (valSim > 0 ? 100 : 0);

      let classeDelta = 'delta-neutro';
      if (Math.abs(diff) > 0.01) {
        const ehMelhor = inverterMelhoria ? diff > 0 : diff < 0;
        classeDelta = ehMelhor ? 'delta-melhoria' : 'delta-piora';
      }

      const card = document.createElement('div');
      card.className = 'hud-stat';
      card.innerHTML = `
        <span class="label">${label}</span>
        <span class="value">${this.formatarValorMetrica(valSim, tipo)}</span>
        <div class="kpi-delta-row">
          <span style="color:var(--text-muted)">Real: <strong>${this.formatarValorMetrica(valReal, tipo)}</strong></span>
          <span class="${classeDelta}">${diff > 0 ? '+' : ''}${formatarNumero(diffPerc, 1)}%</span>
        </div>
        <span style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">${subTexto}</span>
      `;
      return card;
    };

    // 1. Total Chegadas (λ)
    container.appendChild(criarCard(
      'Total Chegadas (λ)',
      mSim.n_chegadas ?? 0,
      mReal.n_chegadas ?? 0,
      'int',
      `λ sim = ${formatarNumero(mSim.lambda ?? 0, 2)} p/min (Real: ${formatarNumero(mReal.lambda ?? 0, 2)})`,
      true
    ));

    // 2. Total Passagens (Vazão)
    container.appendChild(criarCard(
      'Total Passagens (Vazão)',
      mSim.n_atendimentos ?? 0,
      mReal.n_atendimentos ?? 0,
      'int',
      `Vazão sim: ${formatarNumero(mSim.vazaoGlobalPorMin ?? 0, 2)} p/min (Real: ${formatarNumero(mReal.vazaoGlobalPorMin ?? 0, 2)})`,
      true
    ));

    // 3. Utilização dos Servidores (ρ)
    const postosCount = fNum === 1 ? params.c1 : (fNum === 2 ? params.c2 : 1);
    container.appendChild(criarCard(
      'Utilização (ρ)',
      (mSim.utilizacao ?? 0) * 100,
      (mReal.utilizacao ?? 0) * 100,
      'perc',
      `μ sim: ${formatarNumero(mSim.muPorServidor ?? 0, 2)} p/min por posto (c = ${postosCount})`,
      false
    ));

    // 4. Fila Média (L)
    container.appendChild(criarCard(
      'Fila Média Ponderada (L)',
      mSim.filaTempo?.mediaPonderada ?? 0,
      mReal.filaTempo?.mediaPonderada ?? 0,
      'num2',
      `Pico sim: ${mSim.filaTempo?.max ?? 0} (Real: ${mReal.filaTempo?.max ?? 0})`,
      false
    ));

    // 5. Tempo Médio de Espera (W_q)
    container.appendChild(criarCard(
      'Tempo de Espera Médio',
      mSim.statsEspera?.media ?? 0,
      mReal.statsEspera?.media ?? 0,
      'tempo',
      `Mediana sim: ${formatarDuracao((mSim.statsEspera?.mediana ?? 0) * 1000).substring(3)} (Real: ${formatarDuracao((mReal.statsEspera?.mediana ?? 0) * 1000).substring(3)})`,
      false
    ));

    // 6. Espera P90 / P95
    container.appendChild(criarCard(
      'Espera P95',
      mSim.statsEspera?.p95 ?? 0,
      mReal.statsEspera?.p95 ?? 0,
      'tempo',
      `P90 sim: ${formatarDuracao((mSim.statsEspera?.p90 ?? 0) * 1000).substring(3)} (Real: ${formatarDuracao((mReal.statsEspera?.p90 ?? 0) * 1000).substring(3)})`,
      false
    ));

    // 7. Intervalo Médio entre Atendimentos
    container.appendChild(criarCard(
      'Intervalo entre Atendimentos',
      mSim.statsIntervalosAtend?.media ?? 0,
      mReal.statsIntervalosAtend?.media ?? 0,
      'seg',
      `CV sim: ${formatarNumero(mSim.statsIntervalosAtend?.cv ?? 0, 2)} (Real: ${formatarNumero(mReal.statsIntervalosAtend?.cv ?? 0, 2)})`,
      false
    ));

    // 8. Capacidade e Servidores Ativos
    const capNominal = (mSim.muPorServidor ?? 0) * postosCount;
    const cardCap = document.createElement('div');
    cardCap.className = 'hud-stat';
    cardCap.innerHTML = `
      <span class="label">Capacidade do Setor</span>
      <span class="value" style="font-size:1.25rem;">${formatarNumero(capNominal, 1)} <span style="font-size:0.8rem; font-weight:600;">p/min</span></span>
      <div class="kpi-delta-row">
        <span style="color:var(--text-muted)">Servidores ativos: <strong>${postosCount}</strong></span>
        <span class="delta-melhoria">c = ${postosCount}</span>
      </div>
      <span style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">Aceleração configurada no cenário</span>
    `;
    container.appendChild(cardCap);
  },

  renderizarOciosidadeEBloqueio(mReal, mSim, fNum, diagnostico) {
    const box = document.getElementById('box-sim-ociosidade');
    if (!box) return;

    const detSim = mSim.ociosidade?.detalhe || {};
    const detReal = mReal.ociosidade?.detalhe || {};

    let html = `
      <p>• <strong>(a) Serviço parado (com fila):</strong> Simulado: ${formatarDuracao((detSim.servicoParadoSeg || 0) * 1000)} (${formatarNumero(detSim.percServicoParado || 0, 1)}%) | Real: ${formatarDuracao((detReal.servicoParadoSeg || 0) * 1000)} (${formatarNumero(detReal.percServicoParado || 0, 1)}%)</p>
      <p>• <strong>(b) Sem demanda (serviço livre):</strong> Simulado: ${formatarDuracao((detSim.semDemandaSeg || 0) * 1000)} (${formatarNumero(detSim.percSemDemanda || 0, 1)}%) | Real: ${formatarDuracao((detReal.semDemandaSeg || 0) * 1000)} (${formatarNumero(detReal.percSemDemanda || 0, 1)}%)</p>
    `;

    if (fNum === 2) {
      if (diagnostico.alunosBloqueadosCount > 0) {
        html += `
          <div style="margin-top:8px; padding:8px 12px; background:rgba(220, 38, 38, 0.1); border-left:4px solid #dc2626; border-radius:4px;">
            <strong style="color:#dc2626;">⛔ Retenção por Service Blocking nas Mesas:</strong><br>
            <span><strong>${diagnostico.alunosBloqueadosCount} alunos</strong> aguardaram liberação de assento segurando a bandeja. Tempo acumulado de retenção na distribuição: <strong>${formatarNumero(diagnostico.tempoTotalBloqueadoSeg, 0)} segundos</strong>.</span>
          </div>
        `;
      } else {
        html += `
          <div style="margin-top:8px; padding:8px 12px; background:rgba(22, 163, 74, 0.1); border-left:4px solid #16a34a; border-radius:4px;">
            <strong style="color:#16a34a;">✅ Distribuição Contínua Sem Bloqueio:</strong><br>
            <span>Nenhum aluno foi retido nas linhas de distribuição por falta de assentos nas mesas.</span>
          </div>
        `;
      }
    } else {
      html += `
        <p style="margin-top:6px; color:var(--text-muted); font-size:0.8rem;">
          Pausas prolongadas observadas no traço: <strong>${mSim.ociosidade?.qtdPausas || 0}</strong>
        </p>
      `;
    }

    box.innerHTML = html;
  },

  renderizarEquipeEPostos(mReal, mSim, fNum, params) {
    const box = document.getElementById('box-sim-postos-info');
    if (!box) return;

    const postos = fNum === 1 ? params.c1 : (fNum === 2 ? params.c2 : 1);
    let configTxt = '';

    if (fNum === 1) {
      if (params.modoF1 === 'tempoFixo') {
        configTxt = `Tempo fixo de <strong>${params.tempoFixoF1}s por aluno</strong> (Substituição estrita).`;
      } else {
        const sinal = params.fatorF1 > 0 ? '+' : '';
        configTxt = `Fator de velocidade: <strong>${sinal}${params.fatorF1}%</strong> na taxa de passagem.`;
      }
    } else if (fNum === 2) {
      const sinal = params.fatorF2 > 0 ? '+' : '';
      configTxt = `Aceleração no buffet: <strong>${sinal}${params.fatorF2}%</strong> no serviço de distribuição.`;
    } else {
      configTxt = `Fluxo de saída pelas portas com tempo observado no traço.`;
    }

    box.innerHTML = `
      <p>• <strong>Postos de Atendimento:</strong> <strong>${postos} posto(s)</strong> em despacho paralelo FIFO.</p>
      <p>• <strong>Taxa de Serviço por Servidor:</strong> <strong>μ = ${formatarNumero(mSim.muPorServidor ?? 0, 2)} atendimentos/min</strong>.</p>
      <p>• <strong>Capacidade Máxima do Setor:</strong> <strong>${formatarNumero((mSim.muPorServidor ?? 0) * postos, 2)} pessoas/min</strong>.</p>
      <p style="margin-top:6px; font-size:0.82rem; color:var(--text-muted);">${configTxt}</p>
    `;
  },

  renderizarLeiDeLittle(mReal, mSim) {
    const box = document.getElementById('box-sim-little');
    if (!box) return;

    const lSim = mSim.little || {};
    const lReal = mReal.little || {};

    box.innerHTML = `
      <p>• <strong>Cenário Simulado:</strong></p>
      <p style="padding-left:12px;">- Fila Média Observada (L): <strong>${formatarNumero(lSim.L_observado ?? 0, 2)} pessoas</strong></p>
      <p style="padding-left:12px;">- Produto λ · W: <strong>${formatarNumero(lSim.L_calculado_lambda_W ?? 0, 2)} pessoas</strong></p>
      <p style="padding-left:12px;">- Discrepância: <strong>${formatarNumero(lSim.diffPerc ?? 0, 1)}%</strong> ${lSim.consistente ? '✅ (Consistente no simulador)' : '⚠️ (Normal em amostragem finita)'}</p>
      <p style="margin-top:6px;">• <strong>Cenário Real (Baseline):</strong> L = ${formatarNumero(lReal.L_observado ?? 0, 2)} | λ·W = ${formatarNumero(lReal.L_calculado_lambda_W ?? 0, 2)} (Diferença: ${formatarNumero(lReal.diffPerc ?? 0, 1)}%)</p>
    `;
  },

  renderizarModeloTeorico(mReal, mSim) {
    const box = document.getElementById('box-sim-teorico');
    if (!box) return;

    const teoSim = mSim.teorico || {};

    if (teoSim.aplicavel) {
      box.innerHTML = `
        <p>• <strong>Servidores:</strong> c = ${teoSim.c} • <strong>Intensidade de Tráfego:</strong> a = ${formatarNumero(teoSim.a ?? 0, 2)} Erlangs</p>
        <p>• <strong>Fila Teórica Erlang C (L_q):</strong> <strong>${formatarNumero(teoSim.Lq ?? 0, 2)} pessoas</strong> (Traço Simulado: ${formatarNumero(mSim.filaTempo?.mediaPonderada ?? 0, 2)})</p>
        <p>• <strong>Tempo de Espera Teórico (W_q):</strong> <strong>${formatarDuracao((teoSim.Wq_seg ?? 0) * 1000).substring(3)}</strong> (Traço Simulado: ${formatarDuracao((mSim.statsEspera?.media ?? 0) * 1000).substring(3)})</p>
        <p>• <strong>Probabilidade de Espera P(W > 0):</strong> <strong>${formatarNumero((teoSim.P_espera ?? 0) * 100, 1)}%</strong></p>
      `;
    } else {
      box.innerHTML = `
        <span style="color:var(--warning); font-weight:600;">⚠️ ${teoSim.motivo || 'Modelo analítico M/M/c não aplicável ao cenário simulado (utilização ρ ≥ 100% ou regime transitório).'}</span>
      `;
    }
  },

  renderizarTabelaBlocosSimulada(mReal, mSim) {
    const corpo = document.getElementById('tabela-sim-blocos-corpo');
    if (!corpo) return;
    corpo.innerHTML = '';

    const blocosSim = mSim.vazaoBlocos?.blocos || [];
    const blocosReal = mReal.vazaoBlocos?.blocos || [];

    if (blocosSim.length === 0) {
      corpo.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:12px; color:var(--text-muted)">Nenhum bloco de tempo registrado.</td></tr>';
      return;
    }

    blocosSim.forEach((bSim, idx) => {
      const bReal = blocosReal[idx] || { chegadas: 0, atendimentos: 0 };
      const tr = document.createElement('tr');

      const passagensSim = bSim.atendimentos ?? 0;
      const passagensReal = bReal.atendimentos ?? 0;
      const diff = passagensSim - passagensReal;
      const diffPerc = passagensReal > 0 ? (diff / passagensReal) * 100 : (passagensSim > 0 ? 100 : 0);

      const zeroSim = passagensSim === 0;
      if (zeroSim) tr.className = 'bloco-sem-passagens';

      let situacaoHtml = '<span style="color:var(--text-muted);">Normal</span>';
      if (passagensReal === 0 && passagensSim > 0) {
        situacaoHtml = '<span style="color:#16a34a; font-weight:700;">⚡ Represamento eliminado</span>';
      } else if (zeroSim) {
        situacaoHtml = '<span style="color:#dc2626; font-weight:700;">⚠️ ZERO PASSAGENS</span>';
      } else if (diff > 0) {
        situacaoHtml = `<span style="color:#16a34a; font-weight:600;">+${diff} atendimentos</span>`;
      }

      const durMin = ((bSim.fimMs - bSim.inicioMs) / 60000) || 5;
      const vazaoMin = passagensSim / durMin;

      const deltaClass = diff > 0 ? 'delta-melhoria' : (diff < 0 ? 'delta-piora' : 'delta-neutro');

      tr.innerHTML = `
        <td><strong>${bSim.rotulo}</strong></td>
        <td>${formatarHoraLocal(bSim.inicioMs)} - ${formatarHoraLocal(bSim.fimMs)}</td>
        <td style="text-align:right;">${bSim.chegadas}</td>
        <td style="text-align:right;">${passagensReal}</td>
        <td style="text-align:right; font-weight:700;">${passagensSim}</td>
        <td style="text-align:right;" class="${deltaClass}">${diff > 0 ? '+' : ''}${formatarNumero(diffPerc, 1)}%</td>
        <td style="text-align:right;">${formatarNumero(vazaoMin, 1)} p/min</td>
        <td style="text-align:center;">${situacaoHtml}</td>
      `;
      corpo.appendChild(tr);
    });
  },

  renderizarGraficoAcumuladoFila(mReal, mSim, fNum) {
    if (typeof Chart === 'undefined') return;

    const ctx = document.getElementById('chart-sim-fila-acumulado');
    if (!ctx) return;

    if (chartAcumuladoInstance) {
      chartAcumuladoInstance.destroy();
      chartAcumuladoInstance = null;
    }

    const blocosSim = mSim.vazaoBlocos?.blocos || [];
    const blocosReal = mReal.vazaoBlocos?.blocos || [];

    const labels = blocosSim.map(b => b.rotulo);

    let acumCheg = 0;
    let acumReal = 0;
    let acumSim = 0;

    const dataCheg = blocosSim.map(b => (acumCheg += b.chegadas));
    const dataReal = blocosSim.map((b, idx) => (acumReal += (blocosReal[idx]?.atendimentos || 0)));
    const dataSim = blocosSim.map(b => (acumSim += b.atendimentos));

    chartAcumuladoInstance = new Chart(ctx.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Chegadas Acumuladas',
            data: dataCheg,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            fill: true,
            tension: 0.2,
            pointRadius: 2
          },
          {
            label: 'Passagens Reais Acumuladas',
            data: dataReal,
            borderColor: '#f59e0b',
            borderDash: [5, 5],
            fill: false,
            tension: 0.2,
            pointRadius: 2
          },
          {
            label: 'Passagens Simuladas Acumuladas',
            data: dataSim,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            fill: false,
            tension: 0.2,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top' },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { title: { display: true, text: 'Janelas de Tempo (5 min)' } },
          y: { beginAtZero: true, title: { display: true, text: 'Pessoas Acumuladas' } }
        }
      }
    });
  },

  formatarValorMetrica(val, tipo) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    if (tipo === 'tempo') return formatarDuracao(val * 1000).substring(3);
    if (tipo === 'tempo_completo') return formatarDuracao(val * 1000);
    if (tipo === 'perc') return `${formatarNumero(val, 1)}%`;
    if (tipo === 'int') return Math.round(val).toLocaleString('pt-BR');
    if (tipo === 'seg') return `${formatarNumero(val, 1)} s`;
    if (tipo === 'num1') return formatarNumero(val, 1);
    return formatarNumero(val, 2);
  },

  renderizarGraficosGerais(eventosReais, eventosSimulados, capacidadeMesas) {
    const t0 = eventosReais[0]?.t || Date.now();
    const tFim = Math.max(
      eventosReais[eventosReais.length - 1]?.t || t0,
      eventosSimulados[eventosSimulados.length - 1]?.t || t0
    );

    const duracaoTotalMs = tFim - t0;
    const passoMs = Math.max(30000, Math.floor(duracaoTotalMs / 60)); // ~60 pontos
    const rotulos = [];
    const filaRealPontos = [];
    const filaSimPontos = [];
    const mesasSimPontos = [];

    for (let t = t0; t <= tFim; t += passoMs) {
      const minRelativo = Math.round((t - t0) / 60000);
      rotulos.push(`${minRelativo}m`);

      const estReal = derivarEstado(eventosReais, t);
      const estSim = derivarEstado(eventosSimulados, t);

      filaRealPontos.push(estReal?.filas?.[1]?.fila?.length || 0);
      filaSimPontos.push(estSim?.filas?.[1]?.fila?.length || 0);
      mesasSimPontos.push(estSim?.mesas?.cadeirasOcupadas || 0);
    }

    // Gráfico 1: Fila 1 no Tempo
    if (chartFilaInstance) {
      chartFilaInstance.destroy();
      chartFilaInstance = null;
    }
    const ctxFila = document.getElementById('chart-fila-tempo');
    if (ctxFila) {
      chartFilaInstance = new Chart(ctxFila.getContext('2d'), {
        type: 'line',
        data: {
          labels: rotulos,
          datasets: [
            {
              label: 'Cenário Real',
              data: filaRealPontos,
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              tension: 0.2,
              pointRadius: 1
            },
            {
              label: 'Cenário Simulado',
              data: filaSimPontos,
              borderColor: '#16a34a',
              backgroundColor: 'rgba(22, 163, 74, 0.1)',
              tension: 0.2,
              pointRadius: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'Pessoas na Fila' } },
            x: { title: { display: true, text: 'Tempo Decorrido' } }
          }
        }
      });
    }

    // Gráfico 2: Ocupação das Mesas no Tempo
    if (chartMesasInstance) {
      chartMesasInstance.destroy();
      chartMesasInstance = null;
    }
    const ctxMesas = document.getElementById('chart-mesas-tempo');
    if (ctxMesas) {
      chartMesasInstance = new Chart(ctxMesas.getContext('2d'), {
        type: 'line',
        data: {
          labels: rotulos,
          datasets: [
            {
              label: 'Cadeiras Ocupadas (Simulado)',
              data: mesasSimPontos,
              borderColor: '#ec4899',
              backgroundColor: 'rgba(236, 72, 153, 0.15)',
              tension: 0.2,
              pointRadius: 1,
              fill: true
            },
            {
              label: `Capacidade Nominal (${capacidadeMesas})`,
              data: new Array(rotulos.length).fill(capacidadeMesas),
              borderColor: '#dc2626',
              borderDash: [5, 5],
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'Cadeiras Ocupadas' } },
            x: { title: { display: true, text: 'Tempo Decorrido' } }
          }
        }
      });
    }
  }
};

window.SimulacoesApp = SimulacoesApp;
window.toggleTheme = function() {
  document.body.classList.toggle('dark-mode');
  const ehEscuro = document.body.classList.contains('dark-mode');
  localStorage.setItem('fila_ru_tema', ehEscuro ? 'escuro' : 'claro');
};

document.addEventListener('DOMContentLoaded', () => {
  SimulacoesApp.init();
});
