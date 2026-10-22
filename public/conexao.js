/**
 * public/conexao.js
 * Gerenciador de conexão WebSocket, reconexão automática com recuo exponencial,
 * sincronização de relógio (5 trocas de mensagens), batimento (ping) a cada 5s
 * e fila de saída persistida em localStorage para operação offline resiliente.
 */

const STORAGE_KEY_OFFLINE = 'ru_fila_offline_queue_v1';
const STORAGE_KEY_PIN = 'ru_fila_pin_salvo';
const STORAGE_KEY_DISP = 'ru_fila_disp_info';

export class GerenciadorConexao {
  constructor(opcoes = {}) {
    this.ws = null;
    this.pin = localStorage.getItem(STORAGE_KEY_PIN) || '';
    this.dispositivo = JSON.parse(localStorage.getItem(STORAGE_KEY_DISP) || 'null') || {
      id: `disp_${Math.random().toString(36).substring(2, 9)}`,
      nome: 'Celular',
      papel: 'ambos'
    };

    this.estadoConexao = 'offline'; // 'conectado' | 'reconectando' | 'offline'
    this.tentativasReconexao = 0;
    this.timerReconexao = null;
    this.timerPing = null;
    this.offsetRelogioMs = 0;
    this.latenciaMs = 0;

    // Callbacks do cliente
    this.onEstado = opcoes.onEstado || (() => {});
    this.onNovoEvento = opcoes.onNovoEvento || (() => {});
    this.onSessaoIniciada = opcoes.onSessaoIniciada || (() => {});
    this.onSessaoEncerrada = opcoes.onSessaoEncerrada || (() => {});
    this.onListaAparelhos = opcoes.onListaAparelhos || (() => {});
    this.onStatusConexao = opcoes.onStatusConexao || (() => {});
    this.onComandoResposta = opcoes.onComandoResposta || (() => {});
    this.onComandoRejeitado = opcoes.onComandoRejeitado || (() => {});

    // Alerta ao fechar página com eventos pendentes
    window.addEventListener('beforeunload', (e) => {
      const pendentes = this.obterFilaOffline();
      if (pendentes.length > 0) {
        e.preventDefault();
        e.returnValue = `Você possui ${pendentes.length} evento(s) pendente(s) de envio. Aguarde a reconexão!`;
      }
    });
  }

  salvarCredenciais(pin, nome, papel) {
    this.pin = String(pin).trim();
    this.dispositivo.nome = nome || this.dispositivo.nome;
    this.dispositivo.papel = papel || this.dispositivo.papel;
    localStorage.setItem(STORAGE_KEY_PIN, this.pin);
    localStorage.setItem(STORAGE_KEY_DISP, JSON.stringify(this.dispositivo));
  }

  conectar() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const host = window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${host}`;

    this.atualizarStatus('reconectando');

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.warn('[WS] Falha ao criar WebSocket:', err);
      this.agendarReconexao();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WS] Conexão física estabelecida. Enviando autenticação...');
      this.tentativasReconexao = 0;
      this.enviarAutenticacao();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.processarMensagemServidor(msg);
      } catch (err) {
        console.warn('[WS] Mensagem inválida recebida:', err);
      }
    };

    this.ws.onclose = () => {
      console.warn('[WS] Conexão encerrada.');
      this.pararPing();
      this.atualizarStatus('reconectando');
      this.agendarReconexao();
    };

    this.ws.onerror = (err) => {
      console.warn('[WS] Erro no socket:', err);
      this.ws.close();
    };
  }

  enviarAutenticacao() {
    if (!this.pin) {
      this.atualizarStatus('offline');
      return;
    }

    this.enviar({
      tipo: 'autenticar',
      pin: this.pin,
      dispositivoId: this.dispositivo.id,
      dispositivoNome: this.dispositivo.nome,
      papel: this.dispositivo.papel
    });
  }

  agendarReconexao() {
    if (this.timerReconexao) clearTimeout(this.timerReconexao);
    // Recuo exponencial com teto de 3 segundos
    const atraso = Math.min(3000, 500 * Math.pow(1.5, this.tentativasReconexao));
    this.tentativasReconexao++;
    this.timerReconexao = setTimeout(() => {
      this.conectar();
    }, atraso);
  }

  iniciarPing() {
    this.pararPing();
    this.timerPing = setInterval(() => {
      if (this.estaConectado()) {
        const t1 = Date.now();
        this.enviar({
          tipo: 'ping',
          latencia: this.latenciaMs,
          offsetRelogio: this.offsetRelogioMs
        });
      }
    }, 5000);
  }

  pararPing() {
    if (this.timerPing) {
      clearInterval(this.timerPing);
      this.timerPing = null;
    }
  }

  /**
   * Executa 5 trocas de mensagens para estimar o descompasso entre o relógio do celular e do servidor.
   */
  sincronizarRelogio() {
    const amostras = [];
    let rodada = 0;

    const executarRodada = () => {
      if (rodada >= 5) {
        // Seleciona a amostra com o menor RTT (tempo de ida e volta)
        amostras.sort((a, b) => a.rtt - b.rtt);
        const melhorAmostra = amostras[0];
        this.offsetRelogioMs = melhorAmostra.offset;
        this.latenciaMs = Math.round(melhorAmostra.rtt / 2);
        console.log(`[SYNC] Relógio sincronizado! Offset: ${this.offsetRelogioMs} ms, Latência RTT: ${melhorAmostra.rtt} ms`);
        return;
      }

      const tCliente1 = Date.now();
      const handler = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.tipo === 'sync_pong' && msg.rodada === rodada) {
            this.ws.removeEventListener('message', handler);
            const tCliente2 = Date.now();
            const rtt = Math.max(1, tCliente2 - tCliente1);
            const tServidorEstimado = msg.tServidor;
            const offset = tServidorEstimado - (tCliente1 + rtt / 2);
            amostras.push({ rtt, offset });
            rodada++;
            setTimeout(executarRodada, 80);
          }
        } catch (e) {}
      };

      this.ws.addEventListener('message', handler);
      this.enviar({ tipo: 'sync_ping', tCliente1, rodada });
    };

    executarRodada();
  }

  processarMensagemServidor(msg) {
    if (msg.tipo === 'autenticado') {
      if (msg.sucesso) {
        this.atualizarStatus('conectado');
        this.sincronizarRelogio();
        this.iniciarPing();

        // Envia o estado e histórico recebidos
        if (msg.estado) this.onEstado(msg.estado, msg.sessao);

        // Descarrega eventos offline pendentes
        this.descarregarFilaOffline();
      } else {
        console.warn('[AUTH] Falha na autenticação:', msg.mensagem);
        this.atualizarStatus('offline');
        this.onStatusConexao('auth_invalida', msg.mensagem);
      }
      return;
    }

    if (msg.tipo === 'pong') {
      // Ping respondido com sucesso
      return;
    }

    if (msg.tipo === 'novo_evento') {
      this.onNovoEvento(msg.evento, msg.estado, msg.diff);
      return;
    }

    if (msg.tipo === 'sessao_iniciada') {
      this.onSessaoIniciada(msg.sessao, msg.estado, msg.evento);
      return;
    }

    if (msg.tipo === 'sessao_encerrada') {
      this.onSessaoEncerrada(msg.sessao, msg.estado, msg.evento);
      return;
    }

    if (msg.tipo === 'lista_aparelhos') {
      this.onListaAparelhos(msg.aparelhos);
      return;
    }

    if (msg.tipo === 'comando_resposta') {
      this.tratarConfirmacaoComando(msg);
      this.onComandoResposta(msg);
      return;
    }

    if (msg.tipo === 'comando_rejeitado') {
      this.onComandoRejeitado(msg.rejeicao);
      return;
    }
  }

  tratarConfirmacaoComando(msg) {
    const pendentes = this.obterFilaOffline();
    const idx = pendentes.findIndex(p => p.clientEventId === msg.clientEventId);
    if (idx !== -1) {
      pendentes.splice(idx, 1);
      this.salvarFilaOffline(pendentes);
      this.notificarMudancaStatus();
    }
  }

  /**
   * Envia comando para o servidor. Se estiver offline, enfileira no localStorage.
   */
  enviarComando(comando) {
    const clientEventId = comando.clientEventId || `ev_${this.dispositivo.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const cmdCompleto = {
      tipo: 'comando',
      ...comando,
      clientEventId,
      tCliente: Date.now()
    };

    if (this.estaConectado()) {
      this.enviar(cmdCompleto);
    } else {
      // Salva na fila offline persistente
      this.enfileirarOffline(cmdCompleto);
    }

    return clientEventId;
  }

  enfileirarOffline(cmd) {
    const fila = this.obterFilaOffline();
    cmd.tardio = true;
    fila.push(cmd);
    this.salvarFilaOffline(fila);
    this.notificarMudancaStatus();
  }

  descarregarFilaOffline() {
    const fila = this.obterFilaOffline();
    if (fila.length === 0) return;

    console.log(`[OFFLINE] Descarregando ${fila.length} evento(s) pendente(s)...`);
    // Envia eventos em ordem cronológica
    for (const cmd of fila) {
      cmd.tardio = true;
      this.enviar(cmd);
    }
  }

  obterFilaOffline() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_OFFLINE);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  salvarFilaOffline(fila) {
    try {
      localStorage.setItem(STORAGE_KEY_OFFLINE, JSON.stringify(fila));
    } catch (e) {}
  }

  enviar(objeto) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(objeto));
    }
  }

  estaConectado() {
    return this.ws && this.ws.readyState === WebSocket.OPEN && this.estadoConexao === 'conectado';
  }

  atualizarStatus(novoStatus) {
    this.estadoConexao = novoStatus;
    this.notificarMudancaStatus();
  }

  notificarMudancaStatus() {
    const pendentesQtd = this.obterFilaOffline().length;
    this.onStatusConexao(this.estadoConexao, pendentesQtd);
  }
}

