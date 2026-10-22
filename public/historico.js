/**
 * public/historico.js
 * Lógica da tela de histórico, reprodução fiel da animação e relatórios estatísticos.
 */

import { derivarEstado } from '../shared/estado.js';
import { calcularMetricas, formatarDuracao, formatarHoraLocal, formatarNumero } from '../shared/metricas.js';
import { AnimadorFila } from './animacao.js';

const HistoricoApp = {
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

        item.innerHTML = `
          <div>
            <div style="font-weight:700; font-size:1rem; display:flex; align-items:center; gap:8px;">
              <span>${s.nome}</span> ${tagTeste}
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted);">
              ${s.local} • Início: ${dataStr} ${horaStr} • Status: <strong>${s.status}</strong>
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
    const metricas = dados.metricas;

    document.getElementById('rel-nome').textContent = meta.nome;
    document.getElementById('rel-sub').textContent =
      `${meta.local} • Início: ${formatarHoraLocal(metricas.inicioMs)} • Duração: ${formatarDuracao(metricas.duracaoTotalMs)} (${formatarNumero(metricas.duracaoMin, 1)} min)`;
    document.getElementById('rel-obs').textContent = meta.observacoes ? `Observações: "${meta.observacoes}"` : '';

    // KPIs
    document.getElementById('kpi-cheg').textContent = metricas.n_chegadas;
    document.getElementById('kpi-lambda').textContent = `λ = ${formatarNumero(metricas.lambda, 2)} p/min`;
    document.getElementById('kpi-atend').textContent = metricas.n_atendimentos;
    document.getElementById('kpi-vazao-global').textContent = `Vazão = ${formatarNumero(metricas.vazaoGlobalPorMin, 2)} p/min`;
    document.getElementById('kpi-util').textContent = `${formatarNumero(metricas.utilizacao * 100, 1)}%`;
    document.getElementById('kpi-l').textContent = formatarNumero(metricas.filaTempo.mediaPonderada, 1);
    document.getElementById('kpi-pico').textContent = `Pico: ${metricas.filaTempo.max} pessoas (${formatarHoraLocal(metricas.filaTempo.instanteMaxMs)})`;

    document.getElementById('kpi-espera-media').textContent = formatarDuracao(metricas.statsEspera.media * 1000).substring(3);
    document.getElementById('kpi-espera-mediana').textContent = `Mediana: ${formatarDuracao(metricas.statsEspera.mediana * 1000).substring(3)}`;
    document.getElementById('kpi-p95').textContent = formatarDuracao(metricas.statsEspera.p95 * 1000).substring(3);
    document.getElementById('kpi-p90').textContent = `P90: ${formatarDuracao(metricas.statsEspera.p90 * 1000).substring(3)}`;
    document.getElementById('kpi-int-media').textContent = `${formatarNumero(metricas.statsIntervalosAtend.media, 1)} s`;
    document.getElementById('kpi-int-cv').textContent = `CV: ${formatarNumero(metricas.statsIntervalosAtend.cv, 2)}`;
    document.getElementById('kpi-ocioso').textContent = `${formatarNumero(metricas.ociosidade.percentualOcioso, 1)}%`;
    document.getElementById('kpi-pausas').textContent = `${metricas.ociosidade.qtdPausas} pausas longas`;

    // Lei de Little
    const l = metricas.little;
    document.getElementById('box-little-info').innerHTML = `
      <p>• Comprimento Médio Observado (L): <strong>${formatarNumero(l.L_observado, 2)} pessoas</strong></p>
      <p>• Produto λ · W: <strong>${formatarNumero(l.L_calculado_lambda_W, 2)} pessoas</strong></p>
      <p>• Discrepância Percentual: <strong>${formatarNumero(l.diffPerc, 1)}%</strong> ${l.consistente ? '✅ (Consistente com a teoria)' : '⚠️ (Diferença esperada em períodos finitos com fila residual)'}</p>
    `;

    // Modelo Teórico
    const teo = metricas.teorico;
    const boxTeo = document.getElementById('box-teorico-info');
    if (teo.aplicavel) {
      boxTeo.innerHTML = `
        <p>• Servidores: <strong>c = ${teo.c}</strong> • Intensidade: <strong>a = ${formatarNumero(teo.a, 2)} Erlangs</strong></p>
        <p>• Fila Teórica (Lq): <strong>${formatarNumero(teo.Lq, 2)} pessoas</strong> (Obs: ${formatarNumero(metricas.filaTempo.mediaPonderada, 2)})</p>
        <p>• Espera Teórica (Wq): <strong>${formatarDuracao(teo.Wq_seg * 1000).substring(3)}</strong> (Obs: ${formatarDuracao(metricas.statsEspera.media * 1000).substring(3)})</p>
        <p>• Probabilidade de Espera P(W>0): <strong>${formatarNumero(teo.P_espera * 100, 1)}%</strong></p>
      `;
    } else {
      boxTeo.innerHTML = `<span style="color:var(--warning)">⚠️ ${teo.motivo}</span>`;
    }
  },

  /* ==========================================================================
     PLAYER DE REPRODUÇÃO DA FILA
     ========================================================================== */
  iniciarPlayerReplay(eventos) {
    if (!eventos || eventos.length === 0) return;

    this.pararReplay();

    this.replay.tInicio = eventos[0].t;
    this.replay.tFim = eventos[eventos.length - 1].t;
    this.replay.duracaoTotal = Math.max(1000, this.replay.tFim - this.replay.tInicio);
    this.replay.tAtual = this.replay.tInicio;

    document.getElementById('lbl-tempo-total-replay').textContent = formatarDuracao(this.replay.duracaoTotal).substring(3);

    // Cria Marcadores na Barra de Tempo
    this.criarMarcadoresTimeline(eventos);

    // Inicializa no instante inicial
    this.atualizarInstanteReplay(this.replay.tInicio);
  },

  criarMarcadoresTimeline(eventos) {
    const box = document.getElementById('box-markers-timeline');
    box.innerHTML = '';

    const durTotal = this.replay.duracaoTotal;

    eventos.forEach(ev => {
      let icone = null;
      let rotulo = '';

      if (ev.tipo === 'anotacao') {
        icone = '📝';
        rotulo = `Anotação: "${ev.texto}"`;
      } else if (ev.tipo === 'anulacao') {
        icone = '❌';
        rotulo = `Pessoa ${ev.pessoa} Anulada`;
      } else if (ev.tipo === 'reversao') {
        icone = '↩';
        rotulo = `Pessoa ${ev.pessoa} Revertida`;
      }

      if (icone) {
        const perc = Math.min(100, Math.max(0, ((ev.t - this.replay.tInicio) / durTotal) * 100));
        const pin = document.createElement('span');
        pin.className = 'marker-pin';
        pin.style.left = `${perc}%`;
        pin.title = `${formatarHoraLocal(ev.t)} - ${rotulo}`;
        pin.textContent = icone;
        pin.onclick = () => this.saltarParaInstante(ev.t);
        box.appendChild(pin);
      }
    });
  },

  saltarParaInstante(t) {
    this.replay.tAtual = Math.max(this.replay.tInicio, Math.min(this.replay.tFim, t));
    const perc = ((this.replay.tAtual - this.replay.tInicio) / this.replay.duracaoTotal) * 1000;
    document.getElementById('slider-timeline').value = perc;
    this.atualizarInstanteReplay(this.replay.tAtual);
  },

  onSliderScrub(sliderVal) {
    const frac = sliderVal / 1000;
    const t = this.replay.tInicio + frac * this.replay.duracaoTotal;
    this.replay.tAtual = t;
    this.atualizarInstanteReplay(t);
  },

  atualizarInstanteReplay(t) {
    const decorrido = Math.max(0, t - this.replay.tInicio);
    document.getElementById('lbl-tempo-replay').textContent = formatarDuracao(decorrido).substring(3);

    // Cálculo puro instantâneo do estado neste exato timestamp
    const estado = derivarEstado(this.dadosCompletos.eventos, t);

    // Contadores sincronizados
    document.getElementById('rep-fila').textContent = estado.contadores.naFila;
    document.getElementById('rep-atendidos').textContent = estado.contadores.atendidas;
    document.getElementById('rep-chegadas').textContent = estado.contadores.chegadas;
    document.getElementById('rep-anulados').textContent = estado.contadores.anuladas;
    document.getElementById('rep-vazao').textContent = formatarNumero(estado.vazaoRecente, 1);

    // Atualiza animação diretamente
    if (this.animador) {
      this.animador.renderizarEstado(estado, false);
    }
  },

  togglePlayPause() {
    if (this.replay.ativo) {
      this.pararReplay();
    } else {
      this.iniciarLoopReplay();
    }
  },

  iniciarLoopReplay() {
    this.replay.ativo = true;
    document.getElementById('btn-play-pause').textContent = '⏸ Pausar';

    const intervaloMs = 100;
    this.replay.timer = setInterval(() => {
      // Avanço proporcional à velocidade configurada
      const avancoMs = intervaloMs * this.replay.velocidade;
      this.replay.tAtual += avancoMs;

      if (this.replay.tAtual >= this.replay.tFim) {
        this.replay.tAtual = this.replay.tFim;
        this.pararReplay();
      }

      const perc = ((this.replay.tAtual - this.replay.tInicio) / this.replay.duracaoTotal) * 1000;
      document.getElementById('slider-timeline').value = perc;
      this.atualizarInstanteReplay(this.replay.tAtual);
    }, intervaloMs);
  },

  pararReplay() {
    this.replay.ativo = false;
    if (this.replay.timer) {
      clearInterval(this.replay.timer);
      this.replay.timer = null;
    }
    const btn = document.getElementById('btn-play-pause');
    if (btn) btn.textContent = '▶ Reproduzir';
  },

  reiniciarReplay() {
    this.pararReplay();
    this.saltarParaInstante(this.replay.tInicio);
  },

  setVelocidade(v) {
    this.replay.velocidade = v;
    document.querySelectorAll('.btn-speed').forEach(b => {
      b.classList.toggle('active', b.textContent === `${v}x`);
    });
  },

  /* ==========================================================================
     GRÁFICOS (CHART.JS 4.X)
     ========================================================================== */
  renderizarGraficos(dados) {
    const eventos = dados.eventos;
    const metricas = dados.metricas;
    const inicioMs = metricas.inicioMs;

    // Destruir instâncias antigas
    Object.keys(this.graficos).forEach(k => {
      if (this.graficos[k]) this.graficos[k].destroy();
    });

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const corTexto = isDark ? '#94a3b8' : '#64748b';
    const corGrid = isDark ? '#334155' : '#e2e8f0';

    // 1. Acumulado
    const ctxAcumulado = document.getElementById('chart-acumulado');
    if (ctxAcumulado) {
      const labels = ['0m'];
      const dataCheg = [0];
      const dataAtend = [0];
      let accC = 0;
      let accA = 0;

      for (const ev of eventos) {
        if (ev.tipo === 'chegada') accC++;
        if (ev.tipo === 'atendimento') accA++;
        const m = ((ev.t - inicioMs) / 60000).toFixed(1);
        labels.push(`${m}m`);
        dataCheg.push(accC);
        dataAtend.push(accA);
      }

      this.graficos.acumulado = new Chart(ctxAcumulado, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Chegadas', data: dataCheg, borderColor: '#15803d', stepped: true, borderWidth: 2 },
            { label: 'Atendimentos', data: dataAtend, borderColor: '#1d4ed8', stepped: true, borderWidth: 2 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: corTexto, maxTicksLimit: 12 }, grid: { color: corGrid } },
            y: { ticks: { color: corTexto }, grid: { color: corGrid } }
          }
        }
      });
    }

    // 2. Fila no Tempo
    const ctxFila = document.getElementById('chart-fila-tempo');
    if (ctxFila && metricas.filaTempo.timeline) {
      const labels = metricas.filaTempo.timeline.map(item => `${((item.t - inicioMs) / 60000).toFixed(1)}m`);
      const valores = metricas.filaTempo.timeline.map(item => item.q);

      this.graficos.fila = new Chart(ctxFila, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Comprimento da Fila',
            data: valores,
            borderColor: '#d97706',
            backgroundColor: 'rgba(217, 119, 6, 0.15)',
            fill: true,
            stepped: true,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: corTexto, maxTicksLimit: 12 }, grid: { color: corGrid } },
            y: { ticks: { color: corTexto }, grid: { color: corGrid } }
          }
        }
      });
    }

    // 3. Blocos
    const ctxBlocos = document.getElementById('chart-blocos');
    if (ctxBlocos && metricas.vazaoBlocos.blocos) {
      this.graficos.blocos = new Chart(ctxBlocos, {
        type: 'bar',
        data: {
          labels: metricas.vazaoBlocos.blocos.map(b => b.rotulo),
          datasets: [
            { label: 'Chegadas', data: metricas.vazaoBlocos.blocos.map(b => b.chegadas), backgroundColor: '#15803d' },
            { label: 'Atendimentos', data: metricas.vazaoBlocos.blocos.map(b => b.atendimentos), backgroundColor: '#1d4ed8' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: corTexto }, grid: { color: corGrid } },
            y: { ticks: { color: corTexto }, grid: { color: corGrid } }
          }
        }
      });
    }

    // 4. Histograma
    const ctxHist = document.getElementById('chart-histograma');
    if (ctxHist) {
      const temposSeg = metricas.pessoas
        .filter(p => p.status === 'atendida' && p.esperaMs !== null)
        .map(p => Math.round(p.esperaMs / 1000));

      const maxT = Math.max(...temposSeg, 60);
      const nBins = 8;
      const binSize = Math.max(15, Math.ceil(maxT / nBins));
      const bins = Array(nBins).fill(0);
      const binLabels = [];

      for (let i = 0; i < nBins; i++) {
        binLabels.push(`${i * binSize}-${(i + 1) * binSize}s`);
      }

      temposSeg.forEach(t => {
        const idx = Math.min(nBins - 1, Math.floor(t / binSize));
        bins[idx]++;
      });

      this.graficos.hist = new Chart(ctxHist, {
        type: 'bar',
        data: {
          labels: binLabels,
          datasets: [{ label: 'Frequência de Espera', data: bins, backgroundColor: '#2563eb' }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: corTexto }, grid: { color: corGrid } },
            y: { ticks: { color: corTexto }, grid: { color: corGrid } }
          }
        }
      });
    }
  },

  /* ==========================================================================
     TABELA DE PESSOAS E EXPORTAÇÃO
     ========================================================================== */
  renderizarTabelaPessoas() {
    if (!this.dadosCompletos) return;
    const pessoas = this.dadosCompletos.metricas.pessoas;
    const busca = (document.getElementById('filtro-busca-tabela').value || '').toLowerCase();
    const status = document.getElementById('filtro-status-tabela').value;

    let filtradas = pessoas.filter(p => {
      if (status !== 'todos' && p.status !== status) return false;
      if (busca && !String(p.pessoa).includes(busca)) return false;
      return true;
    });

    const { coluna, asc } = this.ordenacaoTabela;
    filtradas.sort((a, b) => {
      const vA = a[coluna] || 0;
      const vB = b[coluna] || 0;
      return asc ? (vA > vB ? 1 : -1) : (vA < vB ? 1 : -1);
    });

    const corpo = document.getElementById('tabela-pessoas-corpo');
    corpo.innerHTML = '';

    filtradas.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>Pessoa ${p.pessoa}</strong></td>
        <td>${formatarHoraLocal(p.chegadaMs)}</td>
        <td>${p.atendimentoMs ? formatarHoraLocal(p.atendimentoMs) : '--'}</td>
        <td>${p.esperaMs !== null ? `${formatarNumero(p.esperaMs / 1000, 1)} s` : '--'}</td>
        <td>${p.intervaloAtendimentoMs !== null ? `${formatarNumero(p.intervaloAtendimentoMs / 1000, 1)} s` : '--'}</td>
        <td>${p.dispositivoChegada || '--'}</td>
        <td>${p.dispositivoAtendimento || '--'}</td>
        <td><strong>${p.status.toUpperCase()}</strong></td>
      `;
      corpo.appendChild(tr);
    });
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

  baixarCsvPessoas() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/csv-pessoas`;
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

    const texto = `=== RELATÓRIO DE DESEMPENHO DA FILA DO RU ===
Sessão: ${meta.nome}
Local: ${meta.local}
Data/Início: ${new Date(m.inicioMs).toLocaleString('pt-BR')}
Duração: ${formatarDuracao(m.duracaoTotalMs)} (${formatarNumero(m.duracaoMin, 1)} min)

--- TOTAIS E TAXAS ---
• Chegadas: ${m.n_chegadas} (λ = ${formatarNumero(m.lambda, 2)} pessoas/min)
• Atendimentos: ${m.n_atendimentos} (Vazão = ${formatarNumero(m.vazaoGlobalPorMin, 2)} pessoas/min)
• Pessoas restantes na fila: ${m.n_na_fila}
• Servidores (catracas): ${meta.config.servidores || 1}
• Taxa de Serviço (μ): ${formatarNumero(m.muPorServidor, 2)} pessoas/min/servidor
• Utilização (ρ): ${formatarNumero(m.utilizacao * 100, 1)}%

--- TEMPOS DE ESPERA ---
• Espera Média: ${formatarDuracao(m.statsEspera.media * 1000).substring(3)}
• Mediana: ${formatarDuracao(m.statsEspera.mediana * 1000).substring(3)}
• P95: ${formatarDuracao(m.statsEspera.p95 * 1000).substring(3)}
• Intervalo Médio na Catraca: ${formatarNumero(m.statsIntervalosAtend.media, 1)} s

--- COMPRIMENTO DA FILA ---
• Média Ponderada no Tempo (L): ${formatarNumero(m.filaTempo.mediaPonderada, 1)} pessoas
• Pico Máximo: ${m.filaTempo.max} pessoas (${formatarHoraLocal(m.filaTempo.instanteMaxMs)})
• Lei de Little: L = ${formatarNumero(m.filaTempo.mediaPonderada, 1)} vs λ·W = ${formatarNumero(m.little.L_calculado_lambda_W, 1)} (Dif: ${formatarNumero(m.little.diffPerc, 1)}%)
=============================================`;

    navigator.clipboard.writeText(texto).then(() => {
      alert('Resumo formatado copiado com sucesso para a área de transferência!');
    }).catch(() => {
      alert('Não foi possível copiar automaticamente.');
    });
  },

  async renomearSessao(id) {
    const novoNome = prompt('Digite o novo nome para esta sessão:');
    if (!novoNome || !novoNome.trim()) return;

    await fetch(`/api/sessoes/${id}/renomear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novoNome: novoNome.trim() })
    });
    this.carregarListaSessoes();
  },

  async excluirSessao(id) {
    if (!confirm('Deseja realmente excluir permanentemente esta sessão e todos os seus logs?')) return;
    await fetch(`/api/sessoes/${id}/excluir`, { method: 'POST' });
    this.carregarListaSessoes();
  },

  abrirModalImportar() {
    document.getElementById('modal-importar').classList.add('open');
  },

  fecharModais() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  },

  processarImportacaoArquivo() {
    const fileInput = document.getElementById('file-import-json');
    if (!fileInput.files || fileInput.files.length === 0) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const resp = await fetch('/api/sessoes/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: e.target.result
        });
        const res = await resp.json();
        if (res.sucesso) {
          this.fecharModais();
          this.carregarListaSessoes();
          alert('Sessão importada com sucesso!');
        } else {
          alert('Erro na importação: ' + res.erro);
        }
      } catch (err) {
        alert('Erro ao enviar JSON: ' + err.message);
      }
    };
    reader.readAsText(fileInput.files[0]);
  },

  async abrirModalComparar() {
    const resp = await fetch('/api/sessoes');
    const sessoes = await resp.json();
    const box = document.getElementById('comparar-checkboxes');
    box.innerHTML = '';

    sessoes.forEach((s, idx) => {
      const lbl = document.createElement('label');
      lbl.style.display = 'inline-flex';
      lbl.style.alignItems = 'center';
      lbl.style.gap = '6px';
      lbl.style.fontSize = '0.85rem';
      lbl.innerHTML = `<input type="checkbox" value="${s.id}" ${idx < 3 ? 'checked' : ''} onchange="HistoricoApp.renderizarTabelaComparacao()"> <span>${s.nome}</span>`;
      box.appendChild(lbl);
    });

    this.renderizarTabelaComparacao();
    document.getElementById('modal-comparar').classList.add('open');
  },

  async renderizarTabelaComparacao() {
    const cbs = document.querySelectorAll('#comparar-checkboxes input[type="checkbox"]:checked');
    const ids = Array.from(cbs).map(c => c.value);
    const tabela = document.getElementById('tabela-comparacao');

    if (ids.length === 0) {
      tabela.innerHTML = '<tr><td style="padding:15px; text-align:center;">Selecione ao menos uma sessão.</td></tr>';
      return;
    }

    const sessoesDet = [];
    for (const id of ids) {
      const r = await fetch(`/api/sessoes/${id}`);
      sessoesDet.push(await r.json());
    }

    let thead = '<tr><th>Métrica</th>';
    sessoesDet.forEach(s => { thead += `<th>${s.meta.nome}</th>`; });
    thead += '</tr>';

    const linhas = [
      { rotulo: 'Duração', fn: s => formatarDuracao(s.metricas.duracaoTotalMs) },
      { rotulo: 'Chegadas (λ)', fn: s => `${s.metricas.n_chegadas} (${formatarNumero(s.metricas.lambda, 2)} p/m)` },
      { rotulo: 'Atendimentos', fn: s => `${s.metricas.n_atendimentos} (Vazão: ${formatarNumero(s.metricas.vazaoGlobalPorMin, 2)})` },
      { rotulo: 'Utilização (ρ)', fn: s => `${formatarNumero(s.metricas.utilizacao * 100, 1)}%` },
      { rotulo: 'Fila Média (L)', fn: s => formatarNumero(s.metricas.filaTempo.mediaPonderada, 1) },
      { rotulo: 'Pico da Fila', fn: s => s.metricas.filaTempo.max },
      { rotulo: 'Espera Média', fn: s => formatarDuracao(s.metricas.statsEspera.media * 1000).substring(3) },
      { rotulo: 'Espera P95', fn: s => formatarDuracao(s.metricas.statsEspera.p95 * 1000).substring(3) },
      { rotulo: 'Intervalo Médio Catraca', fn: s => `${formatarNumero(s.metricas.statsIntervalosAtend.media, 1)} s` }
    ];

    let tbody = '';
    linhas.forEach(l => {
      tbody += `<tr><td><strong>${l.rotulo}</strong></td>`;
      sessoesDet.forEach(s => { tbody += `<td>${l.fn(s)}</td>`; });
      tbody += '</tr>';
    });

    tabela.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (this.dadosCompletos) {
      this.renderizarGraficos(this.dadosCompletos);
    }
  }
};

window.HistoricoApp = HistoricoApp;
document.addEventListener('DOMContentLoaded', () => HistoricoApp.init());

