/**
 * public/animacao.js
 * Renderizador de animação fiel da fila em SVG, seguindo rigorosamente o esboço visual
 * do Restaurante Universitário com viewBox="0 0 960 660".
 * Suporta as três filas (Fila 1 vermelho, Fila 2 verde, Fila 3 rosa), cabeças com cores
 * do estágio seguinte (verde, rosa, laranja), caixas com contadores, pulso > 10s,
 * setas direcionais, agrupamento +N e indicação de filas desativadas / sem coleta.
 */

export class AnimadorFila {
  constructor(containerId, opcoes = {}) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.habilitada = true;
    this.destaqueFila = opcoes.destaqueFila || null; // 1, 2, 3 ou null (todas)

    this.estadoAtual = null;
    this.abaEmSegundoPlano = false;
    this.timerPulso = null;

    this.svg = null;
    this.camadaFundo = null;
    this.camadaRotulos = null;
    this.camadaCaixas = null;
    this.camadaSetas = null;
    this.camadaPessoas = null;
    this.camadaBadges = null;

    this.iniciar();
  }

  iniciar() {
    if (!this.container) return;
    this.container.innerHTML = '';

    // Elemento SVG com layout fixo viewBox 0 0 960 660 conforme o esboço
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'fila-svg');
    this.svg.setAttribute('viewBox', '0 0 960 660');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svg.style.width = '100%';
    this.svg.style.height = 'auto';
    this.svg.style.maxHeight = '80vh';
    this.svg.style.display = 'block';

    // Definição de marcadores para as setas pretas
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <marker id="seta-preta" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#1e293b" />
      </marker>
      <style>
        @keyframes pulsoCabeca {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.8; }
        }
        .pulso-ativo {
          animation: pulsoCabeca 1s infinite ease-in-out;
          transform-origin: center;
        }
      </style>
    `;
    this.svg.appendChild(defs);

    this.camadaFundo = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaSetas = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaCaixas = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaRotulos = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaPessoas = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaBadges = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    this.svg.appendChild(this.camadaFundo);
    this.svg.appendChild(this.camadaSetas);
    this.svg.appendChild(this.camadaCaixas);
    this.svg.appendChild(this.camadaRotulos);
    this.svg.appendChild(this.camadaPessoas);
    this.svg.appendChild(this.camadaBadges);

    this.container.appendChild(this.svg);

    this.desenharEstruturaEstatica();

    // Tratamento de visibilidade de aba
    document.addEventListener('visibilitychange', () => {
      this.abaEmSegundoPlano = document.hidden;
      if (!this.abaEmSegundoPlano && this.estadoAtual) {
        this.renderizarEstado(this.estadoAtual);
      }
    });

    // Pulso para cabeças de fila esperando > 10s
    this.timerPulso = setInterval(() => {
      this.verificarPulsos();
    }, 1000);
  }

  desenharEstruturaEstatica() {
    this.camadaCaixas.innerHTML = '';
    this.camadaSetas.innerHTML = '';
    this.camadaRotulos.innerHTML = '';

    // 1. Caixas físicas do RU conforme coordenadas exatas do esboço
    // catraca: (527,173)–(622,258)
    this.criarCaixa('catraca', 527, 173, 95, 85, 'catraca');
    // Atendimento: (390,221)–(465,363)
    this.criarCaixa('atendimento', 390, 221, 75, 142, ['Atendi', 'mento']);
    // Mesas: (123,172)–(222,258)
    this.criarCaixa('mesas', 123, 172, 99, 86, 'Mesas');
    // Saída: (123,462)–(222,548)
    this.criarCaixa('saida', 123, 462, 99, 86, 'Saída');

    // 2. Setas pretas de sentido idênticas à imagem anexa
    // Fila 1: seta descendo à direita do trecho vertical
    this.criarSeta(820, 70, 820, 180);
    // Fila 1: seta indo para esquerda abaixo do trecho horizontal
    this.criarSeta(770, 270, 650, 270);

    // Fila 2: seta descendo à direita de Atendimento
    this.criarSeta(545, 250, 545, 360);
    // Fila 2: seta indo para esquerda abaixo de Atendimento
    this.criarSeta(490, 420, 370, 420);
    // Fila 2: seta subindo à esquerda de Atendimento
    this.criarSeta(305, 360, 305, 240);
    // Fila 2: seta indo para esquerda acima do trecho superior de Atendimento
    this.criarSeta(350, 165, 240, 165);

    // Fila 3: seta descendo à esquerda de Fila 3
    this.criarSeta(85, 300, 85, 410);

    // 3. Rótulos das Filas posicionados conforme o desenho
    this.criarRotuloTexto('rotulo_f1', 700, 185, 'Fila 1');
    this.criarRotuloTexto('rotulo_f2', 427, 185, 'Fila 2');
    this.criarRotuloTexto('rotulo_f3', 135, 350, 'Fila 3');
  }

  criarCaixa(id, x, y, w, h, texto) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', `caixa_${id}`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('fill', '#ffffff');
    rect.setAttribute('stroke', '#000000');
    rect.setAttribute('stroke-width', '2.5');
    g.appendChild(rect);

    if (Array.isArray(texto)) {
      const t1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t1.setAttribute('x', x + w / 2);
      t1.setAttribute('y', y + h / 2 - 4);
      t1.setAttribute('text-anchor', 'middle');
      t1.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      t1.setAttribute('font-size', '16');
      t1.setAttribute('font-weight', '500');
      t1.setAttribute('fill', '#000000');
      t1.textContent = texto[0];

      const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t2.setAttribute('x', x + w / 2);
      t2.setAttribute('y', y + h / 2 + 18);
      t2.setAttribute('text-anchor', 'middle');
      t2.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      t2.setAttribute('font-size', '16');
      t2.setAttribute('font-weight', '500');
      t2.setAttribute('fill', '#000000');
      t2.textContent = texto[1];

      g.appendChild(t1);
      g.appendChild(t2);
    } else {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + w / 2);
      text.setAttribute('y', y + h / 2 + 6);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
      text.setAttribute('font-size', '16');
      text.setAttribute('font-weight', '500');
      text.setAttribute('fill', '#000000');
      text.textContent = texto;
      g.appendChild(text);
    }

    // Contador numérico de atendimentos/passagens
    const cont = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    cont.setAttribute('id', `contador_caixa_${id}`);
    cont.setAttribute('x', x + w / 2);
    cont.setAttribute('y', y + h - 8);
    cont.setAttribute('text-anchor', 'middle');
    cont.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    cont.setAttribute('font-size', '12');
    cont.setAttribute('font-weight', 'bold');
    cont.setAttribute('fill', '#64748b');
    cont.textContent = '';
    g.appendChild(cont);

    this.camadaCaixas.appendChild(g);
  }

  criarSeta(x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#1e293b');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('marker-end', 'url(#seta-preta)');
    this.camadaSetas.appendChild(line);
  }

  criarRotuloTexto(id, x, y, texto) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('id', id);
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    text.setAttribute('font-size', '15');
    text.setAttribute('font-weight', '500');
    text.setAttribute('fill', '#334155');
    text.textContent = texto;
    this.camadaRotulos.appendChild(text);
  }

  /**
   * Calcula a posição física (x, y, orientação) de um item ao longo do percurso
   * em função de sua distância d a partir da cabeça da fila.
   * Orientação: perpendicular ao segmento (se o caminho for vertical, retângulo é horizontal).
   */
  obterPontoNoCaminho(filaNum, d) {
    if (filaNum === 1) {
      // Fila 1: da cauda (766, 40) descendo até (766, 210), depois virando para a esquerda até (640, 210)
      // Cabeça em (640, 210). Trecho horizontal tem comprimento 126.
      if (d <= 126) {
        return {
          x: 640 + d,
          y: 210,
          w: 10,
          h: 24,
          orientacao: 'horizontal' // trecho horizontal -> retangulo vertical
        };
      }
      const dVert = d - 126;
      return {
        x: 766,
        y: Math.max(30, 210 - dVert),
        w: 24,
        h: 10,
        orientacao: 'vertical' // trecho vertical -> retangulo horizontal
      };
    }

    if (filaNum === 2) {
      // Fila 2: (505, 215) -> (505, 376) -> (350, 376) -> (350, 214) -> (235, 214)
      // Cabeça em (235, 214).
      // Segmento 4: (235, 214) -> (350, 214), comprimento 115
      if (d <= 115) {
        return { x: 235 + d, y: 214, w: 10, h: 24, orientacao: 'horizontal' };
      }
      // Segmento 3: (350, 214) -> (350, 376), comprimento 162
      if (d <= 277) {
        const dSub = d - 115;
        return { x: 350, y: 214 + dSub, w: 24, h: 10, orientacao: 'vertical' };
      }
      // Segmento 2: (350, 376) -> (505, 376), comprimento 155
      if (d <= 432) {
        const dHoriz = d - 277;
        return { x: 350 + dHoriz, y: 376, w: 10, h: 24, orientacao: 'horizontal' };
      }
      // Segmento 1: (505, 376) -> (505, 215), comprimento 161
      const dVert = d - 432;
      return { x: 505, y: Math.max(210, 376 - dVert), w: 24, h: 10, orientacao: 'vertical' };
    }

    if (filaNum === 3) {
      // Fila 3: (176, 268) descendo até (176, 432).
      // Cabeça em (176, 432). Comprimento 164.
      return {
        x: 176,
        y: Math.max(265, 432 - d),
        w: 24,
        h: 10,
        orientacao: 'vertical'
      };
    }

    return { x: 0, y: 0, w: 10, h: 10, orientacao: 'horizontal' };
  }

  obterComprimentoMaximoCaminho(filaNum) {
    if (filaNum === 1) return 296;
    if (filaNum === 2) return 593;
    if (filaNum === 3) return 164;
    return 200;
  }

  /**
   * Renderiza o estado completo das filas.
   * @param {Object} estado - Estado derivado de derivarEstado.
   */
  renderizarEstado(estado) {
    if (!this.habilitada || !this.svg || !estado) return;
    this.estadoAtual = estado;

    this.camadaPessoas.innerHTML = '';
    this.camadaBadges.innerHTML = '';

    const filasAtivas = estado.filasAtivas || [1];

    // Atualiza contadores nas caixas
    const contCatraca = document.getElementById('contador_caixa_catraca');
    if (contCatraca) {
      const totalPassaram = estado.filas?.[1]?.contadores?.atendidas ?? estado.contadores?.atendidas ?? 0;
      contCatraca.textContent = `${totalPassaram} passaram`;
    }

    const contMesas = document.getElementById('contador_caixa_mesas');
    if (contMesas) {
      const totalMesas = estado.filas?.[2]?.contadores?.atendidas ?? 0;
      contMesas.textContent = `${totalMesas} chegaram`;
    }

    const contSaida = document.getElementById('contador_caixa_saida');
    if (contSaida) {
      const totalSaida = estado.filas?.[3]?.contadores?.atendidas ?? 0;
      contSaida.textContent = `${totalSaida} saíram`;
    }

    // Renderiza cada fila (1, 2, 3)
    for (const fNum of [1, 2, 3]) {
      const fObj = estado.filas?.[fNum];
      const ativa = filasAtivas.includes(fNum) && fObj?.ativa !== false;
      const filaArray = fObj?.fila || (fNum === 1 ? estado.fila : []) || [];

      // Atualiza rótulo da fila com estado e quantidade
      const rotuloEl = document.getElementById(`rotulo_f${fNum}`);
      if (rotuloEl) {
        if (!filasAtivas.includes(fNum)) {
          rotuloEl.textContent = `Fila ${fNum} (não coletada)`;
          rotuloEl.setAttribute('fill', '#94a3b8');
        } else if (fObj?.desativadaEm) {
          rotuloEl.textContent = `Fila ${fNum} (desativada)`;
          rotuloEl.setAttribute('fill', '#94a3b8');
        } else if (fObj?.semDados) {
          rotuloEl.textContent = `Fila ${fNum} (sem dados)`;
          rotuloEl.setAttribute('fill', '#d97706');
        } else {
          rotuloEl.textContent = `Fila ${fNum} (${filaArray.length})`;
          rotuloEl.setAttribute('fill', '#334155');
        }
      }

      if (!ativa) {
        // Se a fila não estiver ativa, não desenha pessoas
        continue;
      }

      // Cálculo de espaçamento e agrupamento +N
      const totalPessoas = filaArray.length;
      const compMax = this.obterComprimentoMaximoCaminho(fNum);
      const espacoPadrao = 16;
      let espacamento = espacoPadrao;

      let maxCabem = Math.floor(compMax / espacamento);
      if (totalPessoas > maxCabem) {
        espacamento = Math.max(9, compMax / totalPessoas);
        maxCabem = Math.floor(compMax / espacamento);
      }

      const precisaAgrupar = totalPessoas > maxCabem;
      const qtdRenderizar = precisaAgrupar ? Math.max(1, maxCabem - 1) : totalPessoas;

      for (let i = 0; i < qtdRenderizar; i++) {
        const pNum = filaArray[i];
        const dist = i * espacamento;
        const pt = this.obterPontoNoCaminho(fNum, dist);
        const ehCabeca = (i === 0);

        this.desenharItemPessoa(fNum, pNum, pt, ehCabeca, fObj);
      }

      // Se houver excesso que exceda a capacidade visual, exibe o selo "+N"
      if (precisaAgrupar) {
        const excedente = totalPessoas - qtdRenderizar;
        const distBadge = qtdRenderizar * espacamento;
        const ptBadge = this.obterPontoNoCaminho(fNum, distBadge);
        this.desenharBadgeMaisN(fNum, excedente, ptBadge);
      }
    }
  }

  desenharItemPessoa(filaNum, pessoaNum, pt, ehCabeca, fObj) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'item-pessoa');
    if (ehCabeca) {
      g.setAttribute('id', `cabeca_f${filaNum}`);
      g.dataset.esperaMs = fObj?.esperaNaCabecaMs || 0;
    }

    // Cores fiéis ao esboço:
    // Fila 1: vermelho (#ef4444). Cabeça: verde (#22c55e) na catraca.
    // Fila 2: verde (#22c55e). Cabeça: rosa (#ec4899) junto às mesas.
    // Fila 3: rosa (#ec4899). Cabeça: laranja (#f97316) junto à saída.
    let fillCor = '#ef4444';
    let strokeCor = 'none';
    let strokeW = '0';

    if (filaNum === 1) {
      if (ehCabeca) {
        fillCor = '#22c55e'; // Cabeça na catraca: verde
        strokeCor = '#15803d';
        strokeW = '2';
      } else {
        fillCor = '#ef4444'; // Demais: vermelho
      }
    } else if (filaNum === 2) {
      if (ehCabeca) {
        fillCor = '#ec4899'; // Cabeça junto às mesas: rosa
        strokeCor = '#be185d';
        strokeW = '2';
      } else {
        fillCor = '#22c55e'; // Demais: verde
      }
    } else if (filaNum === 3) {
      if (ehCabeca) {
        fillCor = '#f97316'; // Cabeça junto à saída: laranja
        strokeCor = '#c2410c';
        strokeW = '2';
      } else {
        fillCor = '#ec4899'; // Demais: rosa
      }
    }

    // Se houver destaque de fila ativo (ex: tela do celular), atenua as outras
    if (this.destaqueFila && this.destaqueFila !== filaNum) {
      g.style.opacity = '0.35';
    }

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', pt.x - pt.w / 2);
    rect.setAttribute('y', pt.y - pt.h / 2);
    rect.setAttribute('width', pt.w);
    rect.setAttribute('height', pt.h);
    rect.setAttribute('rx', '1.5');
    rect.setAttribute('fill', fillCor);
    if (strokeCor !== 'none') {
      rect.setAttribute('stroke', strokeCor);
      rect.setAttribute('stroke-width', strokeW);
    }
    g.appendChild(rect);

    // Número da pessoa centralizado
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', pt.x);
    text.setAttribute('y', pt.y + 3);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    text.setAttribute('font-size', '8');
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('fill', '#ffffff');
    text.textContent = String(pessoaNum);
    g.appendChild(text);

    this.camadaPessoas.appendChild(g);
  }

  desenharBadgeMaisN(filaNum, excedente, pt) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const badgeW = 32;
    const badgeH = 16;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', pt.x - badgeW / 2);
    rect.setAttribute('y', pt.y - badgeH / 2);
    rect.setAttribute('width', badgeW);
    rect.setAttribute('height', badgeH);
    rect.setAttribute('rx', '8');
    rect.setAttribute('fill', '#475569');
    g.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', pt.x);
    text.setAttribute('y', pt.y + 4);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    text.setAttribute('font-size', '9');
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('fill', '#ffffff');
    text.textContent = `+${excedente}`;
    g.appendChild(text);

    this.camadaBadges.appendChild(g);
  }

  verificarPulsos() {
    if (!this.estadoAtual || this.abaEmSegundoPlano) return;

    for (const fNum of [1, 2, 3]) {
      const cabecaEl = document.getElementById(`cabeca_f${fNum}`);
      if (cabecaEl) {
        const fo = this.estadoAtual.filas?.[fNum];
        const esperaMs = fo?.esperaNaCabecaMs || 0;
        if (esperaMs >= 10000) {
          cabecaEl.classList.add('pulso-ativo');
        } else {
          cabecaEl.classList.remove('pulso-ativo');
        }
      }
    }
  }

  definirDestaqueFila(fNum) {
    this.destaqueFila = fNum;
    if (this.estadoAtual) {
      this.renderizarEstado(this.estadoAtual);
    }
  }

  destruir() {
    if (this.timerPulso) clearInterval(this.timerPulso);
  }
}
