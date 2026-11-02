/**
 * public/historico.js
 * Lógica da tela de histórico, reprodução fiel do percurso em todas as zonas gravadas,
 * gráficos estatísticos analíticos (área empilhada, acumulado por ponto, histogramas),
 * exportação em múltiplos formatos e comparação entre sessões.
 */

import { derivarEstado } from '../shared/estado.js';
import { calcularMetricas, formatarDuracao, formatarHoraLocal, formatarNumero } from '../shared/metricas.js';
import { AnimadorFila } from './animacao.js';

export const HistoricoApp = {
  sessaoAtual: null,
  dadosCompletos: null,
  animador: null,
  graficos: {},
  ordenacaoTabela: { coluna: 'pessoa', asc: true },

  // Estado do Player de Reprodução
  replay: {
    ativo: false,
    timer: null,
    velocidade: 5,
    tAtual: 0,
    tInicio: 0,
    tFim: 0,
    duracaoTotal: 0
  },

  async init() {
    this.animador = new AnimadorFila('container-animacao-replay');
    await this.carregarListaSessoes();
  },

  async carregarListaSessoes() {
    const container = document.getElementById('lista-sessoes-container');
    const mostrarTestes = document.getElementById('chk-mostrar-testes').checked;

    try {
      const resp = await fetch('/api/sessoes');
      let sessoes = await resp.json();

      if (!mostrarTestes) {
        sessoes = sessoes.filter(s => !s.teste);
      }

      container.innerHTML = '';
      if (sessoes.length === 0) {
        container.innerHTML = '<span style="color:var(--text-muted); text-align:center; padding:15px;">Nenhuma sessão encontrada. Inicie uma nova coleta no Painel.</span>';
        return;
      }

      for (const s of sessoes) {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.padding = '10px 14px';
        item.style.borderRadius = '8px';
        item.style.background = 'var(--bg-subtle)';
        item.style.border = '1px solid var(--border-color)';
        item.style.cursor = 'pointer';

        const dataStr = new Date(s.inicioMs).toLocaleDateString('pt-BR');
        const horaStr = formatarHoraLocal(s.inicioMs);
        const tagTeste = s.teste ? '<span style="background:var(--warning); color:#fff; padding:2px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;">TESTE</span>' : '';

        // Resumo das zonas configuradas na sessão
        const zonasNomes = (s.zonas || s.config?.zonas || [{ nome: 'Fila inicial' }])
          .filter(z => z.habilitada !== false)
          .map(z => z.nome)
          .join(', ');

        item.innerHTML = `
          <div>
            <div style="font-weight:700; font-size:1rem; display:flex; align-items:center; gap:8px;">
              <span>${s.nome}</span> ${tagTeste}
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
              ${s.local} • Início: ${dataStr} ${horaStr} • Status: <strong>${s.status}</strong>
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
              Zonas: ${zonasNomes}
            </div>
          </div>
          <div class="btn-group" onclick="event.stopPropagation()">
            <button class="btn btn-primary" style="padding:4px 10px; font-size:0.8rem;" onclick="HistoricoApp.abrirSessao('${s.id}')">Abrir Relatório</button>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:0.8rem;" onclick="HistoricoApp.renomearSessao('${s.id}')">✏️</button>
            <button class="btn btn-danger" style="padding:4px 8px; font-size:0.8rem;" onclick="HistoricoApp.excluirSessao('${s.id}')">🗑</button>
          </div>
        `;

        item.onclick = () => this.abrirSessao(s.id);
        container.appendChild(item);
      }
    } catch (err) {
      container.innerHTML = `<span style="color:var(--danger)">Erro ao carregar sessões: ${err.message}</span>`;
    }
  },

  async abrirSessao(id) {
    try {
      const resp = await fetch(`/api/sessoes/${id}`);
      this.dadosCompletos = await resp.json();
      this.sessaoAtual = this.dadosCompletos.meta;

      document.getElementById('card-lista-sessoes').style.display = 'none';
      document.getElementById('detalhes-sessao').style.display = 'flex';

      this.preencherRelatorio(this.dadosCompletos);
      this.iniciarPlayerReplay(this.dadosCompletos.eventos);
      this.renderizarGraficos(this.dadosCompletos);
      this.renderizarTabelaPessoas();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      alert('Erro ao carregar detalhes da sessão: ' + err.message);
    }
  },

  preencherRelatorio(dados) {
    const meta = dados.meta;
    const m = dados.metricas;

    document.getElementById('rel-nome').textContent = meta.nome;
    document.getElementById('rel-sub').textContent =
      `${meta.local} • Início: ${formatarHoraLocal(m.inicioMs)} • Duração: ${formatarDuracao(m.duracaoTotalMs)} (${formatarNumero(m.duracaoMin, 1)} min)`;
    document.getElementById('rel-obs').textContent = meta.observacoes ? `Observações: "${meta.observacoes}"` : '';

    // KPIs Globais
    document.getElementById('kpi-cheg').textContent = m.balanco?.chegadas ?? m.n_chegadas;
    document.getElementById('kpi-lambda').textContent = `λ = ${formatarNumero(m.global?.lambdaGlobal ?? m.lambda, 2)} p/min`;
    document.getElementById('kpi-atend').textContent = m.balanco?.saidas ?? m.n_atendimentos;
    document.getElementById('kpi-vazao-global').textContent = `Vazão = ${formatarNumero(m.vazaoGlobalPorMin, 2)} p/min`;

    const tempoMedioSistema = m.global?.tempoMedioSistemaSeg || m.statsEspera.media;
    document.getElementById('kpi-tempo-sistema').textContent = formatarDuracao(tempoMedioSistema * 1000).substring(3);
    document.getElementById('kpi-tempo-sistema-seg').textContent = `${formatarNumero(tempoMedioSistema, 1)} seg`;

    document.getElementById('kpi-l').textContent = formatarNumero(m.global?.L_medioGlobal ?? m.filaTempo.mediaPonderada, 1);
    document.getElementById('kpi-pico').textContent = `Presentes: ${m.balanco?.presentes ?? m.n_na_fila}`;

    // Tabela por Zona
    const corpoZonas = document.getElementById('corpo-metricas-zonas');
    corpoZonas.innerHTML = '';

    for (const z of Object.values(m.zonas)) {
      const tr = document.createElement('tr');
      const divLittle = z.divergenciaLittle;
      const rotuloEst = z.modo === 'contagem' ? ' <span class="badge-estimado">estimado</span>' : '';

      tr.innerHTML = `
        <td><strong style="color:${z.cor};">■</strong> <strong>${z.nome}</strong></td>
        <td><span style="font-size:0.75rem; text-transform:uppercase;">${z.modo}</span></td>
        <td>${z.entradas}</td>
        <td>${z.saidas}</td>
        <td>${formatarNumero(z.ocupacao.mediaPonderada, 2)} (pico: ${z.ocupacao.max})</td>
        <td>${formatarNumero(z.tempoMedioConcluidosSeg, 1)} s${rotuloEst}</td>
        <td>${formatarNumero(z.tempoMedioLittleSeg, 1)} s</td>
        <td>${formatarNumero(divLittle.diffPerc, 1)}%</td>
        <td>${formatarNumero(z.statsTempo.p90, 1)}s / ${formatarNumero(z.statsTempo.p95, 1)}s${rotuloEst}</td>
        <td>${formatarNumero(z.vazaoSaida, 2)} p/min</td>
        <td><strong>${formatarNumero(z.participacaoTempoTotal, 1)}%</strong></td>
      `;
      corpoZonas.appendChild(tr);
    }

    // Balanço Estrito de Consistência
    const b = m.balanco;
    document.getElementById('box-balanco-info').innerHTML = `
      <p>• Chegadas Registradas: <strong>${b.chegadas}</strong></p>
      <p>• Alunos Concluídos (Saídas): <strong>${b.saidas}</strong></p>
      <p>• Alunos Anulados: <strong>${b.anuladas}</strong></p>
      <p>• Alunos Ainda no Sistema: <strong>${b.presentes}</strong></p>
      <p>• Equação de Balanço: <em>${b.chegadas} − ${b.saidas} − ${b.anuladas} = ${b.chegadas - b.saidas - b.anuladas}</em></p>
      <p>• Status: ${b.consistente ? '✅ <strong style="color:var(--success)">Consistência Perfeita (0 discrepância)</strong>' : '⚠️ <strong style="color:var(--danger)">Discrepância detectada</strong>'}</p>
    `;

    // Qualidade dos Dados e Auditoria
    const q = m.qualidade;
    const cobStr = Object.entries(q.coberturaPorPonto || {}).map(([pt, perc]) => `${pt}: ${formatarNumero(perc, 0)}%`).join(' • ');
    document.getElementById('box-qualidade-info').innerHTML = `
      <p>• Eventos Tardios (Offline): <strong>${q.eventosTardios}</strong></p>
      <p>• Inversões de Ordem Corrigidas: <strong>${q.inversoesCorrigidas}</strong></p>
      <p>• Anulações Efetuadas: <strong>${q.anulacoes}</strong> • Reversões: <strong>${q.reversoes}</strong></p>
      <p>• Cobertura por Ponto: <strong>${cobStr || '100%'}</strong></p>
      <p>• Total de Eventos Processados: <strong>${q.totalEventos}</strong></p>
    `;
  },

  // --------------------------------------------------------------------------
  // PLAYER DE REPRODUÇÃO (REPLAY FIEL)
  // --------------------------------------------------------------------------
  iniciarPlayerReplay(eventos) {
    if (!eventos || eventos.length === 0) return;

    const tInicio = eventos[0].tEfetivo ?? eventos[0].t;
    const tFim = eventos[eventos.length - 1].tEfetivo ?? eventos[eventos.length - 1].t;
    const duracaoTotal = Math.max(1000, tFim - tInicio);

    this.replay = {
      ativo: false,
      timer: null,
      velocidade: 5,
      tAtual: tInicio,
      tInicio,
      tFim,
      duracaoTotal
    };

    document.getElementById('lbl-tempo-total-replay').textContent = formatarDuracao(duracaoTotal).substring(3);
    document.getElementById('slider-timeline').value = 0;

    this.desenharMarcadoresTimeline(eventos, tInicio, duracaoTotal);
    this.atualizarInstanteReplay(tInicio);
  },

  desenharMarcadoresTimeline(eventos, tInicio, duracaoTotal) {
    const box = document.getElementById('box-markers-timeline');
    box.innerHTML = '';

    for (const ev of eventos) {
      const tEv = ev.tEfetivo ?? ev.t;
      const pct = Math.min(100, Math.max(0, ((tEv - tInicio) / duracaoTotal) * 100));

      let icone = null;
      let titulo = '';

      if (ev.tipo === 'anotacao') {
        icone = '📝';
        titulo = `Anotação: "${ev.texto}"`;
      } else if (ev.inversaoCorrigida) {
        icone = '⚡';
        titulo = `Inversão corrigida no ponto ${ev.ponto}`;
      } else if (ev.tipo === 'anulacao') {
        icone = '✕';
        titulo = `Anulação da Pessoa ${ev.pessoa}`;
      } else if (ev.tipo === 'reversao') {
        icone = '↩';
        titulo = `Reversão no ponto ${ev.ponto || ''}`;
      } else if (ev.tipo === 'atribuicao') {
        icone = '👤';
        titulo = 'Reatribuição de pontos';
      }

      if (icone) {
        const marker = document.createElement('span');
        marker.className = 'marker-pin';
        marker.style.left = `${pct}%`;
        marker.textContent = icone;
        marker.title = `${formatarHoraLocal(tEv)} - ${titulo}`;
        marker.onclick = () => {
          this.pausarReplay();
          this.atualizarInstanteReplay(tEv);
        };
        box.appendChild(marker);
      }
    }
  },

  togglePlayPause() {
    if (this.replay.ativo) {
      this.pausarReplay();
    } else {
      this.iniciarReplay();
    }
  },

  iniciarReplay() {
    this.replay.ativo = true;
    document.getElementById('btn-play-pause').textContent = '⏸ Pausar';

    const intervaloTickMs = 80;
    this.replay.timer = setInterval(() => {
      const incrementoSimuladoMs = intervaloTickMs * this.replay.velocidade;
      const proximoT = this.replay.tAtual + incrementoSimuladoMs;

      if (proximoT >= this.replay.tFim) {
        this.atualizarInstanteReplay(this.replay.tFim);
        this.pausarReplay();
      } else {
        this.atualizarInstanteReplay(proximoT);
      }
    }, intervaloTickMs);
  },

  pausarReplay() {
    this.replay.ativo = false;
    if (this.replay.timer) {
      clearInterval(this.replay.timer);
      this.replay.timer = null;
    }
    document.getElementById('btn-play-pause').textContent = '▶ Reproduzir';
  },

  reiniciarReplay() {
    this.pausarReplay();
    this.atualizarInstanteReplay(this.replay.tInicio);
  },

  setVelocidade(v) {
    this.replay.velocidade = v;
    document.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
    event?.target?.classList.add('active');

    if (this.replay.ativo) {
      this.pausarReplay();
      this.iniciarReplay();
    }
  },

  onSliderScrub(valPercentil) {
    this.pausarReplay();
    const tNovo = this.replay.tInicio + (valPercentil / 1000) * this.replay.duracaoTotal;
    this.atualizarInstanteReplay(tNovo);
  },

  atualizarInstanteReplay(tInstante) {
    this.replay.tAtual = tInstante;

    const decorrido = Math.max(0, tInstante - this.replay.tInicio);
    document.getElementById('lbl-tempo-replay').textContent = formatarDuracao(decorrido).substring(3);

    const slider = document.getElementById('slider-timeline');
    slider.value = Math.min(1000, Math.floor((decorrido / this.replay.duracaoTotal) * 1000));

    // Deriva estado exato com a configuração de zonas da sessão gravada
    const estadoInstante = derivarEstado(this.dadosCompletos.eventos, tInstante, this.dadosCompletos.meta.config);

    if (this.animador) {
      this.animador.renderizarEstado(estadoInstante, false);
    }

    // Atualiza contadores sincronizados com o replay
    const boxCont = document.getElementById('replay-contadores-zonas');
    boxCont.innerHTML = '';

    for (const [zId, z] of Object.entries(estadoInstante.zonas)) {
      const span = document.createElement('span');
      span.innerHTML = `${z.nome}: <strong style="color:${z.cor}">${z.ocupacao}</strong>`;
      boxCont.appendChild(span);
    }
    const spanSaiu = document.createElement('span');
    spanSaiu.innerHTML = `Saídas: <strong style="color:var(--btn-atendimento-bg)">${estadoInstante.contadores.saidas}</strong>`;
    boxCont.appendChild(spanSaiu);
  },

  // --------------------------------------------------------------------------
  // GRÁFICOS ANALÍTICOS (CHART.JS)
  // --------------------------------------------------------------------------
  renderizarGraficos(dados) {
    Object.values(this.graficos).forEach(g => {
      if (g && typeof g.destroy === 'function') g.destroy();
    });
    this.graficos = {};

    const m = dados.metricas;
    const eventos = dados.eventos;
    const inicioMs = m.inicioMs;
    const fimMs = m.fimMs;

    // 1. Área empilhada de ocupação por zona
    this.renderizarGraficoAreaEmpilhada(m);

    // 2. Curvas acumuladas por ponto
    this.renderizarGraficoCurvasAcumuladas(dados);

    // 3. Gráfico de barras de tempo médio por zona
    this.renderizarGraficoBarrasZonas(m);

    // 4. Histograma de tempo
    this.renderizarGraficoHistograma(m);
  },

  renderizarGraficoAreaEmpilhada(metricas) {
    const ctx = document.getElementById('chart-area-zonas')?.getContext('2d');
    if (!ctx) return;

    // Constrói linha do tempo consolidada para todas as zonas
    const temposSet = new Set();
    for (const z of Object.values(metricas.zonas)) {
      (z.ocupacao.timeline || []).forEach(pt => temposSet.add(pt.t));
    }
    const temposOrdenados = Array.from(temposSet).sort((a, b) => a - b);

    // Amostragem para suavidade (máximo 60 pontos no gráfico)
    const passo = Math.max(1, Math.floor(temposOrdenados.length / 60));
    const temposAmostrados = temposOrdenados.filter((_, i) => i % passo === 0);

    const labels = temposAmostrados.map(t => formatarHoraLocal(t));
    const datasets = Object.values(metricas.zonas).map(z => {
      const data = temposAmostrados.map(t => {
        const pt = (z.ocupacao.timeline || []).filter(p => p.t <= t).pop();
        return pt ? pt.q : 0;
      });

      return {
        label: z.nome,
        data,
        fill: true,
        backgroundColor: z.cor + '44',
        borderColor: z.cor,
        borderWidth: 2,
        tension: 0.2
      };
    });

    this.graficos.areaEmpilhada = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { title: { display: true, text: 'Horário' } },
          y: { stacked: true, title: { display: true, text: 'Alunos no Sistema' }, beginAtZero: true }
        }
      }
    });
  },

  renderizarGraficoCurvasAcumuladas(dados) {
    const ctx = document.getElementById('chart-acumulado-pontos')?.getContext('2d');
    if (!ctx) return;

    const pontos = dados.metricas.config.pontos || [];
    const eventos = dados.eventos;
    const tempos = [];
    const duracaoMs = dados.metricas.duracaoTotalMs;
    const inicioMs = dados.metricas.inicioMs;

    const numPontosGrafico = 40;
    for (let i = 0; i <= numPontosGrafico; i++) {
      tempos.push(inicioMs + (i / numPontosGrafico) * duracaoMs);
    }

    const labels = tempos.map(t => formatarHoraLocal(t));
    const cores = ['#8b5cf6', '#dc2626', '#16a34a', '#ec4899', '#f97316', '#06b6d4'];

    const datasets = pontos.map((p, idx) => {
      let acumulado = 0;
      const data = tempos.map(t => {
        const count = eventos.filter(ev => {
          const tEv = ev.tEfetivo ?? ev.t;
          if (tEv > t) return false;
          if (p.de === 'origem') return ev.tipo === 'chegada';
          const pontoId = ev.ponto || (ev.tipo === 'atendimento' ? 'z1->saida' : `${ev.de}->${ev.para}`);
          return pontoId === p.id;
        }).length;
        return count;
      });

      return {
        label: p.nome,
        data,
        borderColor: cores[idx % cores.length],
        backgroundColor: cores[idx % cores.length],
        borderWidth: 2,
        fill: false,
        tension: 0.1
      };
    });

    this.graficos.acumulado = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' } },
        scales: {
          x: { title: { display: true, text: 'Horário' } },
          y: { title: { display: true, text: 'Passagens Acumuladas' }, beginAtZero: true }
        }
      }
    });
  },

  renderizarGraficoBarrasZonas(metricas) {
    const ctx = document.getElementById('chart-barras-zonas')?.getContext('2d');
    if (!ctx) return;

    const zonas = Object.values(metricas.zonas);
    const labels = zonas.map(z => z.nome);
    const data = zonas.map(z => z.tempoMedioConcluidosSeg);
    const backgroundColor = zonas.map(z => z.cor);

    this.graficos.barras = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Tempo Médio na Zona (segundos)',
          data,
          backgroundColor
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { title: { display: true, text: 'Segundos' }, beginAtZero: true }
        }
      }
    });
  },

  renderizarGraficoHistograma(metricas) {
    const ctx = document.getElementById('chart-histograma')?.getContext('2d');
    if (!ctx) return;

    const tempos = (metricas.pessoas || [])
      .filter(p => p.tempoTotalMs !== null)
      .map(p => Math.floor(p.tempoTotalMs / 1000));

    if (tempos.length === 0) return;

    const maxT = Math.max(...tempos, 60);
    const nBins = 10;
    const larguraBin = Math.max(10, Math.ceil(maxT / nBins));
    const bins = new Array(nBins).fill(0);
    const labels = [];

    for (let i = 0; i < nBins; i++) {
      labels.push(`${i * larguraBin}-${(i + 1) * larguraBin}s`);
    }

    for (const t of tempos) {
      const idx = Math.min(nBins - 1, Math.floor(t / larguraBin));
      bins[idx]++;
    }

    this.graficos.histograma = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Frequência de Alunos',
          data: bins,
          backgroundColor: '#3b82f6'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Intervalo de Tempo no Sistema' } },
          y: { title: { display: true, text: 'Quantidade de Alunos' }, beginAtZero: true }
        }
      }
    });
  },

  // --------------------------------------------------------------------------
  // TABELA DE PESSOAS DETALHADA (COM COLUNAS DINÂMICAS POR ZONA)
  // --------------------------------------------------------------------------
  renderizarTabelaPessoas() {
    if (!this.dadosCompletos) return;

    const thead = document.getElementById('tabela-pessoas-cabecalho');
    const tbody = document.getElementById('tabela-pessoas-corpo');
    const zonas = (this.dadosCompletos.metricas.config?.zonas || []).filter(z => z.habilitada !== false);

    // Cabeçalho dinâmico
    let th = '<tr><th onclick="HistoricoApp.ordenarTabela(\'pessoa\')">Pessoa ⬍</th>';
    for (const z of zonas) {
      th += `<th>Entrada ${z.nome}</th><th>Saída ${z.nome}</th><th>Tempo ${z.nome}</th>`;
    }
    th += '<th onclick="HistoricoApp.ordenarTabela(\'tempoTotalMs\')">Tempo Total ⬍</th><th>Situação</th></tr>';
    thead.innerHTML = th;

    // Filtros
    const busca = document.getElementById('filtro-busca-tabela').value.toLowerCase().trim();
    const filtroStatus = document.getElementById('filtro-status-tabela').value;

    let lista = [...(this.dadosCompletos.metricas.pessoas || [])];

    if (busca) {
      lista = lista.filter(p => String(p.pessoa).includes(busca));
    }
    if (filtroStatus !== 'todos') {
      lista = lista.filter(p => p.situacao === filtroStatus || p.status === filtroStatus);
    }

    // Ordenação
    const col = this.ordenacaoTabela.coluna;
    const asc = this.ordenacaoTabela.asc;
    lista.sort((a, b) => {
      const va = a[col] ?? 0;
      const vb = b[col] ?? 0;
      return asc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });

    tbody.innerHTML = '';
    const slice = lista.slice(0, 100);

    for (const p of slice) {
      const tr = document.createElement('tr');
      let td = `<td><strong>Pessoa ${p.pessoa}</strong></td>`;

      for (const z of zonas) {
        const entr = p.zonaEntradaMs?.[z.id] ? formatarHoraLocal(p.zonaEntradaMs[z.id]) : '—';
        const sai = p.zonaSaidaMs?.[z.id] ? formatarHoraLocal(p.zonaSaidaMs[z.id]) : '—';
        const tempo = (p.tempoZonaMs?.[z.id] !== undefined && p.tempoZonaMs?.[z.id] !== null)
          ? `${formatarNumero(p.tempoZonaMs[z.id] / 1000, 1)}s`
          : '—';
        const rotuloEst = z.modo === 'contagem' && tempo !== '—' ? ' <span class="badge-estimado">est.</span>' : '';

        td += `<td>${entr}</td><td>${sai}</td><td>${tempo}${rotuloEst}</td>`;
      }

      const tempoTotal = p.tempoTotalMs !== null ? `${formatarNumero(p.tempoTotalMs / 1000, 1)}s` : '—';
      let tagStatus = `<span class="status-badge" style="background:#22c55e22; color:#22c55e;">Concluído</span>`;
      if (p.situacao === 'anulada') {
        tagStatus = `<span class="status-badge" style="background:#ef444422; color:#ef4444;">Anulada</span>`;
      } else if (p.situacao === 'em_zona') {
        tagStatus = `<span class="status-badge" style="background:#eab30822; color:#eab308;">Na Fila</span>`;
      }

      td += `<td><strong>${tempoTotal}</strong></td><td>${tagStatus}</td>`;
      tr.innerHTML = td;
      tbody.appendChild(tr);
    }
  },

  ordenarTabela(coluna) {
    if (this.ordenacaoTabela.coluna === coluna) {
      this.ordenacaoTabela.asc = !this.ordenacaoTabela.asc;
    } else {
      this.ordenacaoTabela.coluna = coluna;
      this.ordenacaoTabela.asc = true;
    }
    this.renderizarTabelaPessoas();
  },

  // --------------------------------------------------------------------------
  // EXPORTAÇÕES DE ARQUIVOS (CSV, JSON, COPIAR)
  // --------------------------------------------------------------------------
  baixarCsvPessoas() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/csv-pessoas`;
  },

  baixarCsvResumoZonas() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/csv-resumo-zonas`;
  },

  baixarCsvEventos() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/csv-eventos`;
  },

  baixarCsvMetricas() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/csv-metricas`;
  },

  baixarBackupJson() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/json`;
  },

  copiarResumo() {
    if (!this.dadosCompletos) return;
    const m = this.dadosCompletos.metricas;
    const meta = this.dadosCompletos.meta;

    let txt = `=== RESUMO DA COLETA - FILA RU ===\n`;
    txt += `Sessão: ${meta.nome} (${meta.local})\n`;
    txt += `Duração: ${formatarDuracao(m.duracaoTotalMs)} (${formatarNumero(m.duracaoMin, 1)} min)\n`;
    txt += `Total de Chegadas: ${m.balanco.chegadas} (λ = ${formatarNumero(m.global.lambdaGlobal, 2)} p/min)\n`;
    txt += `Total Concluídos: ${m.balanco.saidas} (Vazão = ${formatarNumero(m.vazaoGlobalPorMin, 2)} p/min)\n`;
    txt += `Tempo Médio no Sistema: ${formatarNumero(m.global.tempoMedioSistemaSeg, 1)} seg\n\n`;
    txt += `--- Desempenho por Zona ---\n`;
    for (const z of Object.values(m.zonas)) {
      txt += `• ${z.nome} (${z.modo}): L = ${formatarNumero(z.ocupacao.mediaPonderada, 1)}, Tempo = ${formatarNumero(z.tempoMedioConcluidosSeg, 1)}s, Little = ${formatarNumero(z.tempoMedioLittleSeg, 1)}s (Div: ${formatarNumero(z.divergenciaLittle.diffPerc, 1)}%)\n`;
    }

    navigator.clipboard.writeText(txt).then(() => {
      alert('Resumo copiado para a área de transferência!');
    });
  },

  // --------------------------------------------------------------------------
  // COMPARAÇÃO ENTRE SESSÕES (APENAS ZONAS COMUNS)
  // --------------------------------------------------------------------------
  async abrirModalComparar() {
    const modal = document.getElementById('modal-comparar');
    const container = document.getElementById('comparar-checkboxes');
    container.innerHTML = 'Carregando sessões...';
    modal.classList.add('open');

    const resp = await fetch('/api/sessoes');
    const sessoes = await resp.json();
    container.innerHTML = '';

    sessoes.forEach((s, idx) => {
      const lbl = document.createElement('label');
      lbl.style.display = 'inline-flex';
      lbl.style.alignItems = 'center';
      lbl.style.gap = '6px';
      lbl.style.fontSize = '0.82rem';
      lbl.innerHTML = `
        <input type="checkbox" class="chk-comparar" value="${s.id}" ${idx < 2 ? 'checked' : ''} onchange="HistoricoApp.executarComparacao()">
        <span>${s.nome}</span>
      `;
      container.appendChild(lbl);
    });

    this.executarComparacao();
  },

  async executarComparacao() {
    const selecionados = Array.from(document.querySelectorAll('.chk-comparar:checked')).map(c => c.value);
    const tabela = document.getElementById('tabela-comparacao');

    if (selecionados.length === 0) {
      tabela.innerHTML = '<tr><td style="padding:15px; text-align:center;">Selecione ao menos uma sessão para comparar.</td></tr>';
      return;
    }

    const sessoesDados = await Promise.all(selecionados.map(async id => {
      const r = await fetch(`/api/sessoes/${id}`);
      return await r.json();
    }));

    // Identificar zonas comuns a todas as sessões selecionadas
    const zonasDeCada = sessoesDados.map(s => {
      const zs = (s.metricas.config?.zonas || []).filter(z => z.habilitada !== false);
      return new Set(zs.map(z => z.id));
    });

    const todasZonasIds = new Set(sessoesDados.flatMap(s => (s.metricas.config?.zonas || []).map(z => z.id)));

    let html = '<thead><tr><th>Métrica</th>';
    sessoesDados.forEach(s => {
      html += `<th>${s.meta.nome}</th>`;
    });
    html += '</tr></thead><tbody>';

    // Métricas Globais
    html += '<tr><td><strong>Duração Observada</strong></td>' + sessoesDados.map(s => `<td>${formatarDuracao(s.metricas.duracaoTotalMs)}</td>`).join('') + '</tr>';
    html += '<tr><td><strong>Total Chegadas</strong></td>' + sessoesDados.map(s => `<td>${s.metricas.balanco.chegadas}</td>`).join('') + '</tr>';
    html += '<tr><td><strong>Total Concluídos</strong></td>' + sessoesDados.map(s => `<td>${s.metricas.balanco.saidas}</td>`).join('') + '</tr>';
    html += '<tr><td><strong>Tempo Médio no Sistema</strong></td>' + sessoesDados.map(s => `<td>${formatarNumero(s.metricas.global.tempoMedioSistemaSeg, 1)} s</td>`).join('') + '</tr>';

    // Linhas por Zona (indicando não aplicável caso ausente em alguma)
    for (const zId of todasZonasIds) {
      const nomeZona = sessoesDados.find(s => s.metricas.zonas[zId])?.metricas.zonas[zId]?.nome || zId;
      html += `<tr style="background:var(--bg-subtle);"><td colspan="${sessoesDados.length + 1}"><strong>Zona: ${nomeZona}</strong></td></tr>`;

      html += '<tr><td>• Tempo Médio Concluintes</td>' + sessoesDados.map(s => {
        const z = s.metricas.zonas[zId];
        return z ? `<td>${formatarNumero(z.tempoMedioConcluidosSeg, 1)} s</td>` : '<td style="color:var(--text-muted); font-style:italic;">N/A (zona não habilitada)</td>';
      }).join('') + '</tr>';

      html += '<tr><td>• Ocupação Média (L)</td>' + sessoesDados.map(s => {
        const z = s.metricas.zonas[zId];
        return z ? `<td>${formatarNumero(z.ocupacao.mediaPonderada, 2)}</td>` : '<td style="color:var(--text-muted); font-style:italic;">N/A</td>';
      }).join('') + '</tr>';
    }

    html += '</tbody>';
    tabela.innerHTML = html;
  },

  // --------------------------------------------------------------------------
  // RENOMEAR, EXCLUIR E IMPORTAR
  // --------------------------------------------------------------------------
  async renomearSessao(id) {
    const novoNome = prompt('Novo nome para a sessão:');
    if (!novoNome) return;

    const r = await fetch(`/api/sessoes/${id}/renomear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novoNome })
    });
    const res = await r.json();
    if (res.sucesso) {
      this.carregarListaSessoes();
    }
  },

  async excluirSessao(id) {
    if (!confirm('Deseja realmente excluir permanentemente esta sessão e todos os seus logs?')) {
      return;
    }

    const r = await fetch(`/api/sessoes/${id}/excluir`, { method: 'POST' });
    const res = await r.json();
    if (res.sucesso) {
      this.carregarListaSessoes();
    } else {
      alert('Erro: ' + res.erro);
    }
  },

  abrirModalImportar() {
    document.getElementById('modal-importar').classList.add('open');
  },

  processarImportacaoArquivo() {
    const input = document.getElementById('file-import-json');
    if (!input.files || input.files.length === 0) {
      alert('Selecione um arquivo .json para importar.');
      return;
    }

    const leitor = new FileReader();
    leitor.onload = async (e) => {
      try {
        const dados = JSON.parse(e.target.result);
        const r = await fetch('/api/sessoes/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dados)
        });
        const res = await r.json();
        if (res.sucesso) {
          alert('Sessão importada com sucesso!');
          this.fecharModais();
          this.carregarListaSessoes();
        } else {
          alert('Erro ao importar: ' + res.erro);
        }
      } catch (err) {
        alert('Arquivo inválido: ' + err.message);
      }
    };
    leitor.readAsText(input.files[0]);
  },

  fecharModais() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  },

  toggleTheme() {
    const atual = document.documentElement.getAttribute('data-theme');
    const novo = atual === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', novo);
    localStorage.setItem('ru_theme', novo);
  }
};

window.HistoricoApp = HistoricoApp;
document.addEventListener('DOMContentLoaded', () => {
  const temaSalvo = localStorage.getItem('ru_theme');
  if (temaSalvo) document.documentElement.setAttribute('data-theme', temaSalvo);
  HistoricoApp.init();
});
