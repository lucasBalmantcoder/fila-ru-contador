/**
 * public/celular.js
 * Lógica do cliente de coleta em celulares para múltiplos pontos de verificação delegados.
 */

import { GerenciadorConexao } from './conexao.js';
import { AnimadorFila } from './animacao.js';
import { formatarDuracao } from '../shared/metricas.js';

// Sintetizador Web Audio para bipes táteis sem dependências externas
const AudioClick = {
  ctx: null,
  habilitado: true,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  tocar(freq = 600, dur = 0.08) {
    if (!this.habilitado) return;
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

export const CelularApp = {
  conexao: null,
  animador: null,
  estado: null,
  sessao: null,
  ultimoToqueMs: 0,
  intervaloMinToqueMs: 200,
  animacaoAtiva: true,
  timerHud: null,
  multiplicadoresPorPonto: {}, // pontoId -> number (1, 2, 3, 5)

  init() {
    this.tentarWakeLock();

    // Lê eventual ponto indicado no QR Code (?ponto=origem->z1)
    const urlParams = new URLSearchParams(window.location.search);
    const pontoQuery = urlParams.get('ponto');
    if (pontoQuery) {
      localStorage.setItem('ru_ponto_desejado', pontoQuery);
    }

    // Inicializa mini-animador
    this.animador = new AnimadorFila('container-animacao');

    // Inicializa conexão WebSocket
    this.conexao = new GerenciadorConexao({
      onEstado: (estado, sessao) => this.atualizarEstado(estado, sessao),
      onNovoEvento: (evento, estado, diff) => {
        this.atualizarEstado(estado);
        if (this.animador && this.animacaoAtiva) {
          this.animador.aplicarOperacoes(diff, estado);
        }
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
      onListaAparelhos: (aparelhos) => {
        if (this.animador && this.sessao) {
          this.animador.definirAtribuicoes(this.sessao.atribuicoes, aparelhos);
        }
      },
      onStatusConexao: (status, pendentesQtd) => this.atualizarStatusConexao(status, pendentesQtd),
      onComandoResposta: (res) => {
        if (res.pendenteInversao) {
          AudioClick.tocar(450, 0.1);
          this.mostrarToast(`⏳ ${res.mensagem}`, '⏳');
        } else if (!res.sucesso) {
          AudioClick.tocar(300, 0.2);
          this.mostrarToast(`⚠️ Rejeitado: ${res.mensagem}`, '❌');
        } else if (res.evento?.inversaoCorrigida) {
          this.mostrarToast('✅ Inversão sincronizada com ponto anterior!', '🟢');
        }
      }
    });

    // Se possui PIN salvo, conecta; caso contrário, abre modal
    if (this.conexao.pin) {
      const pontoDesejado = localStorage.getItem('ru_ponto_desejado');
      if (pontoDesejado) {
        this.conexao.dispositivo.pontoDesejado = pontoDesejado;
      }
      this.conexao.conectar();
    } else {
      this.abrirModalConfig();
    }

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

  darFeedback(tipo = 'normal') {
    if (navigator.vibrate) {
      navigator.vibrate(tipo === 'chegada' ? 35 : (tipo === 'avanco' ? 50 : 25));
    }
    const freq = tipo === 'chegada' ? 580 : (tipo === 'avanco' ? 760 : 640);
    AudioClick.tocar(freq, 0.08);
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

    // Atualiza HUD superior
    document.getElementById('hud-presentes').textContent = estado.contadores.presentes;
    document.getElementById('hud-saidas').textContent = estado.contadores.saidas;
    document.getElementById('hud-chegadas').textContent = estado.contadores.chegadas;

    // Renderiza cartões dos pontos atribuídos a este aparelho
    this.renderizarCartoesPontos();

    // Atualiza mini animação
    if (this.animador && this.animacaoAtiva) {
      this.animador.renderizarEstado(estado, false);
    }
  },

  obterPontosAtribuidos() {
    if (!this.estado || !this.estado.config) return [];
    const config = this.estado.config;
    const papel = this.conexao.dispositivo.papel || 'avaliador';
    const dispId = this.conexao.dispositivo.id;

    if (papel === 'observador') {
      return []; // Observador só assiste
    }

    if (papel === 'supervisor') {
      return config.pontos || []; // Supervisor opera todos
    }

    // Avaliador: apenas pontos atribuídos
    const atribuicoes = this.sessao?.atribuicoes || config.atribuicoes || {};
    const pontosIds = atribuicoes[dispId] || [];

    // Se nenhuma matriz estiver cadastrada ainda (ex: teste ou sessão recém-criada sem matriz), exibe todos
    if (Object.keys(atribuicoes).length === 0) {
      return config.pontos || [];
    }

    return (config.pontos || []).filter(p => pontosIds.includes(p.id));
  },

  renderizarCartoesPontos() {
    const container = document.getElementById('container-pontos-celular');
    const pontos = this.obterPontosAtribuidos();
    const papel = this.conexao.dispositivo.papel || 'avaliador';

    if (papel === 'observador') {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 15px; color:var(--text-muted); background:var(--bg-card); border-radius:12px; border:1px solid var(--border-color);">
          <div style="font-size:1.4rem; margin-bottom:8px;">👀 Modo Observador</div>
          <p style="font-size:0.85rem; margin:0;">Acompanhe o fluxo do restaurante na visualização abaixo.</p>
        </div>
      `;
      return;
    }

    if (pontos.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px 15px; color:var(--text-muted); background:var(--bg-card); border-radius:12px; border:1px solid var(--border-color);">
          <div style="font-size:1.4rem; margin-bottom:8px;">⏳ Sem Pontos Atribuídos</div>
          <p style="font-size:0.85rem; margin:0;">
            Aguardando atribuição no painel do notebook ou faça a leitura do QR Code do ponto.
          </p>
        </div>
      `;
      return;
    }

    // Ajusta classe de grade/layout
    container.className = 'pontos-container';
    if (pontos.length === 1) {
      container.classList.add('layout-1');
    } else if (pontos.length === 2) {
      container.classList.add('layout-2');
    } else if (pontos.length === 3 || pontos.length === 4) {
      container.classList.add('layout-grade');
    } else {
      container.classList.add('layout-rolagem');
    }

    container.innerHTML = '';

    pontos.forEach((ponto) => {
      const card = this.criarCardPonto(ponto);
      container.appendChild(card);
    });
  },

  criarCardPonto(ponto) {
    const card = document.createElement('div');
    card.className = 'card-ponto-coleta';
    card.setAttribute('data-ponto-id', ponto.id);

    const de = ponto.de;
    const para = ponto.para;
    const ehP0 = (de === 'origem');

    const zonaOrigem = this.estado.zonas[de];
    const zonaDestino = this.estado.zonas[para];

    const ocupOrigem = zonaOrigem ? zonaOrigem.ocupacao : 0;
    const ocupDestino = zonaDestino ? zonaDestino.ocupacao : (para === 'saida' ? this.estado.contadores.saidas : 0);

    const modoOrigem = zonaOrigem ? zonaOrigem.modo : 'fifo';
    const multAtual = this.multiplicadoresPorPonto[ponto.id] || 1;

    // Cabeçalho e Ocupação das zonas vizinhas
    let trajetoTxt = `${de.toUpperCase()} → ${para.toUpperCase()}`;
    if (ehP0) trajetoTxt = `Chegada → ${zonaDestino ? zonaDestino.nome : para}`;
    else if (para === 'saida') trajetoTxt = `${zonaOrigem ? zonaOrigem.nome : de} → Saída`;
    else if (zonaOrigem && zonaDestino) trajetoTxt = `${zonaOrigem.nome} → ${zonaDestino.nome}`;

    let labelBtn = 'REGISTRAR PASSAGEM';
    let subBtn = 'Confirmar avanço';
    let classeBtn = 'passagem-fifo';
    let desabilitado = false;

    if (ehP0) {
      labelBtn = 'CHEGADA';
      subBtn = '+1 Aluno na Fila';
      classeBtn = 'chegada';
      desabilitado = false;
    } else if (modoOrigem === 'fifo') {
      labelBtn = 'REGISTRAR PASSAGEM';
      classeBtn = 'passagem-fifo';
      if (zonaOrigem && zonaOrigem.cabeca !== null) {
        subBtn = `Próxima: Pessoa ${zonaOrigem.cabeca}`;
      } else {
        subBtn = 'Fila Vazia';
        desabilitado = true;
      }
    } else {
      // Modo contagem
      labelBtn = 'SAIU +1';
      classeBtn = 'passagem-contagem';
      subBtn = `Presentes: ${ocupOrigem}`;
      if (ocupOrigem === 0) desabilitado = true;
    }

    card.innerHTML = `
      <div class="card-ponto-header">
        <div>
          <div class="card-ponto-nome">${ponto.nome}</div>
          <div class="card-ponto-trajeto">${trajetoTxt}</div>
        </div>
        <div style="font-size:0.75rem; font-weight:700; color:var(--text-muted);">
          Total: <strong style="color:var(--text-main);">${ponto.totalPassagens || 0}</strong>
        </div>
      </div>

      <div class="ocupacao-vizinhas">
        <span>Origem: <strong>${ehP0 ? 'Entrada' : ocupOrigem}</strong></span>
        <span>Destino: <strong>${para === 'saida' ? 'Saída' : ocupDestino}</strong></span>
      </div>

      <div class="multiplicador-bar">
        <button class="btn-mult ${multAtual === 1 ? 'active' : ''}" onclick="CelularApp.setMultiplicador('${ponto.id}', 1)">x1</button>
        <button class="btn-mult ${multAtual === 2 ? 'active' : ''}" onclick="CelularApp.setMultiplicador('${ponto.id}', 2)">x2</button>
        <button class="btn-mult ${multAtual === 3 ? 'active' : ''}" onclick="CelularApp.setMultiplicador('${ponto.id}', 3)">x3</button>
        <button class="btn-mult ${multAtual === 5 ? 'active' : ''}" onclick="CelularApp.setMultiplicador('${ponto.id}', 5)">x5</button>
      </div>

      <button class="btn-acao-ponto ${classeBtn}" id="btn-acao-${ponto.id}" ${desabilitado ? 'disabled' : ''} onclick="CelularApp.acionarPonto('${ponto.id}')">
        <span class="btn-acao-titulo">${labelBtn}${multAtual > 1 ? ` (${multAtual}x)` : ''}</span>
        <span class="btn-acao-sub">${subBtn}</span>
      </button>

      <div class="ponto-acoes-secundarias">
        <button class="btn-ponto-aux" title="Desfazer último registro neste ponto" onclick="CelularApp.reverterPonto('${ponto.id}')">
          ↩ Desfazer
        </button>
        <button class="btn-ponto-aux" title="Remover aluno da zona" onclick="CelularApp.abrirAnulacaoPonto('${ponto.id}')">
          ✕ Remover
        </button>
        <button class="btn-ponto-aux" title="Registrar anotação vinculada a este ponto" onclick="CelularApp.abrirAnotacaoPonto('${ponto.id}')">
          📝 Anotação
        </button>
      </div>
    `;

    return card;
  },

  setMultiplicador(pontoId, mult) {
    this.multiplicadoresPorPonto[pontoId] = mult;
    this.renderizarCartoesPontos();
  },

  acionarPonto(pontoId) {
    if (!this.verificarDebounce()) return;
    const ponto = (this.estado?.config?.pontos || []).find(p => p.id === pontoId);
    if (!ponto) return;

    const mult = this.multiplicadoresPorPonto[pontoId] || 1;
    const de = ponto.de;
    const ehP0 = (de === 'origem');
    const zonaOrigem = this.estado.zonas[de];
    const modoOrigem = zonaOrigem ? zonaOrigem.modo : 'fifo';

    this.darFeedback(ehP0 ? 'chegada' : 'avanco');

    for (let k = 0; k < mult; k++) {
      const clientEventId = `c_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${k}`;

      if (ehP0) {
        this.conexao.enviarComando({
          acao: 'chegada',
          ponto: pontoId,
          clientEventId
        });
      } else {
        const cmd = {
          acao: 'avanco',
          ponto: pontoId,
          clientEventId
        };

        if (modoOrigem === 'fifo' && zonaOrigem?.fila?.[k]) {
          cmd.pessoaEsperada = zonaOrigem.fila[k];
        }

        this.conexao.enviarComando(cmd);
      }
    }

    // Reseta multiplicador para 1x após disparo
    this.multiplicadoresPorPonto[pontoId] = 1;
    this.mostrarToast(`Registro enviado no ponto ${ponto.nome}...`, '⏳');
  },

  reverterPonto(pontoId) {
    const ponto = (this.estado?.config?.pontos || []).find(p => p.id === pontoId);
    const nomePonto = ponto ? ponto.nome : pontoId;

    if (!confirm(`Deseja desfazer o último registro efetuado no ponto "${nomePonto}"?`)) {
      return;
    }

    this.conexao.enviarComando({
      acao: 'reversao',
      ponto: pontoId,
      clientEventId: `rev_${Date.now()}`
    });
    this.mostrarToast(`Desfazendo último registro em ${nomePonto}...`, '⏳');
  },

  abrirAnulacaoPonto(pontoId) {
    const ponto = (this.estado?.config?.pontos || []).find(p => p.id === pontoId);
    if (!ponto) return;

    const zonaId = ponto.de === 'origem' ? ponto.para : ponto.de;
    const zona = this.estado?.zonas?.[zonaId];

    if (!zona || zona.fila.length === 0) {
      alert(`A zona "${zona ? zona.nome : zonaId}" está vazia no momento.`);
      return;
    }

    if (zona.modo === 'contagem') {
      // Zona contagem: correção de contagem direta com confirmação
      if (confirm(`Remover 1 pessoa da zona "${zona.nome}" como correção de contagem?`)) {
        this.conexao.enviarComando({
          acao: 'anulacao',
          zona: zonaId,
          ponto: pontoId,
          clientEventId: `anul_${Date.now()}`
        });
      }
      return;
    }

    // Zona FIFO: exibe modal para selecionar qual pessoa desistiu/foi errada
    document.getElementById('lbl-anulacao-desc').textContent = `Selecione a pessoa para remover da zona "${zona.nome}":`;
    const container = document.getElementById('lista-pessoas-anulacao');
    container.innerHTML = '';

    zona.fila.forEach((pId, idx) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.padding = '6px 12px';
      btn.style.fontSize = '0.85rem';
      btn.textContent = `Pessoa ${pId} ${idx === 0 ? '(Cabeça)' : ''}`;
      btn.onclick = () => {
        this.conexao.enviarComando({
          acao: 'anulacao',
          pessoa: pId,
          zona: zonaId,
          ponto: pontoId,
          clientEventId: `anul_${Date.now()}_${pId}`
        });
        this.fecharModais();
        this.mostrarToast(`Anulação da Pessoa ${pId} enviada...`, '⏳');
      };
      container.appendChild(btn);
    });

    document.getElementById('modal-anulacao').classList.add('open');
  },

  abrirAnotacaoPonto(pontoId) {
    document.getElementById('txt-anotacao').value = '';
    document.getElementById('txt-anotacao-ponto').value = pontoId || '';
    document.getElementById('modal-anotacao').classList.add('open');
    setTimeout(() => document.getElementById('txt-anotacao').focus(), 150);
  },

  preencherAnotacao(texto) {
    document.getElementById('txt-anotacao').value = texto;
  },

  enviarAnotacao() {
    const texto = document.getElementById('txt-anotacao').value.trim();
    const pontoId = document.getElementById('txt-anotacao-ponto').value || null;
    if (!texto) return;

    this.conexao.enviarComando({
      acao: 'anotacao',
      texto,
      ponto: pontoId,
      clientEventId: `not_${Date.now()}`
    });

    this.fecharModais();
    this.mostrarToast('Anotação registrada.', '📝');
  },

  notificarNovoEvento(evento) {
    if (evento.tipo === 'chegada') {
      this.mostrarToast(`Pessoa ${evento.pessoa} CHEGOU (${evento.dispositivoNome})`, '👥');
    } else if (evento.tipo === 'avanco') {
      this.mostrarToast(`Pessoa ${evento.pessoa} avançou em ${evento.ponto || 'ponto'}`, '🍽️');
    } else if (evento.tipo === 'anulacao') {
      this.mostrarToast(`Pessoa ${evento.pessoa} foi anulada (${evento.dispositivoNome})`, '❌');
    } else if (evento.tipo === 'reversao') {
      this.mostrarToast(`Registro desfeito no ponto (${evento.dispositivoNome})`, '↩');
    }
  },

  atualizarTimerHud() {
    if (!this.sessao || !this.sessao.inicioMs) {
      document.getElementById('hud-tempo').textContent = '00:00';
      return;
    }
    const decorrido = Date.now() - this.sessao.inicioMs;
    document.getElementById('hud-tempo').textContent = formatarDuracao(decorrido).substring(3);
  },

  toggleAnimacao() {
    this.animacaoAtiva = !this.animacaoAtiva;
    const container = document.getElementById('container-animacao');
    const lbl = document.getElementById('lbl-toggle-anim');

    if (this.animacaoAtiva) {
      container.style.display = 'block';
      lbl.textContent = 'Ocultar';
      if (this.animador && this.estado) this.animador.renderizarEstado(this.estado, false);
    } else {
      container.style.display = 'none';
      lbl.textContent = 'Exibir';
    }
  },

  abrirModalConfig() {
    document.getElementById('cfg-pin').value = this.conexao.pin || '';
    document.getElementById('cfg-nome').value = this.conexao.dispositivo.nome || 'Celular';
    document.getElementById('cfg-papel').value = this.conexao.dispositivo.papel || 'avaliador';
    document.getElementById('cfg-som').checked = AudioClick.habilitado;
    document.getElementById('modal-auth').classList.add('open');
  },

  salvarEConectar() {
    const pin = document.getElementById('cfg-pin').value.trim();
    const nome = document.getElementById('cfg-nome').value.trim() || 'Celular';
    const papel = document.getElementById('cfg-papel').value;
    AudioClick.habilitado = document.getElementById('cfg-som').checked;

    if (!pin || pin.length !== 4) {
      alert('Informe o PIN de 4 dígitos exibido no notebook.');
      return;
    }

    this.conexao.salvarCredenciais(pin, nome, papel);
    this.fecharModais();
    this.mostrarToast('Conectando ao servidor...', '⏳');
    this.conexao.conectar();
  },

  fecharModais() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  }
};

window.CelularApp = CelularApp;
document.addEventListener('DOMContentLoaded', () => CelularApp.init());
