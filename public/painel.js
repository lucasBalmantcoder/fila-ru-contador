/**
 * public/painel.js
 * Lógica do painel de monitoramento do notebook (tela larga para projeção).
 */

import { GerenciadorConexao } from './conexao.js';
import { AnimadorFila } from './animacao.js';
import { formatarDuracao, formatarHoraLocal, formatarNumero } from '../shared/metricas.js';

const PainelApp = {
  conexao: null,
  animador: null,
  estado: null,
  sessao: null,
  eventos: [],
  rejeitados: [],
  filaMaxAtingida: 0,
  ultimoAtendimentoTempo: Date.now(),
  limiarAlertaOciosoSeg: 120,
  timerHud: null,

  async init() {
    // Inicializa Animador Grande
    this.animador = new AnimadorFila('container-animacao-painel');

    // Carrega dados de rede, PIN e QR Code via API
    await this.carregarInfoServidor();

    // Inicializa Conexão WebSocket
    this.conexao = new GerenciadorConexao({
      onEstado: (estado, sessao) => {
        this.sessao = sessao;
        this.atualizarEstado(estado);
        if (this.animador) this.animador.renderizarEstado(estado, false);
      },
      onNovoEvento: (evento, estado, diff) => {
        this.eventos.unshift(evento);
        this.atualizarEstado(estado);
        if (this.animador) this.animador.aplicarOperacoes(diff, estado);
        this.renderizarTabelaEventos();

        if (evento.tipo === 'atendimento') {
          this.ultimoAtendimentoTempo = Date.now();
        }
      },
      onSessaoIniciada: (sessao, estado, evento) => {
        this.sessao = sessao;
        if (evento) this.eventos.unshift(evento);
        this.atualizarEstado(estado);
        this.atualizarControlesSessao();
        this.renderizarTabelaEventos();
      },
      onSessaoEncerrada: (sessao, estado, evento) => {
        this.sessao = null;
        if (evento) this.eventos.unshift(evento);
        this.atualizarEstado(estado);
        this.atualizarControlesSessao();
        this.renderizarTabelaEventos();
      },
      onListaAparelhos: (aparelhos) => this.renderizarListaAparelhos(aparelhos),
      onStatusConexao: (status) => this.atualizarStatusConexao(status),
      onComandoRejeitado: (rejeicao) => {
        this.rejeitados.unshift(rejeicao);
        this.renderizarTabelaRejeitados();
      }
    });

    // O painel conecta usando o PIN retornado pela API
    this.conexao.salvarCredenciais(this.pinServidor, 'Painel Notebook', 'ambos');
    this.conexao.conectar();

    // Loop do HUD a cada segundo
    this.timerHud = setInterval(() => this.atualizarLoopHud(), 1000);
  },

  async carregarInfoServidor() {
    try {
      const resp = await fetch('/api/info');
      const dados = await resp.json();

      this.pinServidor = dados.pin;
      document.getElementById('txt-pin-display').textContent = dados.pin;
      document.getElementById('txt-url-display').textContent = dados.urlCelular;

      if (dados.qrDataUrl) {
        document.getElementById('img-qrcode').src = dados.qrDataUrl;
      }

      if (dados.sessaoAtiva) {
        this.sessao = dados.sessaoAtiva;
        this.atualizarControlesSessao();
      }
    } catch (e) {
      console.warn('Erro ao carregar dados do servidor:', e);
    }
  },

  gerarQrCodeDataUrl(url) {
    // QR code servido pelo servidor em /api/info
  },

  atualizarStatusConexao(status) {
    const badge = document.getElementById('badge-conexao');
    const txt = document.getElementById('txt-conexao');
    badge.className = 'status-badge';

    if (status === 'conectado') {
      badge.classList.add('online');
      txt.textContent = 'Servidor Conectado';
    } else {
      badge.classList.add('offline');
      txt.textContent = 'Desconectado';
    }
  },

  atualizarEstado(estado) {
    if (!estado) return;
    this.estado = estado;

    const filaAtual = estado.contadores.naFila;
    if (filaAtual > this.filaMaxAtingida) {
      this.filaMaxAtingida = filaAtual;
    }

    document.getElementById('kpi-fila').textContent = filaAtual;
    document.getElementById('kpi-fila-max').textContent = this.filaMaxAtingida;
    document.getElementById('kpi-atendidos').textContent = estado.contadores.atendidas;
    document.getElementById('kpi-chegadas').textContent = estado.contadores.chegadas;
    document.getElementById('kpi-anulados').textContent = estado.contadores.anuladas;

    document.getElementById('kpi-vazao').innerHTML = `${formatarNumero(estado.vazaoRecente, 1)} <span style="font-size:0.8rem">p/min</span>`;
    document.getElementById('kpi-ultimo-int').textContent = estado.ultimoIntervaloSeg !== null
      ? `${formatarNumero(estado.ultimoIntervaloSeg, 1)} s`
      : '-- s';
  },

  atualizarLoopHud() {
    if (!this.sessao || !this.sessao.inicioMs) {
      document.getElementById('kpi-tempo').textContent = '00:00:00';
      document.getElementById('kpi-restante').textContent = 'Aguardando início';
      return;
    }

    const agora = Date.now();
    const decorridoMs = agora - this.sessao.inicioMs;
    const previstoMs = (this.sessao.duracaoPrevistaMin || 60) * 60 * 1000;
    const restanteMs = previstoMs - decorridoMs;

    document.getElementById('kpi-tempo').textContent = formatarDuracao(decorridoMs);

    const timerBox = document.getElementById('hud-timer-box');
    const lblRestante = document.getElementById('kpi-restante');

    if (restanteMs <= 0) {
      timerBox.classList.add('alert-pulse');
      lblRestante.textContent = `Previsto excedido (+${formatarDuracao(Math.abs(restanteMs)).substring(3)})`;
    } else {
      timerBox.classList.remove('alert-pulse');
      lblRestante.textContent = `Faltam ${formatarDuracao(restanteMs).substring(3)}`;
    }

    // Monitoramento de Ociosidade da Catraca com Fila
    const boxAlerta = document.getElementById('box-alerta-ociosidade');
    if (this.estado && this.estado.fila.length > 0) {
      const segundosSemAtendimento = Math.floor((agora - this.ultimoAtendimentoTempo) / 1000);
      if (segundosSemAtendimento >= this.limiarAlertaOciosoSeg) {
        boxAlerta.style.display = 'block';
        document.getElementById('lbl-segundos-ocioso').textContent = segundosSemAtendimento;
      } else {
        boxAlerta.style.display = 'none';
      }
    } else {
      boxAlerta.style.display = 'none';
      this.ultimoAtendimentoTempo = agora;
    }
  },

  renderizarListaAparelhos(aparelhos = []) {
    const container = document.getElementById('lista-aparelhos-painel');
    document.getElementById('lbl-qtd-aparelhos').textContent = aparelhos.length;
    container.innerHTML = '';

    if (aparelhos.length === 0) {
      container.innerHTML = '<span style="color:var(--text-muted)">Nenhum celular conectado.</span>';
      return;
    }

    aparelhos.forEach(a => {
      const div = document.createElement('div');
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';
      div.style.padding = '4px 8px';
      div.style.borderRadius = '6px';
      div.style.background = 'var(--bg-subtle)';

      div.innerHTML = `
        <div>
          <strong>${a.nome}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted);">(${a.papel})</span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted);">
          <span>${a.qtdEventos} evs</span> • <span>${a.latenciaMs}ms</span>
        </div>
      `;
      container.appendChild(div);
    });
  },

  renderizarTabelaEventos() {
    const corpo = document.getElementById('tabela-ultimos-eventos');
    const ultimos = this.eventos.slice(0, 25);
    corpo.innerHTML = '';

    if (ultimos.length === 0) {
      corpo.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px; color:var(--text-muted)">Nenhum evento registrado.</td></tr>';
      return;
    }

    ultimos.forEach(ev => {
      const tr = document.createElement('tr');
      let detalhe = '';
      if (ev.tipo === 'chegada' || ev.tipo === 'atendimento' || ev.tipo === 'anulacao' || ev.tipo === 'reversao') {
        detalhe = `<strong>Pessoa ${ev.pessoa}</strong>`;
      } else if (ev.tipo === 'anotacao') {
        detalhe = `"${ev.texto}"`;
      } else if (ev.tipo === 'sessao_iniciada') {
        detalhe = 'Observação Iniciada';
      } else if (ev.tipo === 'sessao_encerrada') {
        detalhe = 'Observação Encerrada';
      }

      tr.innerHTML = `
        <td>${ev.seq || '--'}</td>
        <td>${formatarHoraLocal(ev.t)}</td>
        <td><strong>${ev.tipo.toUpperCase()}</strong></td>
        <td>${detalhe}</td>
        <td><span class="badge-autor">${ev.dispositivoNome || 'Servidor'}</span></td>
      `;
      corpo.appendChild(tr);
    });
  },

  renderizarTabelaRejeitados() {
    const card = document.getElementById('card-rejeitados');
    const corpo = document.getElementById('tabela-rejeitados');
    if (this.rejeitados.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    corpo.innerHTML = '';

    this.rejeitados.slice(0, 10).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatarHoraLocal(r.t)}</td>
        <td><strong style="color:var(--danger)">${r.codigo}</strong></td>
        <td>${r.mensagem}</td>
        <td>${r.dispositivoNome}</td>
      `;
      corpo.appendChild(tr);
    });
  },

  atualizarControlesSessao() {
    const boxAtiva = document.getElementById('box-sessao-ativa-botoes');
    const boxIniciar = document.getElementById('box-sessao-iniciar-botoes');
    const lblTitulo = document.getElementById('lbl-status-sessao-titulo');

    if (this.sessao && this.sessao.status === 'ativa') {
      boxAtiva.style.display = 'block';
      boxIniciar.style.display = 'none';
      lblTitulo.textContent = 'Sessão em Andamento';
      document.getElementById('lbl-sessao-ativa-nome').textContent = this.sessao.nome;
    } else {
      boxAtiva.style.display = 'none';
      boxIniciar.style.display = 'block';
      lblTitulo.textContent = 'Controle da Sessão';
    }
  },

  abrirModalIniciarSessao() {
    document.getElementById('modal-iniciar-sessao').classList.add('open');
  },

  fecharModais() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  },

  iniciarSessaoForm() {
    const config = {
      nome: document.getElementById('cfg-nome').value.trim() || 'Almoço RU',
      local: document.getElementById('cfg-local').value.trim() || 'RU Central',
      observacoes: document.getElementById('cfg-obs').value.trim(),
      duracaoPrevistaMin: parseInt(document.getElementById('cfg-duracao').value, 10) || 60,
      servidores: parseInt(document.getElementById('cfg-servidores').value, 10) || 1,
      blocoMin: parseInt(document.getElementById('cfg-bloco').value, 10) || 5,
      limiarPausaSeg: parseInt(document.getElementById('cfg-pausa').value, 10) || 60,
      teste: document.getElementById('cfg-teste').checked
    };

    this.conexao.enviar({
      tipo: 'iniciar_sessao',
      config
    });

    this.fecharModais();
  },

  confirmarEncerramentoSessao() {
    if (!confirm('Deseja realmente encerrar a sessão de observação ativa? Todos os celulares serão notificados e o relatório final estará disponível no Histórico.')) {
      return;
    }

    this.conexao.enviar({
      tipo: 'encerrar_sessao'
    });
  },

  simularCargaTeste() {
    if (!confirm('Deseja simular uma coleta de teste sintética com ~80 eventos automáticos? Uma sessão marcada como teste será criada.')) {
      return;
    }

    this.conexao.enviar({
      tipo: 'simular_teste',
      qtdEventos: 80
    });
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
  }
};

window.PainelApp = PainelApp;
document.addEventListener('DOMContentLoaded', () => PainelApp.init());
