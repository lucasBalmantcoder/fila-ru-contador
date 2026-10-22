/**
 * public/animacao.js
 * Renderizador de animação fiel da fila em SVG com transições CSS.
 * Layout adaptável (paisagem/horizontal e retrato/vertical), acessibilidade visual
 * (cores, formas, números), escalonamento progressivo e agregação +N para filas longas.
 */

export class AnimadorFila {
  constructor(containerId, opcoes = {}) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.duracaoChegada = opcoes.duracaoChegada || 0.8;
    this.duracaoAtendimento = opcoes.duracaoAtendimento || 0.6;
    this.habilitada = true;

    this.estadoAtual = null;
    this.abaEmSegundoPlano = false;
    this.timerPulsoCatraca = null;

    this.svg = null;
    this.camadaEstacoes = null;
    this.camadaPessoas = null;
    this.camadaIndicador = null;

    this.iniciar();
  }

  iniciar() {
    if (!this.container) return;
    this.container.innerHTML = '';

    // Criação do elemento SVG raiz
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'fila-svg');
    this.svg.setAttribute('viewBox', '0 0 800 200');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    this.camadaEstacoes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaPessoas = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaIndicador = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    this.svg.appendChild(this.camadaEstacoes);
    this.svg.appendChild(this.camadaPessoas);
    this.svg.appendChild(this.camadaIndicador);
    this.container.appendChild(this.svg);

    this.desenharEstacoes();

    // Tratamento de aba em segundo plano
    document.addEventListener('visibilitychange', () => {
      this.abaEmSegundoPlano = document.hidden;
      if (!this.abaEmSegundoPlano && this.estadoAtual) {
        // Ao voltar do segundo plano, aplica o estado atual diretamente sem fila de transições
        this.renderizarEstado(this.estadoAtual, false);
      }
    });

    // Monitoramento de pulso da catraca (> 10s sem confirmação)
    this.timerPulsoCatraca = setInterval(() => {
      this.verificarPulsoCatraca();
    }, 1000);
  }

  desenharEstacoes() {
    this.camadaEstacoes.innerHTML = '';
    const isRetrato = this.container.clientHeight > this.container.clientWidth;

    if (isRetrato) {
      this.svg.setAttribute('viewBox', '0 0 320 600');

      // Caixa Atendimento (Topo)
      this.desenharCaixa(90, 20, 140, 55, 'Atendimento', '🍽️');
      // Caixa Catraca
      this.desenharCaixa(90, 100, 140, 55, 'Catraca', '🛑');
      // Origem das chegadas (Base)
      this.desenharCaixa(90, 520, 140, 45, 'Origem', '🚪');
    } else {
      this.svg.setAttribute('viewBox', '0 0 850 200');

      // Caixa Atendimento (Esquerda)
      this.desenharCaixa(20, 40, 110, 80, 'Atendimento', '🍽️');
      // Caixa Catraca (Ao lado)
      this.desenharCaixa(155, 40, 110, 80, 'Catraca', '🛑');
      // Origem das chegadas (Abaixo e à direita)
      this.desenharCaixa(700, 135, 120, 45, 'Origem', '🚪');
    }
  }

  desenharCaixa(x, y, w, h, label, icone) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('class', 'box-estacao');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x + w / 2);
    text.setAttribute('y', y + h / 2 + 5);
    text.setAttribute('class', 'box-estacao-label');
    text.textContent = `${icone} ${label}`;

    this.camadaEstacoes.appendChild(rect);
    this.camadaEstacoes.appendChild(text);
  }

  obterPosicaoSlot(indice, totalVisiveis, isRetrato) {
    if (isRetrato) {
      // Retrato: vertical de cima para baixo
      if (indice === 0) {
        // Catraca
        return { x: 160, y: 127 };
      }
      // Fila abaixo da catraca
      const yBase = 185;
      const espacamento = Math.min(32, 320 / Math.max(1, totalVisiveis));
      return { x: 160, y: yBase + (indice - 1) * espacamento };
    } else {
      // Paisagem: horizontal da esquerda para a direita
      if (indice === 0) {
        // Catraca
        return { x: 210, y: 80 };
      }
      // Fila à direita da catraca
      const xBase = 295;
      const espacamento = Math.min(42, 480 / Math.max(1, totalVisiveis));
      return { x: xBase + (indice - 1) * espacamento, y: 80 };
    }
  }

  obterPosicaoOrigem(isRetrato) {
    return isRetrato ? { x: 160, y: 542 } : { x: 760, y: 157 };
  }

  obterPosicaoAtendimento(isRetrato) {
    return isRetrato ? { x: 160, y: 47 } : { x: 75, y: 80 };
  }

  /**
   * Renderiza o estado completo da fila.
   * @param {Object} estado - Estado derivado de derivarEstado.
   * @param {boolean} [animar=true] - Se deve aplicar transição suave ou atualizar direto.
   */
  renderizarEstado(estado, animar = true) {
    if (!this.habilitada || !this.svg || !estado) return;
    this.estadoAtual = estado;

    const fila = estado.fila || [];
    const isRetrato = this.container.clientHeight > this.container.clientWidth;
    const maxVisiveis = 25;
    const visiveis = fila.slice(0, maxVisiveis);
    const excedente = fila.length - visiveis.length;

    // Se a aba estiver em segundo plano, não anima
    if (this.abaEmSegundoPlano) animar = false;

    // Escalonamento progressivo para filas longas
    let raio = 18;
    if (visiveis.length > 15) raio = 15;
    if (visiveis.length > 20) raio = 13;

    // Mapeamento dos nós já existentes no SVG
    const nosExistentes = new Map();
    for (const no of Array.from(this.camadaPessoas.children)) {
      const pId = parseInt(no.getAttribute('data-pessoa'), 10);
      if (pId) nosExistentes.set(pId, no);
    }

    const idsAtuais = new Set(visiveis);

    // 1. Remove nós que não estão mais visíveis na fila
    for (const [pId, no] of nosExistentes.entries()) {
      if (!idsAtuais.has(pId)) {
        if (animar) {
          no.style.opacity = '0';
          setTimeout(() => no.remove(), 400);
        } else {
          no.remove();
        }
      }
    }

    // 2. Atualiza ou cria elementos para as pessoas visíveis
    for (let i = 0; i < visiveis.length; i++) {
      const pId = visiveis[i];
      const pos = this.obterPosicaoSlot(i, visiveis.length, isRetrato);
      let g = nosExistentes.get(pId);

      const ehCatraca = (i === 0);

      if (!g) {
        // Nova pessoa entrando na visualização
        g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'pessoa-item');
        g.setAttribute('data-pessoa', pId);

        const posOrigem = this.obterPosicaoOrigem(isRetrato);
        g.setAttribute('transform', `translate(${posOrigem.x}, ${posOrigem.y})`);

        const circulo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circulo.setAttribute('r', raio);
        circulo.setAttribute('class', 'pessoa-circulo origem');

        const texto = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        texto.setAttribute('class', 'pessoa-numero');
        texto.textContent = pId;

        g.appendChild(circulo);
        g.appendChild(texto);
        this.camadaPessoas.appendChild(g);

        // Força reflow antes da animação de deslizamento
        void g.getBoundingClientRect();
      }

      // Atualiza raio e classes do círculo
      const circulo = g.querySelector('circle');
      if (circulo) {
        circulo.setAttribute('r', raio);
        if (ehCatraca) {
          circulo.setAttribute('class', 'pessoa-circulo catraca');
        } else {
          circulo.setAttribute('class', 'pessoa-circulo fila');
        }
      }

      // Aplica posição final
      if (animar) {
        g.style.transition = `transform ${this.duracaoChegada}s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s ease`;
      } else {
        g.style.transition = 'none';
      }

      g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      g.style.opacity = '1';
    }

    // 3. Indicador de Excedente (+N)
    this.camadaIndicador.innerHTML = '';
    if (excedente > 0) {
      const ultPos = this.obterPosicaoSlot(visiveis.length - 1, visiveis.length, isRetrato);
      const posIndicador = isRetrato
        ? { x: ultPos.x, y: ultPos.y + 35 }
        : { x: ultPos.x + 45, y: ultPos.y };

      const gInd = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gInd.setAttribute('transform', `translate(${posIndicador.x}, ${posIndicador.y})`);

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', -24);
      rect.setAttribute('y', -14);
      rect.setAttribute('width', 48);
      rect.setAttribute('height', 28);
      rect.setAttribute('rx', 14);
      rect.setAttribute('fill', 'var(--primary)');

      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('class', 'pessoa-numero');
      txt.textContent = `+${excedente}`;

      gInd.appendChild(rect);
      gInd.appendChild(txt);
      this.camadaIndicador.appendChild(gInd);
    }
  }

  /**
   * Aplica operações atômicas recebidas pelo diff de estados.
   * Se houver rajada (> 5 operações), atualiza diretamente para não engasgar a animação.
   */
  aplicarOperacoes(diff = [], estadoNovo) {
    if (!this.habilitada) return;

    if (diff.length > 5 || this.abaEmSegundoPlano) {
      this.renderizarEstado(estadoNovo, false);
      return;
    }

    const isRetrato = this.container.clientHeight > this.container.clientWidth;

    for (const op of diff) {
      if (op.op === 'confirmar') {
        const no = this.camadaPessoas.querySelector(`[data-pessoa="${op.pessoa}"]`);
        if (no) {
          const posAtend = this.obterPosicaoAtendimento(isRetrato);
          no.style.transition = `transform ${this.duracaoAtendimento}s cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${this.duracaoAtendimento}s ease`;
          no.setAttribute('transform', `translate(${posAtend.x}, ${posAtend.y})`);
          no.style.opacity = '0';
          setTimeout(() => no.remove(), this.duracaoAtendimento * 1000);
        }
      } else if (op.op === 'anular') {
        const no = this.camadaPessoas.querySelector(`[data-pessoa="${op.pessoa}"]`);
        if (no) {
          no.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
          no.style.transform += ' scale(0.2)';
          no.style.opacity = '0';
          setTimeout(() => no.remove(), 400);
        }
      }
    }

    // Sincroniza a posição da fila restante
    setTimeout(() => {
      this.renderizarEstado(estadoNovo, true);
    }, 150);
  }

  verificarPulsoCatraca() {
    if (!this.estadoAtual || !this.estadoAtual.primeiraDaFila) return;
    const primeiraPessoa = this.estadoAtual.primeiraDaFila;
    const no = this.camadaPessoas.querySelector(`[data-pessoa="${primeiraPessoa}"] circle`);

    if (no) {
      const espera = this.estadoAtual.esperaNaCatracaMs || 0;
      if (espera >= 10000) {
        no.classList.add('pulse');
      } else {
        no.classList.remove('pulse');
      }
    }
  }

  destruir() {
    if (this.timerPulsoCatraca) {
      clearInterval(this.timerPulsoCatraca);
      this.timerPulsoCatraca = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

