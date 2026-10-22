/**
 * public/celular.js
 * Lógica do cliente de coleta em celular.
 */

import { GerenciadorConexao } from './conexao.js';
import { AnimadorFila } from './animacao.js';
import { formatarDuracao, formatarHoraLocal } from '../shared/metricas.js';

// Sintetizador Web Audio para cliques e bipes táteis sem dependências de arquivos de áudio
const AudioClick = {
  ctx: null,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  tocar(freq = 600, dur = 0.08) {
    try {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    } catch (e) {}
  }
};

const CelularApp = {
  conexao: null,
  animador: null,
  estado: null,
  sessao: null,
  ultimoToqueMs: 0,
  intervaloMinToqueMs: 250,
  animacaoAtiva: true,
  timerHud: null,

  init() {
    // Tenta Screen Wake Lock
    this.tentarWakeLock();

    // Inicia Animador
    this.animador = new AnimadorFila('container-animacao');

    // Inicializa Gerenciador de Conexão com callbacks
    this.conexao = new GerenciadorConexao({
      onEstado: (estado, sessao) => this.atualizarEstado(estado, sessao),
      onNovoEvento: (evento, estado, diff) => {
        this.atualizarEstado(estado);
        if (this.animador) this.animador.aplicarOperacoes(diff, estado);
        this.notificarNovoEvento(evento);
      },
      onSessaoIniciada: (sessao, estado) => {
        this.sessao = sessao;
        this.atualizarEstado(estado);
        this.mostrarToast(`Sessão iniciada: ${sessao.nome}`, '🟢');
      },
      onSessaoEncerrada: (sessao, estado) => {
        this.sessao = null;
        this.atualizarEstado(estado);
        this.mostrarToast('Sessão encerrada pelo painel.', '⏹');
      },
      onStatusConexao: (status, pendentesQtd) => this.atualizarStatusConexao(status, pendentesQtd),
      onComandoResposta: (res) => {
        if (!res.sucesso) {
          AudioClick.tocar(300, 0.2);
          this.mostrarToast(`⚠️ Rejeitado: ${res.mensagem}`, '❌');
        }
      }
    });

    // Se já tiver PIN salvo, conecta automaticamente; caso contrário, abre modal
    if (this.conexao.pin) {
      this.conexao.conectar();
    } else {
      this.abrirModalConfig();
    }

    // Timer local de contagem regressiva e decorrido
    this.timerHud = setInterval(() => this.atualizarTimerHud(), 1000);
  },

  async tentarWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        await navigator.wakeLock.request('screen');
      } catch (e) {
        document.getElementById('banner-tela-bloqueio').style.display = 'block';
      }
    } else {
      document.getElementById('banner-tela-bloqueio').style.display = 'block';
    }
  },

  verificarDebounce() {
    const agora = Date.now();
    if (agora - this.ultimoToqueMs < this.intervaloMinToqueMs) {
      return false;
    }
    this.ultimoToqueMs = agora;
    return true;
  },

  darFeedback(tipo = 'chegada') {
    if (navigator.vibrate) {
      navigator.vibrate(tipo === 'chegada' ? 35 : 55);
    }
    AudioClick.tocar(tipo === 'chegada' ? 580 : 820, 0.08);
  },

  mostrarToast(mensagem, icone = '🟢') {
    const toast = document.getElementById('toast-feedback');
    document.getElementById('toast-icone').textContent = icone;
    document.getElementById('toast-msg').textContent = mensagem;
    toast.classList.remove('flash');
    void toast.offsetWidth;
    toast.classList.add('flash');
  },

  atualizarStatusConexao(status, pendentesQtd = 0) {
    const badge = document.getElementById('badge-conexao');
    const txt = document.getElementById('txt-conexao');

    badge.className = 'status-badge';

    if (status === 'conectado') {
      badge.classList.add('online');
      txt.textContent = pendentesQtd > 0 ? `Online (${pendentesQtd} pend.)` : 'Conectado';
    } else if (status === 'reconectando') {
      badge.classList.add('reconnecting');
      txt.textContent = pendentesQtd > 0 ? `Reconectando (${pendentesQtd})` : 'Reconectando...';
    } else {
      badge.classList.add('offline');
      txt.textContent = pendentesQtd > 0 ? `Offline (${pendentesQtd} pend.)` : 'Desconectado';
    }
  },

  atualizarEstado(estado, sessao = null) {
    if (sessao) this.sessao = sessao;
    if (!estado) return;
    this.estado = estado;

    // Atualiza contadores do HUD
    document.getElementById('hud-fila').textContent = estado.contadores.naFila;
    document.getElementById('hud-atendidos').textContent = estado.contadores.atendidas;
    document.getElementById('hud-chegadas').textContent = estado.contadores.chegadas;
    document.getElementById('lbl-qtd-fila').textContent = estado.contadores.naFila;

    document.getElementById('lbl-total-chegadas').textContent = `Total: ${estado.contadores.chegadas}`;
    document.getElementById('lbl-total-atendidos').textContent = `Total: ${estado.contadores.atendidas}`;

    // Atualiza botão de atendimento com a pessoa esperada na catraca
    const btnAtendimento = document.getElementById('btn-atendimento');
    const lblAtend = document.getElementById('lbl-pessoa-atendimento');

    if (estado.primeiraDaFila !== null) {
      btnAtendimento.disabled = false;
      lblAtend.textContent = `Confirmar Pessoa ${estado.primeiraDaFila}`;
    } else {
      btnAtendimento.disabled = true;
      lblAtend.textContent = 'Fila Vazia';
    }

    // Renderiza lista compacta de tags da fila
    this.renderizarListaTagsFila(estado.fila);

    // Ajusta visibilidade dos botões conforme o papel configurado
    const papel = this.conexao.dispositivo.papel;
    const btnCheg = document.getElementById('btn-chegada');
    if (papel === 'chegada') {
      btnCheg.style.display = 'flex';
      btnAtendimento.style.display = 'none';
    } else if (papel === 'catraca') {
      btnCheg.style.display = 'none';
      btnAtendimento.style.display = 'flex';
    } else {
      btnCheg.style.display = 'flex';
      btnAtendimento.style.display = 'flex';
    }

    // Atualiza mini animação se habilitada
    if (this.animador && this.animacaoAtiva) {
      this.animador.renderizarEstado(estado, false);
    }
  },

  renderizarListaTagsFila(fila = []) {
    const container = document.getElementById('lista-tags-fila');
    container.innerHTML = '';

    if (fila.length === 0) {
      container.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted)">Nenhuma pessoa na fila.</span>';
      return;
    }

    fila.forEach((pId, idx) => {
      const tag = document.createElement('span');
      tag.className = `tag-pessoa ${idx === 0 ? 'primeira' : ''}`;
      tag.innerHTML = `
        <span>${idx === 0 ? 'Catraca: ' : ''}Pessoa ${pId}</span>
        <button class="btn-anular-tag" title="Anular Pessoa ${pId}" onclick="CelularApp.anularPessoa(${pId})">×</button>
      `;
      container.appendChild(tag);
    });
  },

  atualizarTimerHud() {
    if (!this.sessao || !this.sessao.inicioMs) {
      document.getElementById('hud-tempo').textContent = '00:00';
      return;
    }
    const decorrido = Date.now() - this.sessao.inicioMs;
    document.getElementById('hud-tempo').textContent = formatarDuracao(decorrido).substring(3);
  },

  notificarNovoEvento(evento) {
    if (evento.tipo === 'chegada') {
      this.mostrarToast(`Pessoa ${evento.pessoa} CHEGOU (${evento.dispositivoNome})`, '👥');
    } else if (evento.tipo === 'atendimento') {
      this.mostrarToast(`Pessoa ${evento.pessoa} ATENDIDA (${evento.dispositivoNome})`, '🍽️');
    } else if (evento.tipo === 'anulacao') {
      this.mostrarToast(`Pessoa ${evento.pessoa} ANULADA da fila (${evento.dispositivoNome})`, '❌');
    } else if (evento.tipo === 'reversao') {
      this.mostrarToast(`Atendimento de Pessoa ${evento.pessoa} REVERTIDO`, '↩');
    }
  },

  registrarChegada() {
    if (!this.verificarDebounce()) return;
    this.darFeedback('chegada');
    this.conexao.enviarComando({
      acao: 'chegada'
    });
    this.mostrarToast('Chegada enviada ao servidor...', '⏳');
  },

  registrarAtendimento() {
    if (!this.verificarDebounce()) return;
    if (!this.estado || this.estado.primeiraDaFila === null) {
      alert('A fila está vazia no momento.');
      return;
    }

    const pessoaEsperada = this.estado.primeiraDaFila;
    this.darFeedback('atendimento');
    this.conexao.enviarComando({
      acao: 'atendido',
      pessoaEsperada
    });
    this.mostrarToast(`Confirmando atendimento da Pessoa ${pessoaEsperada}...`, '⏳');
  },

  anularPessoa(pessoaId) {
    if (!confirm(`Deseja realmente remover/anular a Pessoa ${pessoaId} da fila? Ela não entrará nas métricas de atendimento.`)) {
      return;
    }
    this.conexao.enviarComando({
      acao: 'anulacao',
      pessoa: pessoaId
    });
    this.mostrarToast(`Solicitação de anulação da Pessoa ${pessoaId} enviada...`, '⏳');
  },

  removerUltimaChegada() {
    if (!this.estado || this.estado.fila.length === 0) {
      alert('Nenhuma pessoa na fila para remover.');
      return;
    }
    const ultima = this.estado.fila[this.estado.fila.length - 1];
    this.anularPessoa(ultima);
  },

  reverterUltimoAtendimento() {
    if (!confirm('Deseja realmente reverter o último atendimento confirmado? A pessoa retornará à catraca.')) {
      return;
    }
    this.conexao.enviarComando({
      acao: 'reversao'
    });
    this.mostrarToast('Reversão enviada ao servidor...', '⏳');
  },

  abrirModalAnotacao() {
    document.getElementById('txt-anotacao').value = '';
    document.getElementById('modal-anotacao').classList.add('open');
    setTimeout(() => document.getElementById('txt-anotacao').focus(), 150);
  },

  preencherAnotacao(texto) {
    document.getElementById('txt-anotacao').value = texto;
  },

  enviarAnotacao() {
    const texto = document.getElementById('txt-anotacao').value.trim();
    if (!texto) return;

    this.conexao.enviarComando({
      acao: 'anotacao',
      texto
    });

    this.fecharModais();
    this.mostrarToast(`Anotação registrada: "${texto}"`, '📝');
  },

  toggleAnimacao() {
    this.animacaoAtiva = !this.animacaoAtiva;
    const box = document.getElementById('box-mini-animacao');
    box.style.display = this.animacaoAtiva ? 'block' : 'none';
  },

  abrirModalConfig() {
    document.getElementById('cfg-pin').value = this.conexao.pin || '';
    document.getElementById('cfg-nome').value = this.conexao.dispositivo.nome || 'Celular 1';
    document.getElementById('cfg-papel').value = this.conexao.dispositivo.papel || 'ambos';
    document.getElementById('modal-auth').classList.add('open');
  },

  salvarEConectar() {
    const pin = document.getElementById('cfg-pin').value.trim();
    const nome = document.getElementById('cfg-nome').value.trim() || 'Celular';
    const papel = document.getElementById('cfg-papel').value;

    if (!pin || pin.length !== 4) {
      alert('Informe o PIN de 4 dígitos gerado pelo servidor.');
      return;
    }

    this.conexao.salvarCredenciais(pin, nome, papel);
    this.fecharModais();
    this.conexao.conectar();
    this.mostrarToast('Conectando ao servidor...', '🔄');
  },

  fecharModais() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  }
};

window.CelularApp = CelularApp;
document.addEventListener('DOMContentLoaded', () => CelularApp.init());

