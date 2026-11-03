/**
 * public/conexao.js
 * Gerenciador de conexão WebSocket, reconexão automática ultra-resiliente,
 * recuperação instantânea após tela apagada/bloqueio (< 3s), sincronização de relógio,
 * batimento (ping) a cada 5s com detecção de queda em 8s, fallback por consulta HTTP (polling)
 * e fila de saída persistente em localStorage.
 */

const STORAGE_KEY_OFFLINE = 'ru_fila_offline_queue_v2';
const STORAGE_KEY_PIN = 'ru_fila_pin_salvo';
const STORAGE_KEY_DISP = 'ru_fila_disp_info_v2';

export class GerenciadorConexao {
  constructor(opcoes = {}) {
    this.ws = null;
    this.pin = localStorage.getItem(STORAGE_KEY_PIN) || '1234';
    this.dispositivo = JSON.parse(localStorage.getItem(STORAGE_KEY_DISP) || 'null') || {
      id: `cel_${Math.random().toString(36).substring(2, 9)}`,
      nome: 'Celular',
      papel: 'ambos',
      area: '1'
    };

    this.ultimoSeqConhecido = 0;
    this.estadoConexao = 'offline'; // 'conectado' | 'reconectando' | 'polling' | 'offline'
    this.tentativasReconexao = 0;
    this.timerReconexao = null;
    this.timerPing = null;
    this.timerTimeoutPong = null;
    this.timerFallbackPolling = null;
    this.timerChecagemQueda = null;
    this.momentoQueda = null;
    this.offsetRelogioMs = 0;
    this.latenciaMs = 0;
    this.ultimoTimestampAtualizacao = Date.now();

    // Callbacks do cliente
    this.onEstado = opcoes.onEstado || (() => {});
    this.onNovoEvento = opcoes.onNovoEvento || (() => {});
    this.onSessaoIniciada = opcoes.onSessaoIniciada || (() => {});
    this.onSessaoEncerrada = opcoes.onSessaoEncerrada || (() => {});
    this.onListaAparelhos = opcoes.onListaAparelhos || (() => {});
    this.onStatusConexao = opcoes.onStatusConexao || (() => {});
    this.onComandoResposta = opcoes.onComandoResposta || (() => {});
    this.onComandoRejeitado = opcoes.onComandoRejeitado || (() => {});
    this.onAreaAtualizada = opcoes.onAreaAtualizada || (() => {});

    // Recuperação imediata ao reativar a tela ou foco do navegador
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          console.log('[CONEXAO] Tela reativada (visibilitychange). Verificando conexão...');
          if (!this.estaConectado()) {
            this.reconectarImediatamente();
          }
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', () => {
        if (!this.estaConectado()) {
          console.log('[CONEXAO] pageshow detectado. Reconectando...');
          this.reconectarImediatamente();
        }
      });

      window.addEventListener('focus', () => {
        if (!this.estaConectado()) {
          this.reconectarImediatamente();
        }
      });

      window.addEventListener('online', () => {
        console.log('[CONEXAO] Rede restabelecida (online).');
        this.reconectarImediatamente();
      });

      window.addEventListener('beforeunload', (e) => {
        const pendentes = this.obterFilaOffline();
        if (pendentes.length > 0) {
          e.preventDefault();
          e.returnValue = `Você possui ${pendentes.length} evento(s) pendente(s) de envio. Aguarde a reconexão!`;
        }
      });
    }
  }

  salvarCredenciais(pin, nome, area, papel) {
    if (pin !== undefined && pin !== null) this.pin = String(pin).trim();
    if (nome) this.dispositivo.nome = nome;
    if (area !== undefined) this.dispositivo.area = String(area);
    if (papel) this.dispositivo.papel = papel;

    try {
      localStorage.setItem(STORAGE_KEY_PIN, this.pin);
      localStorage.setItem(STORAGE_KEY_DISP, JSON.stringify(this.dispositivo));
    } catch (e) {}
  }

  mudarArea(novaArea) {
    this.dispositivo.area = String(novaArea);
    try {
      localStorage.setItem(STORAGE_KEY_DISP, JSON.stringify(this.dispositivo));
    } catch (e) {}

    if (this.estaConectado()) {
      this.enviar({
        tipo: 'mudar_area',
        dispositivoId: this.dispositivo.id,
        dispositivoNome: this.dispositivo.nome,
        novaArea: this.dispositivo.area
      });
    }
  }

  conectar() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${host}`;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('[WS] Falha ao instanciar WebSocket:', e);
      this.iniciarContagemQueda();
      this.agendarReconexao();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WS] Conexão estabelecida. Enviando credenciais salvas...');
      this.tentativasReconexao = 0;
      this.pararFallbackPolling();
      this.momentoQueda = null;
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
      console.warn('[WS] Conexão encerrada pelo servidor ou suspensa pelo aparelho.');
      this.pararPing();
      this.iniciarContagemQueda();
      this.agendarReconexao();
    };

    this.ws.onerror = (err) => {
      console.warn('[WS] Erro no socket:', err);
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
      }
    };
  }

  iniciarContagemQueda() {
    if (!this.momentoQueda) {
      this.momentoQueda = Date.now();
    }
    this.atualizarStatus('reconectando');

    if (!this.timerChecagemQueda) {
      this.timerChecagemQueda = setInterval(() => {
        if (this.estaConectado()) {
          clearInterval(this.timerChecagemQueda);
          this.timerChecagemQueda = null;
          return;
        }

        const decorrido = Date.now() - (this.momentoQueda || Date.now());
        if (decorrido >= 5000 && !this.timerFallbackPolling) {
          console.warn('[CONEXAO] Mais de 5s desconectado. Iniciando fallback por consulta HTTP (GET /api/estado)...');
          this.iniciarFallbackPolling();
        }
      }, 1000);
    }
  }

  iniciarFallbackPolling() {
    this.pararFallbackPolling();
    this.atualizarStatus('polling');

    const executarPoll = async () => {
      if (this.estaConectado()) {
        this.pararFallbackPolling();
        return;
      }

      try {
        const resp = await fetch(`/api/estado?desdeSeq=${this.ultimoSeqConhecido || 0}`);
        if (!resp.ok) return;
        const dados = await resp.json();

        if (dados.sucesso) {
          this.ultimoTimestampAtualizacao = Date.now();
          if (dados.seqAtual) {
            this.ultimoSeqConhecido = Math.max(this.ultimoSeqConhecido, dados.seqAtual);
          }

          if (dados.estado) {
            this.onEstado(dados.estado, dados.sessao);
          }

          if (Array.isArray(dados.eventosFaltantes) && dados.eventosFaltantes.length > 0) {
            for (const ev of dados.eventosFaltantes) {
              if (ev.seq > this.ultimoSeqConhecido) {
                this.ultimoSeqConhecido = ev.seq;
              }
              this.onNovoEvento(ev, dados.estado, []);
            }
          }

          this.atualizarStatus('polling');
        }
      } catch (err) {
        // Falha no poll
      }
    };

    executarPoll();
    this.timerFallbackPolling = setInterval(executarPoll, 2000);
  }

  pararFallbackPolling() {
    if (this.timerFallbackPolling) {
      clearInterval(this.timerFallbackPolling);
      this.timerFallbackPolling = null;
    }
    if (this.timerChecagemQueda) {
      clearInterval(this.timerChecagemQueda);
      this.timerChecagemQueda = null;
    }
  }

  reconectarImediatamente() {
    if (this.timerReconexao) {
      clearTimeout(this.timerReconexao);
      this.timerReconexao = null;
    }
    this.tentativasReconexao = 0;

    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.conectar();
  }

  enviarAutenticacao() {
    const ehPainel = this.dispositivo.papel === 'painel';
    const ehLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

    this.enviar({
      tipo: 'autenticar',
      pin: this.pin || '',
      authLocal: ehLocal && ehPainel,
      dispositivoId: this.dispositivo.id,
      dispositivoNome: this.dispositivo.nome,
      area: this.dispositivo.area || '1',
      papel: this.dispositivo.papel || 'ambos',
      ultimoSeq: this.ultimoSeqConhecido || 0
    });
  }

  agendarReconexao() {
    if (this.timerReconexao) clearTimeout(this.timerReconexao);
    const atraso = Math.min(3000, 400 * Math.pow(1.4, this.tentativasReconexao));
    this.tentativasReconexao++;
    this.timerReconexao = setTimeout(() => {
      this.conectar();
    }, atraso);
  }

  iniciarPing() {
    this.pararPing();
    this.timerPing = setInterval(() => {
      if (this.estaConectado()) {
        this.enviar({
          tipo: 'ping',
          latencia: this.latenciaMs,
          offsetRelogio: this.offsetRelogioMs
        });

        if (this.timerTimeoutPong) clearTimeout(this.timerTimeoutPong);
        this.timerTimeoutPong = setTimeout(() => {
          console.warn('[WS] 8 segundos sem resposta de pong. Reiniciando conexão...');
          this.reconectarImediatamente();
        }, 8000);
      }
    }, 5000);
  }

  pararPing() {
    if (this.timerPing) {
      clearInterval(this.timerPing);
      this.timerPing = null;
    }
    if (this.timerTimeoutPong) {
      clearTimeout(this.timerTimeoutPong);
      this.timerTimeoutPong = null;
    }
  }

  sincronizarRelogio() {
    const amostras = [];
    let rodada = 0;

    const executarRodada = () => {
      if (rodada >= 5) {
        amostras.sort((a, b) => a.rtt - b.rtt);
        const melhorAmostra = amostras[0];
        if (melhorAmostra) {
          this.offsetRelogioMs = melhorAmostra.offset;
          this.latenciaMs = Math.round(melhorAmostra.rtt / 2);
        }
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

      if (this.ws) {
        this.ws.addEventListener('message', handler);
        this.enviar({ tipo: 'sync_ping', tCliente1, rodada });
      }
    };

    executarRodada();
  }

  processarMensagemServidor(msg) {
    if (msg.tipo === 'autenticado') {
      if (msg.sucesso) {
        this.pararFallbackPolling();
        this.momentoQueda = null;
        this.ultimoTimestampAtualizacao = Date.now();
        this.atualizarStatus('conectado');
        this.sincronizarRelogio();
        this.iniciarPing();

        if (msg.sessao?.seq) {
          this.ultimoSeqConhecido = Math.max(this.ultimoSeqConhecido, msg.sessao.seq);
        }

        if (msg.estado) this.onEstado(msg.estado, msg.sessao);

        if (Array.isArray(msg.eventosFaltantes) && msg.eventosFaltantes.length > 0) {
          for (const ev of msg.eventosFaltantes) {
            if (ev.seq > this.ultimoSeqConhecido) this.ultimoSeqConhecido = ev.seq;
            this.onNovoEvento(ev, msg.estado, []);
          }
        }

        this.descarregarFilaOffline();
      } else {
        console.warn('[AUTH] Falha na autenticação:', msg.mensagem);
        this.atualizarStatus('offline');
        this.onStatusConexao('auth_invalida', msg.mensagem);
      }
      return;
    }

    if (msg.tipo === 'pinAtualizado') {
      if (msg.novoPin) {
        this.pin = String(msg.novoPin).trim();
        try {
          localStorage.setItem(STORAGE_KEY_PIN, this.pin);
        } catch (e) {}
        console.log('[CONEXAO] PIN atualizado pelo servidor para:', this.pin);
      }
      return;
    }

    if (msg.tipo === 'pong') {
      if (this.timerTimeoutPong) {
        clearTimeout(this.timerTimeoutPong);
        this.timerTimeoutPong = null;
      }
      return;
    }

    if (msg.tipo === 'area_atualizada') {
      this.dispositivo.area = String(msg.area);
      try {
        localStorage.setItem(STORAGE_KEY_DISP, JSON.stringify(this.dispositivo));
      } catch (e) {}
      this.onAreaAtualizada(this.dispositivo.area);
      return;
    }

    if (msg.tipo === 'novo_evento') {
      this.ultimoTimestampAtualizacao = Date.now();
      if (msg.evento?.seq) {
        this.ultimoSeqConhecido = Math.max(this.ultimoSeqConhecido, msg.evento.seq);
      }
      this.onNovoEvento(msg.evento, msg.estado, msg.diff);
      return;
    }

    if (msg.tipo === 'sessao_iniciada') {
      this.ultimoTimestampAtualizacao = Date.now();
      this.ultimoSeqConhecido = msg.evento?.seq || 1;
      this.onSessaoIniciada(msg.sessao, msg.estado, msg.evento);
      return;
    }

    if (msg.tipo === 'sessao_encerrada') {
      this.ultimoTimestampAtualizacao = Date.now();
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

  enviarComando(comando) {
    const clientEventId = comando.clientEventId || `ev_${this.dispositivo.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const cmdCompleto = {
      tipo: 'comando',
      ...comando,
      fila: Number(comando.fila || this.dispositivo.area || 1),
      clientEventId,
      tCliente: Date.now()
    };

    if (this.estaConectado()) {
      this.enviar(cmdCompleto);
    } else {
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
