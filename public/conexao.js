/**
 * public/conexao.js
 * Gerenciador de conexão WebSocket, reconexão automática com backoff exponencial,
 * isolamento de identificadores por aba e papel (sessionStorage),
 * mitigação de conflitos de sessão, sincronização de relógio,
 * batimento (ping) a cada 5s com detecção de queda e fila de saída persistente.
 */

const STORAGE_KEY_OFFLINE = 'ru_fila_offline_queue_v2';
const STORAGE_KEY_PIN = 'ru_fila_pin_salvo';
const STORAGE_KEY_DISP_LEGADO = 'ru_fila_disp_info_v2';

export class GerenciadorConexao {
  constructor(opcoes = {}) {
    this.ws = null;
    this.pin = (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_PIN) : null) || '1234';

    // Determina o papel do cliente: 'painel' ou 'celular'
    this.papel = opcoes.papel === 'painel' ? 'painel' : 'celular';
    const chaveConfig = `ru_fila_config_${this.papel}`;
    const chaveIdSession = `ru_fila_disp_id_${this.papel}`;

    // 1. Carrega configurações salvas (nome, área, etc.), com migração retrocompatível
    let dadosSalvos = null;
    try {
      if (typeof localStorage !== 'undefined') {
        const rawConfig = localStorage.getItem(chaveConfig);
        if (rawConfig) {
          dadosSalvos = JSON.parse(rawConfig);
        } else {
          // Migração do formato legado ru_fila_disp_info_v2
          const rawLegado = localStorage.getItem(STORAGE_KEY_DISP_LEGADO);
          if (rawLegado) {
            const objLegado = JSON.parse(rawLegado);
            if (this.papel === 'painel' && (objLegado.papel === 'painel' || objLegado.nome?.includes('Painel'))) {
              dadosSalvos = objLegado;
            } else if (this.papel === 'celular' && objLegado.papel !== 'painel') {
              dadosSalvos = objLegado;
            }
          }
        }
      }
    } catch (e) {}

    // 2. Garante identificador único de aparelho em sessionStorage (por aba e papel)
    let dispId = null;
    try {
      if (typeof sessionStorage !== 'undefined') {
        dispId = sessionStorage.getItem(chaveIdSession);
      }
    } catch (e) {}

    if (!dispId) {
      const prefixo = this.papel === 'painel' ? 'painel' : 'cel';
      dispId = `${prefixo}_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(chaveIdSession, dispId);
        }
      } catch (e) {}
    }

    // 3. Remove identificadores do localStorage legado para evitar colisão entre abas ou aparelhos
    try {
      if (typeof localStorage !== 'undefined') {
        const rawLegado = localStorage.getItem(STORAGE_KEY_DISP_LEGADO);
        if (rawLegado) {
          const objLegado = JSON.parse(rawLegado);
          if (objLegado && objLegado.id) {
            delete objLegado.id;
            localStorage.setItem(STORAGE_KEY_DISP_LEGADO, JSON.stringify(objLegado));
          }
        }
      }
    } catch (e) {}

    this.dispositivo = {
      id: dispId,
      nome: dadosSalvos?.nome || (this.papel === 'painel' ? 'Painel Notebook' : 'Celular'),
      papel: opcoes.papel || (this.papel === 'painel' ? 'painel' : 'ambos'),
      area: dadosSalvos?.area || (this.papel === 'painel' ? 'todas' : '1')
    };

    this.substituido = false;
    this.ultimoSeqConhecido = 0;
    this.estadoConexao = 'offline'; // 'conectado' | 'reconectando' | 'polling' | 'offline' | 'substituido'
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
          if (!this.estaConectado() && !this.substituido) {
            this.reconectarImediatamente();
          }
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', () => {
        if (!this.estaConectado() && !this.substituido) {
          console.log('[CONEXAO] pageshow detectado. Reconectando...');
          this.reconectarImediatamente();
        }
      });

      window.addEventListener('focus', () => {
        if (!this.estaConectado() && !this.substituido) {
          this.reconectarImediatamente();
        }
      });

      window.addEventListener('online', () => {
        console.log('[CONEXAO] Rede restabelecida (online).');
        if (!this.substituido) {
          this.reconectarImediatamente();
        }
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
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_PIN, this.pin);
        const configSalvar = {
          nome: this.dispositivo.nome,
          area: this.dispositivo.area,
          papel: this.dispositivo.papel
        };
        localStorage.setItem(`ru_fila_config_${this.papel}`, JSON.stringify(configSalvar));
        localStorage.setItem(STORAGE_KEY_DISP_LEGADO, JSON.stringify(configSalvar));
      }
    } catch (e) {}
  }

  mudarArea(novaArea) {
    this.dispositivo.area = String(novaArea);
    try {
      if (typeof localStorage !== 'undefined') {
        const configSalvar = {
          nome: this.dispositivo.nome,
          area: this.dispositivo.area,
          papel: this.dispositivo.papel
        };
        localStorage.setItem(`ru_fila_config_${this.papel}`, JSON.stringify(configSalvar));
        localStorage.setItem(STORAGE_KEY_DISP_LEGADO, JSON.stringify(configSalvar));
      }
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
    if (this.substituido) {
      console.warn('[WS] Conexão cancelada: o identificador deste aparelho foi substituído por outra conexão ativa.');
      return;
    }

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

    this.ws.onclose = (event) => {
      this.pararPing();

      // Código 4001 ou motivo "substituído" indica fechamento proposital pelo servidor
      const foiSubstituido = (event && (event.code === 4001 || event.reason === 'substituído' || event.reason === 'substituido'));
      if (foiSubstituido) {
        console.warn(`[WS] Conexão encerrada pelo servidor: aparelho substituído por outra aba ou conexão ativa (código ${event.code}). Reconexão desativada.`);
        this.substituido = true;
        this.pararFallbackPolling();
        this.atualizarStatus('substituido');
        this.onStatusConexao('substituido', 0);
        return;
      }

      console.warn('[WS] Conexão encerrada pelo servidor ou suspensa pelo aparelho.');
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
    if (this.substituido) return;

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
        if (decorrido >= 5000 && !this.timerFallbackPolling && !this.substituido) {
          console.warn('[CONEXAO] Mais de 5s desconectado. Iniciando fallback por consulta HTTP (GET /api/estado)...');
          this.iniciarFallbackPolling();
        }
      }, 1000);
    }
  }

  iniciarFallbackPolling() {
    if (this.substituido) return;
    this.pararFallbackPolling();
    this.atualizarStatus('polling');

    const executarPoll = async () => {
      if (this.estaConectado() || this.substituido) {
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

  desconectar() {
    this.substituido = false;
    this.pararPing();
    this.pararFallbackPolling();
    if (this.timerReconexao) {
      clearTimeout(this.timerReconexao);
      this.timerReconexao = null;
    }
    if (this.timerChecagemQueda) {
      clearInterval(this.timerChecagemQueda);
      this.timerChecagemQueda = null;
    }
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.atualizarStatus('offline');
  }

  fechar() {
    this.desconectar();
  }

  reconectarImediatamente() {
    this.substituido = false;
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
    if (this.substituido) return;
    if (this.timerReconexao) clearTimeout(this.timerReconexao);

    // Backoff exponencial com limite: 1s, 2s, 4s, 8s até no máximo 10s
    const atraso = Math.min(10000, 1000 * Math.pow(2, this.tentativasReconexao));
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
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY_PIN, this.pin);
          }
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
        if (typeof localStorage !== 'undefined') {
          const configSalvar = {
            nome: this.dispositivo.nome,
            area: this.dispositivo.area,
            papel: this.dispositivo.papel
          };
          localStorage.setItem(`ru_fila_config_${this.papel}`, JSON.stringify(configSalvar));
          localStorage.setItem(STORAGE_KEY_DISP_LEGADO, JSON.stringify(configSalvar));
        }
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
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(STORAGE_KEY_OFFLINE);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  salvarFilaOffline(fila) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_OFFLINE, JSON.stringify(fila));
      }
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
