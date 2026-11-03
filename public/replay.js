/**
 * public/replay.js
 * Controlador puro de reprodução do histórico (sem dependência do DOM).
 * Permite reproduzir, pausar, reiniciar, alterar velocidade (1x, 5x, 10x, 60x),
 * realizar saltos no tempo, arrastar a barra de tempo e detectar o fim da sessão.
 */

import { derivarEstado } from '../shared/estado.js';

export class ControladorReplay {
  constructor(opcoes = {}) {
    this.eventos = [];
    this.configSessao = {};
    this.tInicio = 0;
    this.tFim = 0;
    this.duracaoTotalMs = 0;
    this.tAtual = 0;

    this.tocando = false;
    this.velocidade = opcoes.velocidadeInicial || 5; // 1, 5, 10 ou 60
    this.timer = null;
    this.intervaloMs = 100; // resolução do tick em milissegundos

    this.arrastando = false;
    this.tocavaAntesDoArrasto = false;

    // Callbacks
    this.onTick = opcoes.onTick || (() => {});
    this.onFim = opcoes.onFim || (() => {});
    this.onStatusChange = opcoes.onStatusChange || (() => {});
  }

  /**
   * Inicializa o player com a lista ordenada de eventos da sessão.
   * @param {Array<Object>} eventos - Eventos da sessão.
   * @param {Object} [configSessao={}] - Metadados/config da sessão.
   */
  carregar(eventos = [], configSessao = {}) {
    this.pausar();
    this.eventos = Array.isArray(eventos) ? [...eventos] : [];
    this.configSessao = configSessao || {};

    if (this.eventos.length === 0) {
      this.tInicio = 0;
      this.tFim = 0;
      this.duracaoTotalMs = 0;
      this.tAtual = 0;
      return;
    }

    this.tInicio = this.eventos[0].t;
    this.tFim = this.eventos[this.eventos.length - 1].t;
    this.duracaoTotalMs = Math.max(1000, this.tFim - this.tInicio);
    this.tAtual = this.tInicio;

    this.notificarTick();
  }

  /**
   * Inicia a reprodução.
   */
  reproduzir() {
    if (this.eventos.length === 0) return;
    if (this.tocando) return;

    // Se estiver no final da timeline, reinicia antes de tocar
    if (this.tAtual >= this.tFim) {
      this.tAtual = this.tInicio;
    }

    this.tocando = true;
    this.onStatusChange(this.tocando, this.velocidade);

    this.timer = setInterval(() => {
      this.tick();
    }, this.intervaloMs);
  }

  /**
   * Pausa a reprodução.
   */
  pausar() {
    if (!this.tocando && !this.timer) return;
    this.tocando = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onStatusChange(this.tocando, this.velocidade);
  }

  /**
   * Alterna entre reproduzir e pausar.
   */
  alternar() {
    if (this.tocando) {
      this.pausar();
    } else {
      this.reproduzir();
    }
  }

  /**
   * Reinicia a reprodução voltando ao instante 00:00 e pausando.
   */
  reiniciar() {
    this.pausar();
    this.tAtual = this.tInicio;
    this.notificarTick();
  }

  /**
   * Altera a velocidade de reprodução (sem causar saltos no timestamp atual).
   * @param {number} v - 1, 5, 10 ou 60.
   */
  definirVelocidade(v) {
    const velNum = Number(v);
    if (![1, 5, 10, 60].includes(velNum)) return;
    this.velocidade = velNum;
    this.onStatusChange(this.tocando, this.velocidade);
  }

  /**
   * Salta diretamente para um timestamp t específico.
   * @param {number} t - Timestamp epoch ms.
   */
  saltarPara(t) {
    if (this.duracaoTotalMs === 0) return;
    this.tAtual = Math.max(this.tInicio, Math.min(this.tFim, t));
    this.notificarTick();

    if (this.tAtual >= this.tFim) {
      this.pausar();
      this.onFim();
    }
  }

  /**
   * Avança ou retrocede tempo em milissegundos.
   * @param {number} ms - Ex: +5000 para +5s, -5000 para -5s.
   */
  avancar(ms) {
    this.saltarPara(this.tAtual + ms);
  }

  /**
   * Define o instante a partir de uma fração da timeline (0.0 a 1.0).
   * @param {number} fracao - De 0 a 1.
   */
  definirProgresso(fracao) {
    const f = Math.max(0, Math.min(1, fracao));
    const t = this.tInicio + f * this.duracaoTotalMs;
    this.saltarPara(t);
  }

  /**
   * Obtém a fração atual de progresso (0.0 a 1.0).
   * @returns {number}
   */
  obterProgresso() {
    if (this.duracaoTotalMs === 0) return 0;
    return Math.max(0, Math.min(1, (this.tAtual - this.tInicio) / this.duracaoTotalMs));
  }

  /**
   * Inicia arraste na barra de tempo (pausa temporariamente sem esquecer o estado anterior).
   */
  iniciarArrasto() {
    this.arrastando = true;
    this.tocavaAntesDoArrasto = this.tocando;
    this.pausar();
  }

  /**
   * Atualiza a posição durante o arraste na barra de tempo.
   * @param {number} fracao - De 0 a 1.
   */
  arrastarPara(fracao) {
    if (!this.arrastando) return;
    const f = Math.max(0, Math.min(1, fracao));
    this.tAtual = this.tInicio + f * this.duracaoTotalMs;
    this.notificarTick();
  }

  /**
   * Finaliza o arraste na barra de tempo e retoma a reprodução se estava tocando.
   * @param {number} [fracaoFinal] - Opcional, última fração solta.
   */
  finalizarArrasto(fracaoFinal) {
    if (fracaoFinal !== undefined) {
      this.definirProgresso(fracaoFinal);
    }
    this.arrastando = false;
    if (this.tocavaAntesDoArrasto && this.tAtual < this.tFim) {
      this.reproduzir();
    }
    this.tocavaAntesDoArrasto = false;
  }

  /**
   * Passo discreto de tempo executado pelo timer.
   */
  tick() {
    if (!this.tocando) return;

    // Avanço proporcional à velocidade selecionada
    const avanco = this.intervaloMs * this.velocidade;
    this.tAtual += avanco;

    if (this.tAtual >= this.tFim) {
      this.tAtual = this.tFim;
      this.notificarTick();
      this.pausar();
      this.onFim();
      return;
    }

    this.notificarTick();
  }

  /**
   * Dispara o callback onTick com estado derivado no instante tAtual.
   */
  notificarTick() {
    const estado = derivarEstado(this.eventos, this.tAtual, this.configSessao);
    const progresso = this.obterProgresso();
    this.onTick(this.tAtual, progresso, estado);
  }

  /**
   * Destrói timers e libera recursos.
   */
  destruir() {
    this.pausar();
    this.eventos = [];
  }
}

