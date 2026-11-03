/**
 * public/historico.js
 * Lógica da tela de histórico, reprodução fiel do percurso (esboço 960x660),
 * navegação por abas de filas ativas, métricas segmentadas e auditoria de cobertura.
 */

import { derivarEstado } from '../shared/estado.js';
import { calcularMetricas, formatarDuracao, formatarHoraLocal, formatarNumero } from '../shared/metricas.js';
import { AnimadorFila } from './animacao.js';
import { ControladorReplay } from './replay.js';
import { GerenciadorConexao } from './conexao.js';

const HistoricoApp = {
  sessaoAtual: null,
  dadosCompletos: null,
  metricasAtuais: null,
  animador: null,
  controladorReplay: null,
  conexaoAoVivo: null,
  graficos: {},
  abaAtual: 'geral',
  excluirSemCobertura: false,
  ordenacaoTabela: { coluna: 'pessoa', asc: true },

  async init() {
    this.animador = new AnimadorFila('container-animacao-replay');

    this.controladorReplay = new ControladorReplay({
      velocidadeInicial: 5,
      onTick: (t, decorrido, progresso) => {
        this.atualizarInterfaceReplay(t, decorrido, progresso);
      },
      onStatusChange: (tocando) => {
        const btn = document.getElementById('btn-play-pause');
        if (btn) btn.textContent = tocando ? '⏸ Pausar' : '▶ Reproduzir';
      },
      onFim: () => {
        const btn = document.getElementById('btn-play-pause');
        if (btn) btn.textContent = '▶ Reproduzir';
      }
    });

    const slider = document.getElementById('slider-timeline');
    if (slider) {
      slider.addEventListener('mousedown', () => this.controladorReplay.iniciarArrasto());
      slider.addEventListener('touchstart', () => this.controladorReplay.iniciarArrasto(), { passive: true });
      slider.addEventListener('input', (e) => {
        const frac = parseFloat(e.target.value) / 1000;
        this.controladorReplay.arrastarPara(frac);
      });
      slider.addEventListener('change', (e) => {
        const frac = parseFloat(e.target.value) / 1000;
        this.controladorReplay.finalizarArrasto(frac);
      });
    }

    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
        return;
      }

      const container = document.getElementById('detalhes-sessao');
      if (!container || container.style.display === 'none') return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlayPause();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.controladorReplay.avancar(-5000);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.controladorReplay.avancar(5000);
      } else if (e.code === 'Home') {
        e.preventDefault();
        this.reiniciarReplay();
      }
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('diagnostico') === '1') {
      this.executarAutoDiagnostico();
    }

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
        const filasStr = s.filasAtivas ? s.filasAtivas.map(f => `F${f}`).join(', ') : 'F1';

        item.innerHTML = `
          <div>
            <div style="font-weight:700; font-size:1rem; display:flex; align-items:center; gap:8px;">
              <span>${s.nome}</span> ${tagTeste}
              <span style="font-size:0.72rem; background:var(--bg-card); border:1px solid var(--border-color); padding:1px 6px; border-radius:4px;">${filasStr}</span>
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

  voltarParaLista() {
    this.pararReplay();
    if (this.conexaoAoVivo) {
      this.conexaoAoVivo.fechar();
      this.conexaoAoVivo = null;
    }
    document.getElementById('card-lista-sessoes').style.display = 'block';
    document.getElementById('detalhes-sessao').style.display = 'none';
  },

  async abrirSessao(id) {
    try {
      const resp = await fetch(`/api/sessoes/${id}`);
      this.dadosCompletos = await resp.json();
      this.sessaoAtual = this.dadosCompletos.meta;
      this.excluirSemCobertura = false;
      document.getElementById('chk-excluir-sem-cobertura').checked = false;

      this.metricasAtuais = this.dadosCompletos.metricas;

      document.getElementById('card-lista-sessoes').style.display = 'none';
      document.getElementById('detalhes-sessao').style.display = 'flex';

      // Constrói Abas de Filas
      this.construirAbasFilas();

      // Inicializa Cabeçalho e Replay
      this.preencherCabecalhoSessao();
      this.iniciarPlayerReplay(this.dadosCompletos.eventos);

      if (this.sessaoAtual && this.sessaoAtual.status === 'ativa') {
        this.iniciarConexaoAoVivo(id);
      }

      // Exibe Aba Geral por padrão
      this.selecionarAba('geral');
      this.renderizarTabelaPessoas();

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      alert('Erro ao carregar detalhes da sessão: ' + err.message);
    }
  },

  preencherCabecalhoSessao() {
    const meta = this.sessaoAtual;
    const metricas = this.metricasAtuais;

    document.getElementById('rel-nome').textContent = meta.nome;
    document.getElementById('rel-sub').textContent =
      `${meta.local} • Início: ${formatarHoraLocal(metricas.inicioMs)} • Duração: ${formatarDuracao(metricas.duracaoTotalMs)} (${formatarNumero(metricas.duracaoMin, 1)} min)`;
    document.getElementById('rel-obs').textContent = meta.observacoes ? `Observações: "${meta.observacoes}"` : '';
  },

  construirAbasFilas() {
    const nav = document.getElementById('tab-nav-filas');
    nav.innerHTML = '<button class="tab-btn active" id="tab-btn-geral" onclick="HistoricoApp.selecionarAba(\'geral\')">Visão Geral</button>';

    const ativas = (this.sessaoAtual && this.sessaoAtual.filasAtivas) || [1];
    const nomes = {
      '1': 'Fila 1 (Entrada → Catraca)',
      '2': 'Fila 2 (Atendimento)',
      '3': 'Fila 3 (Saída)'
    };

    ativas.forEach(f => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.id = `tab-btn-${f}`;
      const mFila = this.metricasAtuais.filas && this.metricasAtuais.filas[String(f)];
      const semDados = mFila && mFila.semDados;

      btn.innerHTML = `${nomes[f] || `Fila ${f}`} ${semDados ? '<span class="badge-sem-dados">Sem dados</span>' : ''}`;
      if (semDados) btn.classList.add('sem-dados');

      btn.onclick = () => this.selecionarAba(String(f));
      nav.appendChild(btn);
    });
  },

  selecionarAba(aba) {
    this.abaAtual = aba;

    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.id === `tab-btn-${aba}`);
    });

    const secGeral = document.getElementById('aba-geral');
    const secFila = document.getElementById('aba-fila-detalhe');

    if (aba === 'geral') {
      secGeral.style.display = 'flex';
      secFila.style.display = 'none';
      this.renderizarVisaoGeral();
    } else {
      secGeral.style.display = 'none';
      secFila.style.display = 'flex';
      this.renderizarDetalheFila(aba);
    }
  },

  toggleExcluirSemCobertura() {
    this.excluirSemCobertura = document.getElementById('chk-excluir-sem-cobertura').checked;

    // Recalcula métricas
    this.metricasAtuais = calcularMetricas(
      this.dadosCompletos.eventos,
      this.dadosCompletos.metricas.duracaoTotalMs,
      this.dadosCompletos.meta.config,
      this.dadosCompletos.conexoes,
      { excluirSemCobertura: this.excluirSemCobertura }
    );

    const lblAviso = document.getElementById('lbl-aviso-cobertura');
    if (this.excluirSemCobertura) {
      lblAviso.textContent = 'ℹ️ Intervalos sem cobertura excluídos dos cálculos.';
    } else {
      lblAviso.textContent = '';
    }

    this.construirAbasFilas();
    this.selecionarAba(this.abaAtual);
    this.renderizarTabelaPessoas();
  },

  renderizarVisaoGeral() {
    const containerCards = document.getElementById('cards-resumo-filas-geral');
    containerCards.innerHTML = '';

    const ativas = (this.sessaoAtual && this.sessaoAtual.filasAtivas) || [1];
    const nomes = {
      '1': { titulo: 'Fila 1 (Entrada → Catraca)', cor: '#dc2626' },
      '2': { titulo: 'Fila 2 (Atendimento → Mesas)', cor: '#16a34a' },
      '3': { titulo: 'Fila 3 (Mesas → Saída)', cor: '#ec4899' }
    };

    ativas.forEach(f => {
      const mFila = (this.metricasAtuais.filas && this.metricasAtuais.filas[String(f)]) || this.metricasAtuais;
      const cfg = nomes[f] || { titulo: `Fila ${f}`, cor: 'var(--primary)' };

      const card = document.createElement('div');
      card.className = 'card';
      card.style.borderTop = `4px solid ${cfg.cor}`;

      if (mFila.semDados) {
        card.innerHTML = `
          <div class="card-title">
            <span style="color:${cfg.cor}; font-weight:800;">${cfg.titulo}</span>
            <span class="badge-sem-dados">Sem dados</span>
          </div>
          <p style="font-size:0.85rem; color:var(--text-muted); padding:10px 0;">Nenhum evento registrado nesta fila durante a sessão.</p>
        `;
      } else {
        card.innerHTML = `
          <div class="card-title">
            <span style="color:${cfg.cor}; font-weight:800;">${cfg.titulo}</span>
            <span style="font-size:0.75rem; color:var(--text-muted);">Cobertura: ${formatarNumero(mFila.cobertura.percentual, 1)}%</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-top:6px;">
            <div class="hud-stat" style="padding:6px 10px;">
              <span class="label">Chegadas / Passagens</span>
              <span class="value" style="font-size:1.1rem;">${mFila.n_chegadas} / ${mFila.n_atendimentos}</span>
            </div>
            <div class="hud-stat" style="padding:6px 10px;">
              <span class="label">Vazão Global</span>
              <span class="value" style="font-size:1.1rem;">${formatarNumero(mFila.vazaoGlobalPorMin, 2)} p/m</span>
            </div>
            <div class="hud-stat" style="padding:6px 10px;">
              <span class="label">Fila Média (L) / Pico</span>
              <span class="value" style="font-size:1.1rem;">${formatarNumero(mFila.filaTempo.mediaPonderada, 1)} / ${mFila.filaTempo.max}</span>
            </div>
            <div class="hud-stat" style="padding:6px 10px;">
              <span class="label">Espera Média</span>
              <span class="value" style="font-size:1.1rem;">${formatarDuracao(mFila.statsEspera.media * 1000).substring(3)}</span>
            </div>
          </div>
          <div style="margin-top:10px; display:flex; justify-content:flex-end;">
            <button class="btn btn-secondary" style="font-size:0.78rem; padding:3px 8px;" onclick="HistoricoApp.selecionarAba('${f}')">Ver Detalhes da Fila ${f} →</button>
          </div>
        `;
      }
      containerCards.appendChild(card);
    });

    // Card de Trânsito até as Mesas (Fila 1 + Fila 2)
    const cardTransito = document.getElementById('card-transito-mesas');
    if (this.metricasAtuais.transitoMesas && this.metricasAtuais.transitoMesas.count > 0) {
      cardTransito.style.display = 'block';
      const tm = this.metricasAtuais.transitoMesas;
      document.getElementById('tm-count').textContent = tm.count;
      document.getElementById('tm-media').textContent = formatarDuracao(tm.mediaSeg * 1000).substring(3);
      document.getElementById('tm-mediana').textContent = formatarDuracao(tm.medianaSeg * 1000).substring(3);
      document.getElementById('tm-p90').textContent = formatarDuracao(tm.p90Seg * 1000).substring(3);
    } else {
      cardTransito.style.display = 'none';
    }

    // Gráfico Comparativo das Filas no Tempo
    this.renderizarGraficoComparativoFilas();
  },

  renderizarDetalheFila(filaNum) {
    const mFila = (this.metricasAtuais.filas && this.metricasAtuais.filas[String(filaNum)]) || this.metricasAtuais;
    const boxSemDados = document.getElementById('box-sem-dados');
    const containerKpis = document.getElementById('container-kpis-fila');

    if (mFila.semDados) {
      boxSemDados.style.display = 'block';
      containerKpis.style.display = 'none';
      document.getElementById('box-ociosidade-segmentada').parentElement.style.display = 'none';
      document.getElementById('box-cobertura-info').parentElement.style.display = 'none';
      document.getElementById('box-little-info').parentElement.style.display = 'none';
      document.getElementById('box-teorico-info').parentElement.style.display = 'none';
      document.getElementById('tabela-blocos-corpo').parentElement.parentElement.parentElement.style.display = 'none';
      document.getElementById('chart-acumulado').parentElement.style.display = 'none';
      document.getElementById('chart-blocos').parentElement.style.display = 'none';
      document.getElementById('chart-histograma').parentElement.style.display = 'none';
      return;
    }

    boxSemDados.style.display = 'none';
    containerKpis.style.display = 'grid';
    document.getElementById('box-ociosidade-segmentada').parentElement.style.display = 'block';
    document.getElementById('box-cobertura-info').parentElement.style.display = 'block';
    document.getElementById('box-little-info').parentElement.style.display = 'block';
    document.getElementById('box-teorico-info').parentElement.style.display = 'block';
    document.getElementById('tabela-blocos-corpo').parentElement.parentElement.parentElement.style.display = 'block';
    document.getElementById('chart-acumulado').parentElement.style.display = 'block';
    document.getElementById('chart-blocos').parentElement.style.display = 'block';
    document.getElementById('chart-histograma').parentElement.style.display = 'block';

    // KPIs
    document.getElementById('kpi-f-cheg').textContent = mFila.n_chegadas;
    document.getElementById('kpi-f-lambda').textContent = `λ = ${formatarNumero(mFila.lambda, 2)} p/min`;
    document.getElementById('kpi-f-atend').textContent = mFila.n_atendimentos;
    document.getElementById('kpi-f-vazao').textContent = `Vazão = ${formatarNumero(mFila.vazaoGlobalPorMin, 2)} p/min`;
    document.getElementById('kpi-f-util').textContent = `${formatarNumero(mFila.utilizacao * 100, 1)}%`;
    document.getElementById('kpi-f-mu').textContent = `μ = ${formatarNumero(mFila.muPorServidor, 2)} p/min`;

    document.getElementById('kpi-f-l').textContent = formatarNumero(mFila.filaTempo.mediaPonderada, 1);
    document.getElementById('kpi-f-pico').textContent = `Pico: ${mFila.filaTempo.max} (${formatarHoraLocal(mFila.filaTempo.instanteMaxMs)})`;

    document.getElementById('kpi-f-esp-media').textContent = formatarDuracao(mFila.statsEspera.media * 1000).substring(3);
    document.getElementById('kpi-f-esp-mediana').textContent = `Mediana: ${formatarDuracao(mFila.statsEspera.mediana * 1000).substring(3)}`;
    document.getElementById('kpi-f-esp-p95').textContent = formatarDuracao(mFila.statsEspera.p95 * 1000).substring(3);
    document.getElementById('kpi-f-esp-p90').textContent = `P90: ${formatarDuracao(mFila.statsEspera.p90 * 1000).substring(3)}`;

    document.getElementById('kpi-f-int-media').textContent = `${formatarNumero(mFila.statsIntervalosAtend.media, 1)} s`;
    document.getElementById('kpi-f-int-cv').textContent = `CV: ${formatarNumero(mFila.statsIntervalosAtend.cv, 2)}`;

    document.getElementById('kpi-f-cobertura').textContent = `${formatarNumero(mFila.cobertura.percentual, 1)}%`;
    document.getElementById('kpi-f-lacunas').textContent = `${mFila.cobertura.intervalosSemCobertura.length} lacunas`;

    // Ociosidade Segmentada
    const oc = mFila.ociosidade;
    const det = oc.detalhe;
    document.getElementById('box-ociosidade-segmentada').innerHTML = `
      <p>• <strong>(a) Serviço parado (com fila aguardando):</strong> ${formatarDuracao(det.servicoParadoSeg * 1000)} (${formatarNumero(det.percServicoParado, 1)}%)</p>
      <p>• <strong>(b) Sem demanda (serviço livre, fila vazia):</strong> ${formatarDuracao(det.semDemandaSeg * 1000)} (${formatarNumero(det.percSemDemanda, 1)}%)</p>
      <p>• <strong>(c) Sem cobertura (sem celulares na área):</strong> ${formatarDuracao(det.semCoberturaSeg * 1000)} (${formatarNumero(det.percSemCobertura, 1)}%)</p>
      <p style="margin-top:6px; color:var(--text-muted); font-size:0.8rem;">
        Total de pausas longas (> ${this.sessaoAtual.config.limiarPausaSeg || 60}s): <strong>${oc.qtdPausas}</strong>
      </p>
    `;

    // Cobertura da Equipe & Lacunas
    const cob = mFila.cobertura;
    let lacunasHtml = '';
    if (cob.intervalosSemCobertura.length === 0) {
      lacunasHtml = '<span style="color:var(--success); font-weight:700;">✅ Nenhuma lacuna sem cobertura registrada.</span>';
    } else {
      lacunasHtml = '<div style="margin-top:4px;"><strong>Lacunas identificadas:</strong><ul style="padding-left:18px; margin-top:2px;">';
      cob.intervalosSemCobertura.forEach(lac => {
        lacunasHtml += `<li>${formatarHoraLocal(lac.inicioMs)} até ${formatarHoraLocal(lac.fimMs)} (${formatarDuracao(lac.duracaoSeg * 1000)})</li>`;
      });
      lacunasHtml += '</ul></div>';
    }

    document.getElementById('box-cobertura-info').innerHTML = `
      <p>• Percentual com Cobertura: <strong>${formatarNumero(cob.percentual, 1)}%</strong> (${formatarDuracao(cob.tempoComCoberturaSeg * 1000)})</p>
      <p>• Tempo Descoberto: <strong>${formatarDuracao(cob.tempoSemCoberturaSeg * 1000)}</strong></p>
      <p>• Aparelhos que cobriram esta fila: <strong>${cob.aparelhosDistintos.length}</strong> (${cob.aparelhosDistintos.join(', ') || 'Nenhum'})</p>
      ${lacunasHtml}
    `;

    // Lei de Little
    const l = mFila.little;
    document.getElementById('box-little-info').innerHTML = `
      <p>• Comprimento Médio Observado (L): <strong>${formatarNumero(l.L_observado, 2)} pessoas</strong></p>
      <p>• Produto λ · W: <strong>${formatarNumero(l.L_calculado_lambda_W, 2)} pessoas</strong></p>
      <p>• Discrepância Percentual: <strong>${formatarNumero(l.diffPerc, 1)}%</strong> ${l.consistente ? '✅ (Consistente)' : '⚠️ (Diferença esperada em períodos finitos)'}</p>
    `;

    // Modelo Teórico
    const teo = mFila.teorico;
    const boxTeo = document.getElementById('box-teorico-info');
    if (teo.aplicavel) {
      boxTeo.innerHTML = `
        <p>• Servidores: <strong>c = ${teo.c}</strong> • Intensidade: <strong>a = ${formatarNumero(teo.a, 2)} Erlangs</strong></p>
        <p>• Fila Teórica (Lq): <strong>${formatarNumero(teo.Lq, 2)} pessoas</strong> (Obs: ${formatarNumero(mFila.filaTempo.mediaPonderada, 2)})</p>
        <p>• Espera Teórica (Wq): <strong>${formatarDuracao(teo.Wq_seg * 1000).substring(3)}</strong> (Obs: ${formatarDuracao(mFila.statsEspera.media * 1000).substring(3)})</p>
        <p>• Probabilidade de Espera P(W>0): <strong>${formatarNumero(teo.P_espera * 100, 1)}%</strong></p>
      `;
    } else {
      boxTeo.innerHTML = `<span style="color:var(--warning)">⚠️ ${teo.motivo}</span>`;
    }

    // Tabela de Blocos
    this.renderizarTabelaBlocos(mFila.vazaoBlocos.blocos);

    // Gráficos da Fila
    this.renderizarGraficosFila(mFila);
  },

  renderizarTabelaBlocos(blocos = []) {
    const corpo = document.getElementById('tabela-blocos-corpo');
    corpo.innerHTML = '';

    if (blocos.length === 0) {
      corpo.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:12px; color:var(--text-muted)">Nenhum bloco registrado.</td></tr>';
      return;
    }

    blocos.forEach(b => {
      const tr = document.createElement('tr');
      const zero = b.atendimentos === 0;
      if (zero) tr.className = 'bloco-sem-passagens';

      tr.innerHTML = `
        <td><strong>${b.rotulo}</strong></td>
        <td>${formatarHoraLocal(b.inicioMs)}</td>
        <td>${formatarHoraLocal(b.fimMs)}</td>
        <td>${b.chegadas}</td>
        <td><strong>${b.atendimentos}</strong></td>
        <td>${zero ? '<span style="color:var(--danger); font-weight:700;">⚠️ ZERO PASSAGENS</span>' : 'Normal'}</td>
      `;
      corpo.appendChild(tr);
    });
  },

  /* ==========================================================================
     PLAYER DE REPRODUÇÃO DA FILA (ESBOÇO 960x660)
     ========================================================================== */
  iniciarPlayerReplay(eventos) {
    if (!eventos || eventos.length === 0) return;

    this.pararReplay();

    this.replay.tInicio = eventos[0].t;
    this.replay.tFim = eventos[eventos.length - 1].t;
    this.replay.duracaoTotal = Math.max(1000, this.replay.tFim - this.replay.tInicio);
    this.replay.tAtual = this.replay.tInicio;

    document.getElementById('lbl-tempo-total-replay').textContent = formatarDuracao(this.replay.duracaoTotal).substring(3);

    this.criarMarcadoresTimeline(eventos);
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
        rotulo = `Pessoa ${ev.pessoa} Anulada (F${ev.fila || 1})`;
      } else if (ev.tipo === 'reversao') {
        icone = '↩';
        rotulo = `Pessoa ${ev.pessoa} Revertida (F${ev.fila || 1})`;
      } else if (ev.tipo === 'fila_desativada') {
        icone = '⏹';
        rotulo = `Fila ${ev.fila} Desativada`;
      } else if (ev.tipo === 'ajuste_fila') {
        icone = '⚙️';
        rotulo = `Ajuste F${ev.fila} (${ev.delta > 0 ? '+' : ''}${ev.delta})`;
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

    // Derivação pura do estado a partir do início até o instante t
    const estado = derivarEstado(this.dadosCompletos.eventos, t);

    // Atualiza contadores sincronizados
    const f1 = (estado.filas && estado.filas['1']) ? estado.filas['1'].fila.length : (estado.fila ? estado.fila.length : 0);
    const f2 = (estado.filas && estado.filas['2']) ? estado.filas['2'].fila.length : 0;
    const f3 = (estado.filas && estado.filas['3']) ? estado.filas['3'].fila.length : 0;

    document.getElementById('rep-f1').textContent = f1;
    document.getElementById('rep-f2').textContent = f2;
    document.getElementById('rep-f3').textContent = f3;

    let totalAtendidas = 0;
    if (estado.filas) {
      Object.values(estado.filas).forEach(f => { totalAtendidas += (f.atendidas || 0); });
    } else {
      totalAtendidas = estado.contadores.atendidas;
    }

    document.getElementById('rep-atendidos').textContent = totalAtendidas;
    document.getElementById('rep-vazao').textContent = formatarNumero(estado.vazaoRecente, 1);

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
  renderizarGraficoComparativoFilas() {
    const ctx = document.getElementById('chart-filas-comparativo');
    if (!ctx) return;

    if (this.graficos.comparativo) {
      this.graficos.comparativo.destroy();
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const corTexto = isDark ? '#94a3b8' : '#64748b';
    const corGrid = isDark ? '#334155' : '#e2e8f0';

    const ativas = (this.sessaoAtual && this.sessaoAtual.filasAtivas) || [1];
    const cores = { '1': '#dc2626', '2': '#16a34a', '3': '#ec4899' };
    const rotulos = { '1': 'Fila 1 (Entrada)', '2': 'Fila 2 (Atendimento)', '3': 'Fila 3 (Saída)' };

    const datasets = [];
    let labels = [];

    ativas.forEach(f => {
      const mFila = (this.metricasAtuais.filas && this.metricasAtuais.filas[String(f)]) || this.metricasAtuais;
      if (mFila && mFila.filaTempo && mFila.filaTempo.timeline && mFila.filaTempo.timeline.length > 0) {
        if (labels.length === 0) {
          labels = mFila.filaTempo.timeline.map(item => `${((item.t - this.metricasAtuais.inicioMs) / 60000).toFixed(1)}m`);
        }
        datasets.push({
          label: rotulos[f] || `Fila ${f}`,
          data: mFila.filaTempo.timeline.map(item => item.q),
          borderColor: cores[f] || '#2563eb',
          backgroundColor: 'transparent',
          stepped: true,
          borderWidth: 2
        });
      }
    });

    this.graficos.comparativo = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: corTexto, maxTicksLimit: 12 }, grid: { color: corGrid } },
          y: { ticks: { color: corTexto }, grid: { color: corGrid } }
        }
      }
    });
  },

  renderizarGraficosFila(mFila) {
    const inicioMs = this.metricasAtuais.inicioMs;

    ['acumulado', 'blocos', 'hist'].forEach(k => {
      if (this.graficos[k]) this.graficos[k].destroy();
    });

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const corTexto = isDark ? '#94a3b8' : '#64748b';
    const corGrid = isDark ? '#334155' : '#e2e8f0';

    // 1. Acumulado
    const ctxAcumulado = document.getElementById('chart-acumulado');
    if (ctxAcumulado && this.dadosCompletos.eventos) {
      const filaNum = parseInt(this.abaAtual, 10) || 1;
      const eventosFila = this.dadosCompletos.eventos.filter(e => (!e.fila && filaNum === 1) || e.fila === filaNum);

      const labels = ['0m'];
      const dataCheg = [0];
      const dataAtend = [0];
      let accC = 0;
      let accA = 0;

      for (const ev of eventosFila) {
        if (ev.tipo === 'chegada') accC++;
        if (ev.tipo === 'atendimento' || ev.tipo === 'saida') accA++;
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
            { label: 'Passagens / Saídas', data: dataAtend, borderColor: '#1d4ed8', stepped: true, borderWidth: 2 }
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

    // 2. Blocos
    const ctxBlocos = document.getElementById('chart-blocos');
    if (ctxBlocos && mFila.vazaoBlocos && mFila.vazaoBlocos.blocos) {
      this.graficos.blocos = new Chart(ctxBlocos, {
        type: 'bar',
        data: {
          labels: mFila.vazaoBlocos.blocos.map(b => b.rotulo),
          datasets: [
            { label: 'Chegadas', data: mFila.vazaoBlocos.blocos.map(b => b.chegadas), backgroundColor: '#15803d' },
            { label: 'Passagens', data: mFila.vazaoBlocos.blocos.map(b => b.atendimentos), backgroundColor: '#1d4ed8' }
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

    // 3. Histograma
    const ctxHist = document.getElementById('chart-histograma');
    if (ctxHist && mFila.pessoas) {
      const temposSeg = mFila.pessoas
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
    if (!this.metricasAtuais) return;
    const pessoas = this.metricasAtuais.pessoas || [];
    const busca = (document.getElementById('filtro-busca-tabela').value || '').toLowerCase();
    const status = document.getElementById('filtro-status-tabela').value;
    const filtroFila = document.getElementById('filtro-fila-tabela').value;

    let filtradas = pessoas.filter(p => {
      if (filtroFila !== 'todas' && String(p.fila || 1) !== filtroFila) return false;
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

    if (filtradas.length === 0) {
      corpo.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:12px; color:var(--text-muted)">Nenhuma pessoa encontrada com os filtros selecionados.</td></tr>';
      return;
    }

    filtradas.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>Pessoa ${p.pessoa}</strong></td>
        <td><span style="font-weight:700;">F${p.fila || 1}</span></td>
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

  baixarCsvResumo() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/csv-resumo`;
  },

  baixarCsvBlocos() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/csv-blocos`;
  },

  baixarBackupJson() {
    if (!this.sessaoAtual) return;
    window.location.href = `/api/sessoes/${this.sessaoAtual.id}/json`;
  },

  copiarResumo() {
    if (!this.dadosCompletos) return;
    const m = this.metricasAtuais;
    const meta = this.dadosCompletos.meta;

    let filasTexto = '';
    const ativas = meta.filasAtivas || [1];

    ativas.forEach(f => {
      const mF = (m.filas && m.filas[String(f)]) || m;
      if (mF.semDados) {
        filasTexto += `\n--- FILA ${f} ---\n[Sem dados registrados]\n`;
      } else {
        filasTexto += `\n--- FILA ${f} ---
• Chegadas: ${mF.n_chegadas} (λ = ${formatarNumero(mF.lambda, 2)} p/min)
• Passagens/Saídas: ${mF.n_atendimentos} (Vazão = ${formatarNumero(mF.vazaoGlobalPorMin, 2)} p/min)
• Fila Média (L): ${formatarNumero(mF.filaTempo.mediaPonderada, 1)} (Pico: ${mF.filaTempo.max})
• Espera Média: ${formatarDuracao(mF.statsEspera.media * 1000).substring(3)} (P95: ${formatarDuracao(mF.statsEspera.p95 * 1000).substring(3)})
• Cobertura: ${formatarNumero(mF.cobertura.percentual, 1)}% (${mF.cobertura.intervalosSemCobertura.length} lacunas)
• Ociosidade: Serviço Parado: ${formatarNumero(mF.ociosidade.detalhe.percServicoParado, 1)}% | Sem Demanda: ${formatarNumero(mF.ociosidade.detalhe.percSemDemanda, 1)}% | Sem Cobertura: ${formatarNumero(mF.ociosidade.detalhe.percSemCobertura, 1)}%\n`;
      }
    });

    const texto = `=== RELATÓRIO DE DESEMPENHO DA FILA DO RU ===
Sessão: ${meta.nome}
Local: ${meta.local}
Data/Início: ${new Date(m.inicioMs).toLocaleString('pt-BR')}
Duração: ${formatarDuracao(m.duracaoTotalMs)} (${formatarNumero(m.duracaoMin, 1)} min)
Filas Monitoradas: ${ativas.map(f => `F${f}`).join(', ')}
${filasTexto}
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
      { rotulo: 'Filas Ativas', fn: s => (s.meta.filasAtivas || [1]).map(f => `F${f}`).join(', ') },
      { rotulo: 'Chegadas (F1)', fn: s => {
        const m = (s.metricas.filas && s.metricas.filas['1']) || s.metricas;
        return `${m.n_chegadas} (${formatarNumero(m.lambda, 2)} p/m)`;
      }},
      { rotulo: 'Atendimentos (F1)', fn: s => {
        const m = (s.metricas.filas && s.metricas.filas['1']) || s.metricas;
        return `${m.n_atendimentos} (Vazão: ${formatarNumero(m.vazaoGlobalPorMin, 2)})`;
      }},
      { rotulo: 'Fila Média (F1)', fn: s => {
        const m = (s.metricas.filas && s.metricas.filas['1']) || s.metricas;
        return formatarNumero(m.filaTempo.mediaPonderada, 1);
      }},
      { rotulo: 'Pico da Fila (F1)', fn: s => {
        const m = (s.metricas.filas && s.metricas.filas['1']) || s.metricas;
        return m.filaTempo.max;
      }},
      { rotulo: 'Espera Média (F1)', fn: s => {
        const m = (s.metricas.filas && s.metricas.filas['1']) || s.metricas;
        return formatarDuracao(m.statsEspera.media * 1000).substring(3);
      }},
      { rotulo: 'Cobertura (F1)', fn: s => {
        const m = (s.metricas.filas && s.metricas.filas['1']) || s.metricas;
        return `${formatarNumero(m.cobertura.percentual, 1)}%`;
      }}
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
      if (this.abaAtual === 'geral') {
        this.renderizarGraficoComparativoFilas();
      } else {
        const mFila = (this.metricasAtuais.filas && this.metricasAtuais.filas[this.abaAtual]) || this.metricasAtuais;
        this.renderizarGraficosFila(mFila);
      }
    }
  }
};

window.HistoricoApp = HistoricoApp;
document.addEventListener('DOMContentLoaded', () => HistoricoApp.init());
