/**
 * public/historico.js
 * Lógica da tela de histórico, reprodução fiel do percurso (esboço 960x660),
 * navegação por abas de filas ativas, métricas segmentadas e auditoria de cobertura.
 */

import { derivarEstado } from '../shared/estado.js';
import { calcularMetricas, formatarDuracao, formatarHoraLocal, formatarNumero } from '../shared/metricas.js';
import { TimelineAnimada } from '../shared/movimento.js';
import { AnimadorFila } from './animacao.js';
import { ControladorReplay } from './replay.js';
import { GerenciadorConexao } from './conexao.js';

const HistoricoApp = {
  sessaoAtual: null,
  dadosCompletos: null,
  metricasAtuais: null,
  animador: null,
  controladorReplay: null,
  timelineAnimada: null,
  conexaoAoVivo: null,
  graficos: {},
  abaAtual: 'geral',
  excluirSemCobertura: false,
  ordenacaoTabela: { coluna: 'pessoa', asc: true },

  async init() {
    this.animador = new AnimadorFila('container-animacao-replay');

    this.controladorReplay = new ControladorReplay({
      velocidadeInicial: 5,
      onTick: (t, progresso, estado) => {
        this.atualizarInterfaceReplay(t, progresso, estado);
      },
      onStatusChange: (tocando, vel) => {
        const btn = document.getElementById('btn-play-pause');
        if (btn) btn.textContent = tocando ? '⏸ Pausar' : '▶ Reproduzir';
        if (vel) {
          document.querySelectorAll('.btn-speed').forEach(b => {
            b.classList.toggle('active', b.textContent === `${vel}x`);
          });
        }
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

    // Botão Voltar com listener direto além de inline onclick
    const btnVoltar = document.getElementById('btn-voltar');
    if (btnVoltar) {
      btnVoltar.addEventListener('click', (e) => {
        e.preventDefault();
        this.voltarParaLista();
      });
    }

    // Navegação com histórico do navegador (botão voltar / avançar)
    window.addEventListener('popstate', (e) => {
      const sessaoId = (e.state && e.state.sessao) || new URLSearchParams(window.location.search).get('sessao');
      if (sessaoId) {
        this.abrirSessao(sessaoId, false);
      } else {
        this.voltarParaLista(false);
      }
    });

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

    const sessaoInicial = params.get('sessao');
    if (sessaoInicial) {
      await this.abrirSessao(sessaoInicial, false);
    } else {
      await this.carregarListaSessoes();
    }
  },

  async carregarListaSessoes() {
    const container = document.getElementById('lista-sessoes-container');
    const chkTestes = document.getElementById('chk-mostrar-testes');
    const mostrarTestes = chkTestes ? chkTestes.checked : false;

    try {
      const resp = await fetch('/api/sessoes');
      if (!resp.ok) throw new Error(`Falha ao obter lista (status ${resp.status})`);
      let sessoes = await resp.json();
      this.sessoesLista = sessoes;

      if (!mostrarTestes) {
        sessoes = sessoes.filter(s => !s.teste);
      }

      container.innerHTML = '';
      if (!Array.isArray(sessoes) || sessoes.length === 0) {
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
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:0.8rem;" onclick="HistoricoApp.abrirModalEditarSessao('${s.id}')" title="Editar informações da sessão">✏️</button>
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

  voltarParaLista(atualizarHistorico = true) {
    this.pararReplay();
    if (this.conexaoAoVivo) {
      this.conexaoAoVivo.fechar();
      this.conexaoAoVivo = null;
    }
    this.sessaoAtual = null;
    this.dadosCompletos = null;
    this.metricasAtuais = null;

    const cardLista = document.getElementById('card-lista-sessoes');
    const detalhes = document.getElementById('detalhes-sessao');
    if (cardLista) cardLista.style.display = 'block';
    if (detalhes) detalhes.style.display = 'none';

    if (atualizarHistorico && typeof window !== 'undefined' && window.history) {
      const url = new URL(window.location.href);
      url.searchParams.delete('sessao');
      window.history.pushState({}, '', url.pathname + (url.search ? url.search : ''));
    }

    this.carregarListaSessoes();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async abrirSessao(id, atualizarHistorico = true) {
    try {
      const resp = await fetch(`/api/sessoes/${id}`);
      if (!resp.ok) {
        throw new Error(`Sessão não encontrada ou indisponível (HTTP ${resp.status})`);
      }
      this.dadosCompletos = await resp.json();
      if (!this.dadosCompletos || !this.dadosCompletos.meta) {
        throw new Error('Formato inválido de dados da sessão.');
      }

      this.sessaoAtual = this.dadosCompletos.meta || {};
      if (!Array.isArray(this.sessaoAtual.filasAtivas)) {
        this.sessaoAtual.filasAtivas = [1];
      }
      if (!this.sessaoAtual.config) {
        this.sessaoAtual.config = {};
      }
      if (!Array.isArray(this.dadosCompletos.eventos)) {
        this.dadosCompletos.eventos = [];
      }
      if (!Array.isArray(this.dadosCompletos.conexoes)) {
        this.dadosCompletos.conexoes = [];
      }

      // Garante métricas calculadas com segurança
      if (!this.dadosCompletos.metricas && Array.isArray(this.dadosCompletos.eventos)) {
        this.dadosCompletos.metricas = calcularMetricas(
          this.dadosCompletos.eventos,
          this.sessaoAtual.config,
          this.sessaoAtual.fimMs || null,
          this.dadosCompletos.conexoes
        );
      }
      this.metricasAtuais = this.dadosCompletos.metricas || {};

      this.excluirSemCobertura = false;
      const chkCob = document.getElementById('chk-excluir-sem-cobertura');
      if (chkCob) chkCob.checked = false;

      // Atualiza URL com query string e pushState
      if (atualizarHistorico && typeof window !== 'undefined' && window.history) {
        const url = new URL(window.location.href);
        url.searchParams.set('sessao', id);
        window.history.pushState({ sessao: id }, '', url.toString());
      }

      const cardLista = document.getElementById('card-lista-sessoes');
      const detalhes = document.getElementById('detalhes-sessao');
      if (cardLista) cardLista.style.display = 'none';
      if (detalhes) detalhes.style.display = 'flex';

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
      this.voltarParaLista(false);
    }
  },

  preencherCabecalhoSessao() {
    const meta = this.sessaoAtual || {};
    const metricas = this.metricasAtuais || {};

    const elNome = document.getElementById('rel-nome');
    if (elNome) elNome.textContent = meta.nome || 'Sessão sem nome';

    const elSub = document.getElementById('rel-sub');
    if (elSub) {
      const inicioStr = metricas.inicioMs ? formatarHoraLocal(metricas.inicioMs) : '--:--';
      const durStr = metricas.duracaoTotalMs ? formatarDuracao(metricas.duracaoTotalMs) : '--';
      const durMin = metricas.duracaoMin !== undefined ? ` (${formatarNumero(metricas.duracaoMin, 1)} min)` : '';
      elSub.textContent = `${meta.local || 'Local não informado'} • Início: ${inicioStr} • Duração: ${durStr}${durMin}`;
    }

    const elObs = document.getElementById('rel-obs');
    if (elObs) elObs.textContent = meta.observacoes ? `Observações: "${meta.observacoes}"` : '';
  },

  construirAbasFilas() {
    const nav = document.getElementById('tab-nav-filas');
    if (!nav) return;
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
      const mFila = this.metricasAtuais && this.metricasAtuais.filas && this.metricasAtuais.filas[String(f)];
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
      if (secGeral) secGeral.style.display = 'flex';
      if (secFila) secFila.style.display = 'none';
      if (this.animador) this.animador.definirDestaqueFila(null);
      this.renderizarVisaoGeral();
    } else {
      if (secGeral) secGeral.style.display = 'none';
      if (secFila) secFila.style.display = 'flex';
      if (this.animador) this.animador.definirDestaqueFila(Number(aba));
      this.renderizarDetalheFila(aba);
    }
  },

  toggleExcluirSemCobertura() {
    const chk = document.getElementById('chk-excluir-sem-cobertura');
    this.excluirSemCobertura = chk ? chk.checked : false;

    // Recalcula métricas com os argumentos na ordem correta
    this.metricasAtuais = calcularMetricas(
      this.dadosCompletos?.eventos || [],
      this.dadosCompletos?.meta?.config || {},
      this.dadosCompletos?.meta?.fimMs || null,
      this.dadosCompletos?.conexoes || [],
      { excluirPeriodosSemCobertura: this.excluirSemCobertura }
    );

    const lblAviso = document.getElementById('lbl-aviso-cobertura');
    if (this.excluirSemCobertura) {
      if (lblAviso) lblAviso.textContent = 'ℹ️ Intervalos sem cobertura excluídos dos cálculos.';
    } else {
      if (lblAviso) lblAviso.textContent = '';
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
      const mFila = (this.metricasAtuais && this.metricasAtuais.filas && this.metricasAtuais.filas[String(f)]) || this.metricasAtuais || {};
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
        const cobPerc = mFila.cobertura?.percentual ?? 100;
        const cheg = mFila.n_chegadas ?? 0;
        const atend = mFila.n_atendimentos ?? 0;
        const vazao = mFila.vazaoGlobalPorMin ?? 0;
        const filaMedia = mFila.filaTempo?.mediaPonderada ?? 0;
        const filaMax = mFila.filaTempo?.max ?? 0;
        const espMedia = (mFila.statsEspera?.media ?? 0) * 1000;

        card.innerHTML = `
          <div class="card-title">
            <span style="color:${cfg.cor}; font-weight:800;">${cfg.titulo}</span>
            <span style="font-size:0.75rem; color:var(--text-muted);">Cobertura: ${formatarNumero(cobPerc, 1)}%</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-top:6px;">
            <div class="hud-stat" style="padding:6px 10px;">
              <span class="label">Chegadas / Passagens</span>
              <span class="value" style="font-size:1.1rem;">${cheg} / ${atend}</span>
            </div>
            <div class="hud-stat" style="padding:6px 10px;">
              <span class="label">Vazão Global</span>
              <span class="value" style="font-size:1.1rem;">${formatarNumero(vazao, 2)} p/m</span>
            </div>
            <div class="hud-stat" style="padding:6px 10px;">
              <span class="label">Fila Média (L) / Pico</span>
              <span class="value" style="font-size:1.1rem;">${formatarNumero(filaMedia, 1)} / ${filaMax}</span>
            </div>
            <div class="hud-stat" style="padding:6px 10px;">
              <span class="label">Espera Média</span>
              <span class="value" style="font-size:1.1rem;">${formatarDuracao(espMedia).substring(3)}</span>
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
    if (this.metricasAtuais?.transitoMesas && this.metricasAtuais.transitoMesas.count > 0) {
      if (cardTransito) cardTransito.style.display = 'block';
      const tm = this.metricasAtuais.transitoMesas;
      const countEl = document.getElementById('tm-count');
      const medEl = document.getElementById('tm-media');
      const medianaEl = document.getElementById('tm-mediana');
      const p90El = document.getElementById('tm-p90');
      if (countEl) countEl.textContent = tm.count;
      if (medEl) medEl.textContent = formatarDuracao(tm.mediaSeg * 1000).substring(3);
      if (medianaEl) medianaEl.textContent = formatarDuracao(tm.medianaSeg * 1000).substring(3);
      if (p90El) p90El.textContent = formatarDuracao(tm.p90Seg * 1000).substring(3);
    } else {
      if (cardTransito) cardTransito.style.display = 'none';
    }
    // Card de Trânsito até a Saída (Fila 1 + Fila 2 + Fila 3)
    const cardTransitoSaida = document.getElementById('card-transito-saida');
    const ts = this.metricasAtuais?.transitoSaida;
    if (ts && ts.count > 0) {
      if (cardTransitoSaida) cardTransitoSaida.style.display = 'block';
      const countEl = document.getElementById('ts-count');
      const medEl = document.getElementById('ts-media');
      const medianaEl = document.getElementById('ts-mediana');
      const p90El = document.getElementById('ts-p90');
      if (countEl) countEl.textContent = ts.count;
      if (medEl) medEl.textContent = formatarDuracao(ts.mediaSeg * 1000).substring(3);
      if (medianaEl) medianaEl.textContent = formatarDuracao(ts.medianaSeg * 1000).substring(3);
      if (p90El) p90El.textContent = formatarDuracao(ts.p90Seg * 1000).substring(3);
    } else {
      if (cardTransitoSaida) cardTransitoSaida.style.display = 'none';
    }


    // Gráfico Comparativo das Filas no Tempo
    this.renderizarGraficoComparativoFilas();
  },

  renderizarDetalheFila(filaNum) {
    const mFila = (this.metricasAtuais && this.metricasAtuais.filas && this.metricasAtuais.filas[String(filaNum)]) || this.metricasAtuais || {};
    const boxSemDados = document.getElementById('box-sem-dados');
    const containerKpis = document.getElementById('container-kpis-fila');

    const toggleSection = (id, show) => {
      const el = document.getElementById(id);
      if (el) {
        const container = el.closest('.chart-container') || el.closest('.card') || el.parentElement;
        if (container) container.style.display = show ? '' : 'none';
      }
    };

    if (mFila.semDados) {
      if (boxSemDados) boxSemDados.style.display = 'block';
      if (containerKpis) containerKpis.style.display = 'none';
      toggleSection('box-ociosidade-segmentada', false);
      toggleSection('box-cobertura-info', false);
      toggleSection('box-little-info', false);
      toggleSection('box-teorico-info', false);
      const tblB = document.getElementById('tabela-blocos-corpo');
      if (tblB && tblB.parentElement?.parentElement?.parentElement) {
        tblB.parentElement.parentElement.parentElement.style.display = 'none';
      }
      toggleSection('chart-acumulado', false);
      toggleSection('chart-blocos', false);
      toggleSection('chart-histograma', false);
      return;
    }

    if (boxSemDados) boxSemDados.style.display = 'none';
    if (containerKpis) containerKpis.style.display = 'grid';
    toggleSection('box-ociosidade-segmentada', true);
    toggleSection('box-cobertura-info', true);
    toggleSection('box-little-info', true);
    toggleSection('box-teorico-info', true);
    const tblB = document.getElementById('tabela-blocos-corpo');
    if (tblB && tblB.parentElement?.parentElement?.parentElement) {
      tblB.parentElement.parentElement.parentElement.style.display = 'block';
    }
    toggleSection('chart-acumulado', true);
    toggleSection('chart-blocos', true);
    toggleSection('chart-histograma', true);

    // KPIs
    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setTxt('kpi-f-cheg', mFila.n_chegadas ?? 0);
    setTxt('kpi-f-lambda', `λ = ${formatarNumero(mFila.lambda ?? 0, 2)} p/min`);
    setTxt('kpi-f-atend', mFila.n_atendimentos ?? 0);
    setTxt('kpi-f-vazao', `Vazão = ${formatarNumero(mFila.vazaoGlobalPorMin ?? 0, 2)} p/min`);
    setTxt('kpi-f-util', `${formatarNumero((mFila.utilizacao ?? 0) * 100, 1)}%`);
    setTxt('kpi-f-mu', `μ = ${formatarNumero(mFila.muPorServidor ?? 0, 2)} p/min`);

    const ft = mFila.filaTempo || {};
    setTxt('kpi-f-l', formatarNumero(ft.mediaPonderada ?? 0, 1));
    const instPicoStr = ft.instanteMaxMs ? ` (${formatarHoraLocal(ft.instanteMaxMs)})` : '';
    setTxt('kpi-f-pico', `Pico: ${ft.max ?? 0}${instPicoStr}`);

    const se = mFila.statsEspera || {};
    setTxt('kpi-f-esp-media', formatarDuracao((se.media ?? 0) * 1000).substring(3));
    setTxt('kpi-f-esp-mediana', `Mediana: ${formatarDuracao((se.mediana ?? 0) * 1000).substring(3)}`);
    setTxt('kpi-f-esp-p95', formatarDuracao((se.p95 ?? 0) * 1000).substring(3));
    setTxt('kpi-f-esp-p90', `P90: ${formatarDuracao((se.p90 ?? 0) * 1000).substring(3)}`);

    const si = mFila.statsIntervalosAtend || {};
    setTxt('kpi-f-int-media', `${formatarNumero(si.media ?? 0, 1)} s`);
    setTxt('kpi-f-int-cv', `CV: ${formatarNumero(si.cv ?? 0, 2)}`);

    const cob = mFila.cobertura || { percentual: 100, intervalosSemCobertura: [], aparelhosDistintos: [], tempoComCoberturaSeg: 0, tempoSemCoberturaSeg: 0 };
    setTxt('kpi-f-cobertura', `${formatarNumero(cob.percentual ?? 100, 1)}%`);
    setTxt('kpi-f-lacunas', `${(cob.intervalosSemCobertura || []).length} lacunas`);

    // Ociosidade Segmentada
    const oc = mFila.ociosidade || { detalhe: {}, qtdPausas: 0 };
    const det = oc.detalhe || {};
    const boxOc = document.getElementById('box-ociosidade-segmentada');
    if (boxOc) {
      boxOc.innerHTML = `
        <p>• <strong>(a) Serviço parado (com fila aguardando):</strong> ${formatarDuracao((det.servicoParadoSeg || 0) * 1000)} (${formatarNumero(det.percServicoParado || 0, 1)}%)</p>
        <p>• <strong>(b) Sem demanda (serviço livre, fila vazia):</strong> ${formatarDuracao((det.semDemandaSeg || 0) * 1000)} (${formatarNumero(det.percSemDemanda || 0, 1)}%)</p>
        <p>• <strong>(c) Sem cobertura (sem celulares na área):</strong> ${formatarDuracao((det.semCoberturaSeg || 0) * 1000)} (${formatarNumero(det.percSemCobertura || 0, 1)}%)</p>
        <p style="margin-top:6px; color:var(--text-muted); font-size:0.8rem;">
          Total de pausas longas (> ${this.sessaoAtual?.config?.limiarPausaSeg || 60}s): <strong>${oc.qtdPausas || 0}</strong>
        </p>
      `;
    }

    // Cobertura da Equipe & Lacunas
    let lacunasHtml = '';
    const lacunas = cob.intervalosSemCobertura || [];
    if (lacunas.length === 0) {
      lacunasHtml = '<span style="color:var(--success); font-weight:700;">✅ Nenhuma lacuna sem cobertura registrada.</span>';
    } else {
      lacunasHtml = '<div style="margin-top:4px;"><strong>Lacunas identificadas:</strong><ul style="padding-left:18px; margin-top:2px;">';
      lacunas.forEach(lac => {
        lacunasHtml += `<li>${formatarHoraLocal(lac.inicioMs)} até ${formatarHoraLocal(lac.fimMs)} (${formatarDuracao(lac.duracaoSeg * 1000)})</li>`;
      });
      lacunasHtml += '</ul></div>';
    }

    const boxCob = document.getElementById('box-cobertura-info');
    if (boxCob) {
      boxCob.innerHTML = `
        <p>• Percentual com Cobertura: <strong>${formatarNumero(cob.percentual ?? 100, 1)}%</strong> (${formatarDuracao((cob.tempoComCoberturaSeg || 0) * 1000)})</p>
        <p>• Tempo Descoberto: <strong>${formatarDuracao((cob.tempoSemCoberturaSeg || 0) * 1000)}</strong></p>
        <p>• Aparelhos que cobriram esta fila: <strong>${(cob.aparelhosDistintos || []).length}</strong> (${(cob.aparelhosDistintos || []).join(', ') || 'Nenhum'})</p>
        ${lacunasHtml}
      `;
    }

    // Lei de Little
    const l = mFila.little || {};
    const boxLittle = document.getElementById('box-little-info');
    if (boxLittle) {
      boxLittle.innerHTML = `
        <p>• Comprimento Médio Observado (L): <strong>${formatarNumero(l.L_observado ?? 0, 2)} pessoas</strong></p>
        <p>• Produto λ · W: <strong>${formatarNumero(l.L_calculado_lambda_W ?? 0, 2)} pessoas</strong></p>
        <p>• Discrepância Percentual: <strong>${formatarNumero(l.diffPerc ?? 0, 1)}%</strong> ${l.consistente ? '✅ (Consistente)' : '⚠️ (Diferença esperada em períodos finitos)'}</p>
      `;
    }

    // Modelo Teórico
    const teo = mFila.teorico || {};
    const boxTeo = document.getElementById('box-teorico-info');
    if (boxTeo) {
      if (teo.aplicavel) {
        boxTeo.innerHTML = `
          <p>• Servidores: <strong>c = ${teo.c}</strong> • Intensidade: <strong>a = ${formatarNumero(teo.a ?? 0, 2)} Erlangs</strong></p>
          <p>• Fila Teórica (Lq): <strong>${formatarNumero(teo.Lq ?? 0, 2)} pessoas</strong> (Obs: ${formatarNumero(ft.mediaPonderada ?? 0, 2)})</p>
          <p>• Espera Teórica (Wq): <strong>${formatarDuracao((teo.Wq_seg || 0) * 1000).substring(3)}</strong> (Obs: ${formatarDuracao((se.media || 0) * 1000).substring(3)})</p>
          <p>• Probabilidade de Espera P(W>0): <strong>${formatarNumero((teo.P_espera || 0) * 100, 1)}%</strong></p>
        `;
      } else {
        boxTeo.innerHTML = `<span style="color:var(--warning)">⚠️ ${teo.motivo || 'Modelo teórico não aplicável'}</span>`;
      }
    }

    // Tabela de Blocos
    this.renderizarTabelaBlocos(mFila.vazaoBlocos?.blocos || []);

    // Gráficos da Fila
    this.renderizarGraficosFila(mFila);
  },

  renderizarTabelaBlocos(blocos = []) {
    const corpo = document.getElementById('tabela-blocos-corpo');
    if (!corpo) return;
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
    if (!this.controladorReplay) return;
    if (!Array.isArray(eventos) || eventos.length === 0) {
      this.timelineAnimada = null;
      this.controladorReplay.carregar([], this.sessaoAtual?.config);
      const durEl = document.getElementById('lbl-tempo-total-replay');
      if (durEl) durEl.textContent = '00:00';
      const lblTempo = document.getElementById('lbl-tempo-replay');
      if (lblTempo) lblTempo.textContent = '00:00';
      return;
    }

    // Inicializa a timeline animada determinística a partir de todos os eventos da sessão
    this.timelineAnimada = new TimelineAnimada(eventos, this.sessaoAtual?.config);
    this.controladorReplay.carregar(eventos, this.sessaoAtual?.config);

    const durTotal = this.controladorReplay.duracaoTotalMs;
    const durEl = document.getElementById('lbl-tempo-total-replay');
    if (durEl) durEl.textContent = formatarDuracao(durTotal).substring(3);

    this.criarMarcadoresTimeline(eventos);
    this.controladorReplay.reiniciar();
  },

  criarMarcadoresTimeline(eventos) {
    const box = document.getElementById('box-markers-timeline');
    if (!box) return;
    box.innerHTML = '';

    if (!this.controladorReplay || this.controladorReplay.duracaoTotalMs <= 0) return;
    const durTotal = this.controladorReplay.duracaoTotalMs;
    const tInicio = this.controladorReplay.tInicio;

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
        const perc = Math.min(100, Math.max(0, ((ev.t - tInicio) / durTotal) * 100));
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
    if (this.controladorReplay) {
      this.controladorReplay.saltarPara(t);
    }
  },

  onSliderScrub(sliderVal) {
    if (this.controladorReplay) {
      const frac = parseFloat(sliderVal) / 1000;
      this.controladorReplay.definirProgresso(frac);
    }
  },

  atualizarInterfaceReplay(t, progresso, estado) {
    if (!this.controladorReplay) return;

    const decorrido = Math.max(0, t - this.controladorReplay.tInicio);
    const lblTempo = document.getElementById('lbl-tempo-replay');
    if (lblTempo) lblTempo.textContent = formatarDuracao(decorrido).substring(3);

    const slider = document.getElementById('slider-timeline');
    if (slider && !this.controladorReplay.arrastando) {
      slider.value = Math.round(progresso * 1000);
    }

    if (!estado) {
      estado = derivarEstado(this.dadosCompletos?.eventos || [], t, this.sessaoAtual?.config);
    }

    // Atualiza contadores sincronizados
    const f1 = (estado.filas && estado.filas['1']) ? estado.filas['1'].fila.length : (estado.fila ? estado.fila.length : 0);
    const f2 = (estado.filas && estado.filas['2']) ? estado.filas['2'].fila.length : 0;
    const f3 = (estado.filas && estado.filas['3']) ? estado.filas['3'].fila.length : 0;

    const elF1 = document.getElementById('rep-f1');
    if (elF1) elF1.textContent = f1;
    const elF2 = document.getElementById('rep-f2');
    if (elF2) elF2.textContent = f2;
    const elF3 = document.getElementById('rep-f3');
    if (elF3) elF3.textContent = f3;

    let totalAtendidas = 0;
    if (estado.filas) {
      Object.values(estado.filas).forEach(f => { totalAtendidas += (f.contadores?.atendidas ?? f.atendidas ?? 0); });
    } else if (estado.contadores) {
      totalAtendidas = estado.contadores.atendidas || 0;
    }

    const elAtend = document.getElementById('rep-atendidos');
    if (elAtend) elAtend.textContent = totalAtendidas;
    const elVaz = document.getElementById('rep-vazao');
    if (elVaz) elVaz.textContent = formatarNumero(estado.vazaoRecente || 0, 1);

    if (this.animador) {
      if (this.timelineAnimada) {
        // Renderização contínua e suave no instante t exato (60 fps)
        const dadosAnim = this.timelineAnimada.obterEstado(t, estado);
        this.animador.renderizarBlocosAnimados(dadosAnim);
      } else {
        this.animador.renderizarEstado(estado, false);
      }
    }
  },

  atualizarInstanteReplay(t) {
    this.saltarParaInstante(t);
  },

  togglePlayPause() {
    if (this.controladorReplay) {
      this.controladorReplay.alternar();
    }
  },

  pararReplay() {
    if (this.controladorReplay) {
      this.controladorReplay.pausar();
    }
  },

  reiniciarReplay() {
    if (this.controladorReplay) {
      this.controladorReplay.reiniciar();
    }
  },

  setVelocidade(v) {
    if (this.controladorReplay) {
      this.controladorReplay.definirVelocidade(v);
    }
  },

  ajustarMapa() {
    if (this.animador) this.animador.alternarAjustarTela();
  },

  telaCheiaMapa() {
    if (this.animador) this.animador.alternarTelaCheia();
  },

  iniciarConexaoAoVivo(id) {
    if (this.conexaoAoVivo) {
      this.conexaoAoVivo.fechar();
      this.conexaoAoVivo = null;
    }

    try {
      this.conexaoAoVivo = new GerenciadorConexao({
        papel: 'painel',
        onNovoEvento: (evento, estado) => {
          if (this.dadosCompletos && Array.isArray(this.dadosCompletos.eventos)) {
            this.dadosCompletos.eventos.push(evento);
            this.timelineAnimada = new TimelineAnimada(this.dadosCompletos.eventos, this.sessaoAtual?.config);
            if (this.controladorReplay && !this.controladorReplay.tocando) {
              this.controladorReplay.carregar(this.dadosCompletos.eventos, this.sessaoAtual?.config);
            }
          }
        }
      });
      this.conexaoAoVivo.conectar();
    } catch (e) {
      console.warn('Não foi possível conectar ao vivo no histórico:', e);
    }
  },

  async abrirModalPin() {
    const modal = document.getElementById('modal-config-pin');
    const erroEl = document.getElementById('pin-feedback-erro');
    const sucessoEl = document.getElementById('pin-feedback-sucesso');
    const avisoFixo = document.getElementById('pin-aviso-fixo');
    const pinAtual = document.getElementById('pin-atual');
    const pinNovo = document.getElementById('pin-novo');
    const pinConfirma = document.getElementById('pin-confirma');
    const btnSalvar = document.getElementById('btn-salvar-pin');
    const btnRestaurar = document.getElementById('btn-restaurar-pin');
    const chkDesconectar = document.getElementById('chk-desconectar-aparelhos');

    if (erroEl) erroEl.style.display = 'none';
    if (sucessoEl) sucessoEl.style.display = 'none';
    if (pinNovo) pinNovo.value = '';
    if (pinConfirma) pinConfirma.value = '';
    if (chkDesconectar) chkDesconectar.checked = false;

    try {
      const resp = await fetch('/api/config/pin');
      if (resp.status === 403) {
        if (erroEl) {
          erroEl.textContent = 'Acesso restrito ao computador local (notebook).';
          erroEl.style.display = 'block';
        }
        return;
      }
      const data = await resp.json();
      if (pinAtual) pinAtual.value = data.pin || '****';
      if (data.fixoPorParametro) {
        if (avisoFixo) avisoFixo.style.display = 'block';
        if (pinNovo) pinNovo.disabled = true;
        if (pinConfirma) pinConfirma.disabled = true;
        if (btnSalvar) btnSalvar.disabled = true;
        if (btnRestaurar) btnRestaurar.disabled = true;
        if (chkDesconectar) chkDesconectar.disabled = true;
      } else {
        if (avisoFixo) avisoFixo.style.display = 'none';
        if (pinNovo) pinNovo.disabled = false;
        if (pinConfirma) pinConfirma.disabled = false;
        if (btnSalvar) btnSalvar.disabled = false;
        if (btnRestaurar) btnRestaurar.disabled = false;
        if (chkDesconectar) chkDesconectar.disabled = false;
      }
    } catch (e) {
      if (pinAtual) pinAtual.value = '1234';
    }

    if (modal) modal.classList.add('open');
  },

  fecharModalPin() {
    const modal = document.getElementById('modal-config-pin');
    if (modal) modal.classList.remove('open');
  },

  toggleVerPin(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.type = el.type === 'password' ? 'text' : 'password';
  },

  restaurarPinPadrao() {
    const pN = document.getElementById('pin-novo');
    const pC = document.getElementById('pin-confirma');
    if (pN) pN.value = '1234';
    if (pC) pC.value = '1234';
  },

  async salvarNovoPin() {
    const erroEl = document.getElementById('pin-feedback-erro');
    const sucessoEl = document.getElementById('pin-feedback-sucesso');
    const pinAtual = document.getElementById('pin-atual')?.value;
    const pinNovo = document.getElementById('pin-novo')?.value.trim();
    const pinConfirma = document.getElementById('pin-confirma')?.value.trim();
    const desconectarOutros = document.getElementById('chk-desconectar-aparelhos')?.checked;

    if (erroEl) erroEl.style.display = 'none';
    if (sucessoEl) sucessoEl.style.display = 'none';

    if (!pinNovo || !pinConfirma) {
      if (erroEl) {
        erroEl.textContent = 'Por favor, preencha todos os campos.';
        erroEl.style.display = 'block';
      }
      return;
    }

    if (!/^\d{4,8}$/.test(pinNovo)) {
      if (erroEl) {
        erroEl.textContent = 'A nova senha deve ter entre 4 e 8 dígitos numéricos.';
        erroEl.style.display = 'block';
      }
      return;
    }

    if (pinNovo !== pinConfirma) {
      if (erroEl) {
        erroEl.textContent = 'A confirmação não coincide com a nova senha.';
        erroEl.style.display = 'block';
      }
      return;
    }

    if (pinAtual && pinNovo === pinAtual) {
      if (erroEl) {
        erroEl.textContent = 'A nova senha deve ser diferente da senha atual.';
        erroEl.style.display = 'block';
      }
      return;
    }

    if (!confirm(`Confirma a alteração da senha de acesso para "${pinNovo}"?`)) {
      return;
    }

    try {
      const resp = await fetch('/api/config/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novoPin: pinNovo, desconectarOutros })
      });
      const data = await resp.json();
      if (data.sucesso) {
        if (sucessoEl) {
          sucessoEl.textContent = 'Senha atualizada com sucesso!';
          sucessoEl.style.display = 'block';
        }
        setTimeout(() => this.fecharModalPin(), 1200);
      } else {
        if (erroEl) {
          erroEl.textContent = data.erro || 'Erro ao alterar a senha.';
          erroEl.style.display = 'block';
        }
      }
    } catch (e) {
      if (erroEl) {
        erroEl.textContent = 'Erro ao se comunicar com o servidor: ' + e.message;
        erroEl.style.display = 'block';
      }
    }
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
        layout: {
          padding: { top: 8, right: 16, bottom: 8, left: 8 }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { color: corTexto, font: { weight: '600' }, boxWidth: 14 }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Tempo decorrido (minutos)', color: corTexto, font: { size: 11, weight: '600' } },
            ticks: { color: corTexto, maxTicksLimit: 14, autoSkip: true, maxRotation: 45, minRotation: 0 },
            grid: { color: corGrid }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Pessoas na fila', color: corTexto, font: { size: 11, weight: '600' } },
            ticks: { color: corTexto, precision: 0, padding: 6 },
            grid: { color: corGrid }
          }
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
          layout: {
            padding: { top: 8, right: 16, bottom: 8, left: 8 }
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: { color: corTexto, font: { weight: '600' }, boxWidth: 14 }
            },
            tooltip: {
              mode: 'index',
              intersect: false
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Tempo decorrido (minutos)', color: corTexto, font: { size: 11, weight: '600' } },
              ticks: { color: corTexto, maxTicksLimit: 14, autoSkip: true, maxRotation: 45, minRotation: 0 },
              grid: { color: corGrid }
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Pessoas (total acumulado)', color: corTexto, font: { size: 11, weight: '600' } },
              ticks: { color: corTexto, precision: 0, padding: 6 },
              grid: { color: corGrid }
            }
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
          layout: {
            padding: { top: 8, right: 16, bottom: 8, left: 8 }
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: { color: corTexto, font: { weight: '600' }, boxWidth: 14 }
            },
            tooltip: {
              mode: 'index',
              intersect: false
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Intervalos de tempo (blocos)', color: corTexto, font: { size: 11, weight: '600' } },
              ticks: { color: corTexto, autoSkip: true, maxRotation: 45, minRotation: 0 },
              grid: { color: corGrid }
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Pessoas no bloco', color: corTexto, font: { size: 11, weight: '600' } },
              ticks: { color: corTexto, precision: 0, padding: 6 },
              grid: { color: corGrid }
            }
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
          layout: {
            padding: { top: 8, right: 16, bottom: 8, left: 8 }
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: { color: corTexto, font: { weight: '600' }, boxWidth: 14 }
            },
            tooltip: {
              mode: 'index',
              intersect: false
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Faixa de tempo de espera (segundos)', color: corTexto, font: { size: 11, weight: '600' } },
              ticks: { color: corTexto, autoSkip: true, maxRotation: 45, minRotation: 0 },
              grid: { color: corGrid }
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Quantidade de pessoas', color: corTexto, font: { size: 11, weight: '600' } },
              ticks: { color: corTexto, precision: 0, padding: 6 },
              grid: { color: corGrid }
            }
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

  async abrirModalEditarSessao(id) {
    let sessao = (this.sessoesLista || []).find(s => s.id === id);
    if (!sessao && this.sessaoAtual && this.sessaoAtual.id === id) {
      sessao = this.sessaoAtual;
    }
    if (!sessao) {
      try {
        const resp = await fetch(`/api/sessoes/${id}`);
        if (resp.ok) {
          const dados = await resp.json();
          sessao = dados.meta || {};
        }
      } catch (e) {
        console.warn('Erro ao carregar sessão para edição:', e);
      }
    }

    if (!sessao) {
      alert('Não foi possível carregar as informações da sessão para edição.');
      return;
    }

    const modal = document.getElementById('modal-editar-sessao');
    const inputId = document.getElementById('edit-sessao-id');
    const inputNome = document.getElementById('edit-sessao-nome');
    const inputLocal = document.getElementById('edit-sessao-local');
    const inputObs = document.getElementById('edit-sessao-obs');
    const feedbackErro = document.getElementById('edit-sessao-feedback-erro');
    const feedbackSucesso = document.getElementById('edit-sessao-feedback-sucesso');
    const btnSalvar = document.getElementById('btn-salvar-edicao');

    if (inputId) inputId.value = sessao.id;
    if (inputNome) inputNome.value = sessao.nome || '';
    if (inputLocal) inputLocal.value = sessao.local || '';
    if (inputObs) inputObs.value = sessao.observacoes || '';
    if (feedbackErro) {
      feedbackErro.style.display = 'none';
      feedbackErro.textContent = '';
    }
    if (feedbackSucesso) {
      feedbackSucesso.style.display = 'none';
      feedbackSucesso.textContent = '';
    }
    if (btnSalvar) btnSalvar.disabled = false;

    if (modal) {
      modal.classList.add('open');
      setTimeout(() => {
        if (inputNome) inputNome.focus();
      }, 50);
    }
  },

  async salvarEdicaoSessao() {
    const inputId = document.getElementById('edit-sessao-id');
    const inputNome = document.getElementById('edit-sessao-nome');
    const inputLocal = document.getElementById('edit-sessao-local');
    const inputObs = document.getElementById('edit-sessao-obs');
    const feedbackErro = document.getElementById('edit-sessao-feedback-erro');
    const feedbackSucesso = document.getElementById('edit-sessao-feedback-sucesso');
    const btnSalvar = document.getElementById('btn-salvar-edicao');

    const id = inputId ? inputId.value : null;
    const nome = inputNome ? inputNome.value.trim() : '';
    const local = inputLocal ? inputLocal.value.trim() : '';
    const observacoes = inputObs ? inputObs.value.trim() : '';

    if (!id) return;

    if (!nome) {
      if (feedbackErro) {
        feedbackErro.textContent = 'O nome da observação é obrigatório.';
        feedbackErro.style.display = 'block';
      }
      return;
    }

    if (!local) {
      if (feedbackErro) {
        feedbackErro.textContent = 'O local / campus é obrigatório.';
        feedbackErro.style.display = 'block';
      }
      return;
    }

    if (btnSalvar) btnSalvar.disabled = true;
    if (feedbackErro) feedbackErro.style.display = 'none';
    if (feedbackSucesso) feedbackSucesso.style.display = 'none';

    try {
      const resp = await fetch(`/api/sessoes/${id}/editar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, local, observacoes })
      });

      const res = await resp.json();
      if (!resp.ok || !res.sucesso) {
        throw new Error(res.erro || `Erro HTTP ${resp.status}`);
      }

      if (feedbackSucesso) {
        feedbackSucesso.textContent = 'Informações atualizadas com sucesso!';
        feedbackSucesso.style.display = 'block';
      }

      // Se a sessão editada for a sessão atualmente visualizada no relatório, atualiza o cabeçalho
      if (this.sessaoAtual && this.sessaoAtual.id === id) {
        this.sessaoAtual.nome = nome;
        this.sessaoAtual.local = local;
        this.sessaoAtual.observacoes = observacoes;
        if (this.dadosCompletos?.meta) {
          this.dadosCompletos.meta.nome = nome;
          this.dadosCompletos.meta.local = local;
          this.dadosCompletos.meta.observacoes = observacoes;
        }
        this.preencherCabecalhoSessao();
      }

      // Atualiza a lista na interface sem recarregar a página
      await this.carregarListaSessoes();

      setTimeout(() => {
        this.fecharModais();
      }, 600);
    } catch (err) {
      if (feedbackErro) {
        feedbackErro.textContent = err.message || 'Erro ao salvar alterações da sessão.';
        feedbackErro.style.display = 'block';
      }
    } finally {
      if (btnSalvar) btnSalvar.disabled = false;
    }
  },

  async renomearSessao(id) {
    this.abrirModalEditarSessao(id);
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
