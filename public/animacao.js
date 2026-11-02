/**
 * public/animacao.js
 * Renderizador visual de animação do percurso do restaurante universitário em SVG.
 * Suporta o layout temático "restaurante" (Origem -> Fila Vermelha -> Catraca -> Atendimento Verde -> Mesas Rosa -> Saída Laranja)
 * e layout em cadeia automático para configurações personalizadas.
 * Acessibilidade com formas geométricas distintas por zona, exibição de ocupação com capacidade,
 * avaliadores atribuídos por ponto, ausência de números em zonas de contagem e agregação +N.
 */

export class AnimadorFila {
  constructor(containerId, opcoes = {}) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.duracaoTransicao = opcoes.duracaoTransicao || 0.6;
    this.habilitada = true;

    this.estadoAtual = null;
    this.configAtual = null;
    this.atribuicoes = {};
    this.aparelhosConectados = new Map(); // id -> aparelho
    this.abaEmSegundoPlano = false;

    this.svg = null;
    this.camadaFundo = null;
    this.camadaEstacoes = null;
    this.camadaConexoes = null;
    this.camadaPontos = null;
    this.camadaPessoas = null;
    this.camadaIndicadores = null;

    this.ultimoRegistroPorPonto = {}; // pontoId -> timestamp
    this.timerAlertasOciosidade = null;
    this.limiarAlertaOciosoSeg = 120;

    this.iniciar();
  }

  iniciar() {
    if (!this.container) return;
    this.container.innerHTML = '';

    // Elemento SVG raiz
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'fila-svg percurso-svg');
    this.svg.setAttribute('viewBox', '0 0 1000 320');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    this.camadaFundo = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaConexoes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaEstacoes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaPontos = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaPessoas = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.camadaIndicadores = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    this.svg.appendChild(this.camadaFundo);
    this.svg.appendChild(this.camadaConexoes);
    this.svg.appendChild(this.camadaEstacoes);
    this.svg.appendChild(this.camadaPontos);
    this.svg.appendChild(this.camadaPessoas);
    this.svg.appendChild(this.camadaIndicadores);
    this.container.appendChild(this.svg);

    document.addEventListener('visibilitychange', () => {
      this.abaEmSegundoPlano = document.hidden;
      if (!this.abaEmSegundoPlano && this.estadoAtual) {
        this.renderizarEstado(this.estadoAtual, false);
      }
    });

    this.timerAlertasOciosidade = setInterval(() => {
      this.verificarAlertasOciosidade();
    }, 1000);
  }

  definirAtribuicoes(atribuicoes = {}, aparelhos = []) {
    this.atribuicoes = atribuicoes || {};
    this.aparelhosConectados.clear();
    for (const a of aparelhos) {
      this.aparelhosConectados.set(a.id, a);
    }
    if (this.estadoAtual) {
      this.desenharEstruturaPercurso();
    }
  }

  ehLayoutRestaurantePadrao(zonas) {
    if (!Array.isArray(zonas) || zonas.length !== 3) return false;
    const ids = zonas.map(z => z.id).join(',');
    const hab = zonas.every(z => z.habilitada !== false);
    return ids === 'z1,z2,z3' && hab;
  }

  desenharEstruturaPercurso() {
    this.camadaEstacoes.innerHTML = '';
    this.camadaConexoes.innerHTML = '';
    this.camadaPontos.innerHTML = '';

    const cfg = this.configAtual || this.estadoAtual?.config;
    const zonas = (cfg?.zonas || []).filter(z => z.habilitada !== false);
    const pontos = cfg?.pontos || [];
    const ehPadrao = this.ehLayoutRestaurantePadrao(zonas);

    if (ehPadrao) {
      this.desenharLayoutRestaurante(zonas, pontos);
    } else {
      this.desenharLayoutCadeia(zonas, pontos);
    }
  }

  desenharLayoutRestaurante(zonas, pontos) {
    this.svg.setAttribute('viewBox', '0 0 1000 320');

    // 1. Origem: Pessoas Novas (À direita)
    this.desenharCaixaEstacao(840, 40, 130, 90, 'Pessoas novas', 'origem', '#8b5cf6', 'origem', null);

    // 2. Z1: Fila Inicial (Vermelho, trilha estendida da direita até a catraca)
    const ocupZ1 = this.estadoAtual?.zonas?.z1?.ocupacao || 0;
    this.desenharCaixaEstacao(510, 40, 290, 90, 'Z1: Fila inicial', 'z1', '#dc2626', 'fifo', ocupZ1, null);

    // P1: Catraca (entre Z1 e Z2)
    this.desenharMarcadorPonto(470, 85, pontos.find(p => p.id === 'z1->z2'), 'P1: Catraca');

    // 3. Z2: Atendimento (Verde, caixa de servir à esquerda da catraca)
    const ocupZ2 = this.estadoAtual?.zonas?.z2?.ocupacao || 0;
    this.desenharCaixaEstacao(240, 40, 190, 90, 'Z2: Atendimento', 'z2', '#16a34a', 'fifo', ocupZ2, null);

    // P2: Saída do Atendimento (entre Z2 e Z3)
    this.desenharMarcadorPonto(200, 85, pontos.find(p => p.id === 'z2->z3'), 'P2: Saída atend.');

    // 4. Z3: Mesas (Rosa, área de refeição)
    const capZ3 = zonas.find(z => z.id === 'z3')?.capacidade || 120;
    const ocupZ3 = this.estadoAtual?.zonas?.z3?.ocupacao || 0;
    this.desenharCaixaEstacao(40, 40, 130, 150, 'Z3: Mesas', 'z3', '#ec4899', 'contagem', ocupZ3, capZ3);

    // P3: Saída das Mesas
    this.desenharMarcadorPonto(105, 220, pontos.find(p => p.id === 'z3->saida'), 'P3: Saída mesas');

    // 5. Saída: Sumidouro (Abaixo das mesas)
    this.desenharCaixaEstacao(40, 250, 130, 50, 'Saída (Sumidouro)', 'saida', '#f97316', 'saida', null);

    // P0: Ponto de Chegada (entre Origem e Z1)
    this.desenharMarcadorPonto(815, 85, pontos.find(p => p.id === 'origem->z1'), 'P0: Chegada');
  }

  desenharLayoutCadeia(zonas, pontos) {
    const totalEstacoes = zonas.length + 2; // Origem + Zonas + Saída
    const larguraView = Math.max(1000, totalEstacoes * 180);
    this.svg.setAttribute('viewBox', `0 0 ${larguraView} 280`);

    const espacamento = (larguraView - 40) / totalEstacoes;

    // Origem
    this.desenharCaixaEstacao(20, 80, 130, 90, 'Origem', 'origem', '#8b5cf6', 'origem', null);

    // Zonas
    for (let i = 0; i < zonas.length; i++) {
      const z = zonas[i];
      const x = 20 + (i + 1) * espacamento;
      const ocup = this.estadoAtual?.zonas?.[z.id]?.ocupacao || 0;
      this.desenharCaixaEstacao(x, 80, Math.min(espacamento - 30, 200), 90, z.nome, z.id, z.cor, z.modo, ocup, z.capacidade);

      // Ponto anterior
      const ptId = (i === 0) ? `origem->${z.id}` : `${zonas[i - 1].id}->${z.id}`;
      const pt = pontos.find(p => p.id === ptId);
      this.desenharMarcadorPonto(x - 15, 125, pt, pt?.nome || `P${i}`);
    }

    // Saída
    const xSaida = 20 + (zonas.length + 1) * espacamento;
    this.desenharCaixaEstacao(xSaida, 80, 130, 90, 'Saída', 'saida', '#f97316', 'saida', null);

    const ultZona = zonas[zonas.length - 1];
    const ptFinal = pontos.find(p => p.id === `${ultZona.id}->saida`);
    this.desenharMarcadorPonto(xSaida - 15, 125, ptFinal, ptFinal?.nome || `P${zonas.length}`);
  }

  desenharCaixaEstacao(x, y, w, h, titulo, zonaId, cor, modo, ocupacao = null, capacidade = null) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `estacao-box estacao-${zonaId}`);
    g.setAttribute('data-zona', zonaId);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('rx', modo === 'contagem' ? 12 : 6);
    rect.setAttribute('fill', 'var(--bg-card)');
    rect.setAttribute('stroke', cor);
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('stroke-dasharray', modo === 'contagem' ? '4 3' : 'none');

    // Título da Estação
    const txtTitulo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txtTitulo.setAttribute('x', x + 10);
    txtTitulo.setAttribute('y', y + 20);
    txtTitulo.setAttribute('fill', cor);
    txtTitulo.setAttribute('font-size', '12px');
    txtTitulo.setAttribute('font-weight', '700');
    txtTitulo.textContent = titulo;

    g.appendChild(rect);
    g.appendChild(txtTitulo);

    // Contador de ocupação e capacidade
    if (ocupacao !== null) {
      const txtOcup = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txtOcup.setAttribute('x', x + w - 10);
      txtOcup.setAttribute('y', y + 20);
      txtOcup.setAttribute('text-anchor', 'end');
      txtOcup.setAttribute('fill', 'var(--text-muted)');
      txtOcup.setAttribute('font-size', '11px');
      txtOcup.setAttribute('font-weight', '600');
      txtOcup.textContent = capacidade ? `${ocupacao}/${capacidade}` : `${ocupacao}`;
      g.appendChild(txtOcup);
    }

    this.camadaEstacoes.appendChild(g);
  }

  desenharMarcadorPonto(cx, cy, pontoObj, rotuloPadrao) {
    if (!pontoObj) return;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'marcador-ponto');
    g.setAttribute('data-ponto', pontoObj.id);

    // Identificar avaliador atribuído
    const aparelhosAtribuidos = [];
    for (const [dispId, listaPontos] of Object.entries(this.atribuicoes)) {
      if (Array.isArray(listaPontos) && listaPontos.includes(pontoObj.id)) {
        const a = this.aparelhosConectados.get(dispId);
        aparelhosAtribuidos.push(a ? a.nome : dispId);
      }
    }

    const temAparelho = aparelhosAtribuidos.length > 0;
    const corPonto = temAparelho ? '#2563eb' : '#eab308';

    // Círculo central do checkpoint
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', 10);
    circle.setAttribute('fill', corPonto);
    circle.setAttribute('stroke', '#ffffff');
    circle.setAttribute('stroke-width', '2');

    // Rótulo do ponto
    const txtNome = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txtNome.setAttribute('x', cx);
    txtNome.setAttribute('y', cy - 14);
    txtNome.setAttribute('text-anchor', 'middle');
    txtNome.setAttribute('fill', 'var(--text-main)');
    txtNome.setAttribute('font-size', '10px');
    txtNome.setAttribute('font-weight', '700');
    txtNome.textContent = pontoObj.nome || rotuloPadrao;

    // Rótulo do Avaliador (ou alerta de ausência)
    const txtAutor = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txtAutor.setAttribute('x', cx);
    txtAutor.setAttribute('y', cy + 22);
    txtAutor.setAttribute('text-anchor', 'middle');
    txtAutor.setAttribute('font-size', '9px');
    txtAutor.setAttribute('font-weight', '600');

    if (temAparelho) {
      txtAutor.setAttribute('fill', 'var(--primary)');
      txtAutor.textContent = `👤 ${aparelhosAtribuidos.join(', ')}`;
    } else {
      txtAutor.setAttribute('fill', '#f59e0b');
      txtAutor.textContent = '⚠️ Sem avaliador';
    }

    g.appendChild(circle);
    g.appendChild(txtNome);
    g.appendChild(txtAutor);
    this.camadaPontos.appendChild(g);
  }

  obterPosicaoSlotPessoa(zonaId, indice, totalVisiveis, zonas) {
    const ehPadrao = this.ehLayoutRestaurantePadrao(zonas);

    if (ehPadrao) {
      if (zonaId === 'origem') {
        return { x: 890, y: 85 };
      }
      if (zonaId === 'z1') {
        // Fila horizontal que se estende da direita (760) até a catraca (500)
        const xFim = 500;
        const xIni = 770;
        const espaco = Math.min(22, (xIni - xFim) / Math.max(1, totalVisiveis));
        return { x: xFim + indice * espaco, y: 85 };
      }
      if (zonaId === 'z2') {
        // Trilha de atendimento: da catraca (420) até as mesas (260)
        const xFim = 260;
        const xIni = 410;
        const espaco = Math.min(24, (xIni - xFim) / Math.max(1, totalVisiveis));
        return { x: xFim + indice * espaco, y: 85 };
      }
      if (zonaId === 'z3') {
        // Mesas: grade 4x4
        const colunas = 4;
        const col = indice % colunas;
        const lin = Math.floor(indice / colunas);
        return { x: 55 + col * 26, y: 70 + lin * 25 };
      }
      if (zonaId === 'saida') {
        return { x: 105, y: 275 };
      }
    }

    // Layout genérico em cadeia
    const totalEstacoes = zonas.length + 2;
    const larguraView = Math.max(1000, totalEstacoes * 180);
    const espacamento = (larguraView - 40) / totalEstacoes;

    if (zonaId === 'origem') return { x: 80, y: 125 };
    if (zonaId === 'saida') return { x: 20 + (zonas.length + 1) * espacamento + 60, y: 125 };

    const idxZona = zonas.findIndex(z => z.id === zonaId);
    if (idxZona !== -1) {
      const xBase = 20 + (idxZona + 1) * espacamento;
      const modo = zonas[idxZona].modo;
      if (modo === 'contagem') {
        const colunas = 3;
        const col = indice % colunas;
        const lin = Math.floor(indice / colunas);
        return { x: xBase + 20 + col * 22, y: 110 + lin * 20 };
      } else {
        const esp = Math.min(20, 120 / Math.max(1, totalVisiveis));
        return { x: xBase + 15 + indice * esp, y: 125 };
      }
    }

    return { x: 500, y: 125 };
  }

  obterFormaEStiloPessoa(zonaId, zonasMap) {
    if (zonaId === 'origem') {
      return { forma: 'circulo', cor: '#8b5cf6', exibeNumero: false };
    }
    if (zonaId === 'saida') {
      return { forma: 'circulo', cor: '#f97316', exibeNumero: false };
    }

    const z = zonasMap.get(zonaId);
    if (!z) return { forma: 'circulo', cor: '#dc2626', exibeNumero: true };

    if (z.id === 'z1') {
      return { forma: 'circulo', cor: z.cor || '#dc2626', exibeNumero: true };
    }
    if (z.id === 'z2') {
      return { forma: 'quadrado', cor: z.cor || '#16a34a', exibeNumero: true };
    }
    if (z.id === 'z3' || z.modo === 'contagem') {
      // Regra do projeto: Zonas de contagem não exibem número
      return { forma: 'mesa', cor: z.cor || '#ec4899', exibeNumero: false };
    }

    return { forma: 'circulo', cor: z.cor || '#6366f1', exibeNumero: z.modo === 'fifo' };
  }

  renderizarEstado(estado, animar = true) {
    if (!this.habilitada || !this.svg || !estado) return;
    this.estadoAtual = estado;
    this.configAtual = estado.config;

    const zonas = (estado.config?.zonas || []).filter(z => z.habilitada !== false);
    const zonasMap = new Map(zonas.map(z => [z.id, z]));

    this.desenharEstruturaPercurso();

    if (this.abaEmSegundoPlano) animar = false;

    const nosExistentes = new Map();
    for (const no of Array.from(this.camadaPessoas.children)) {
      const pId = parseInt(no.getAttribute('data-pessoa'), 10);
      if (pId) nosExistentes.set(pId, no);
    }

    this.camadaIndicadores.innerHTML = '';
    const idsVisiveisAtuais = new Set();

    // Renderiza pessoas presentes em cada zona habilitada
    for (const z of zonas) {
      const zEstado = estado.zonas[z.id];
      if (!zEstado) continue;

      const fila = zEstado.fila || [];
      const maxVisiveis = 25;
      const visiveis = fila.slice(0, maxVisiveis);
      const excedente = fila.length - visiveis.length;

      for (let i = 0; i < visiveis.length; i++) {
        const pId = visiveis[i];
        idsVisiveisAtuais.add(pId);
        const pos = this.obterPosicaoSlotPessoa(z.id, i, visiveis.length, zonas);
        const estilo = this.obterFormaEStiloPessoa(z.id, zonasMap);

        let g = nosExistentes.get(pId);
        if (!g) {
          g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('class', 'pessoa-item');
          g.setAttribute('data-pessoa', pId);

          const posOrigem = this.obterPosicaoSlotPessoa('origem', 0, 1, zonas);
          g.setAttribute('transform', `translate(${posOrigem.x}, ${posOrigem.y})`);

          this.camadaPessoas.appendChild(g);
          void g.getBoundingClientRect();
        }

        g.innerHTML = '';

        // Criação da forma visual para acessibilidade (círculo, quadrado, mesa)
        if (estilo.forma === 'quadrado') {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', -10);
          rect.setAttribute('y', -10);
          rect.setAttribute('width', 20);
          rect.setAttribute('height', 20);
          rect.setAttribute('rx', 4);
          rect.setAttribute('fill', estilo.cor);
          rect.setAttribute('stroke', '#ffffff');
          rect.setAttribute('stroke-width', '1.5');
          g.appendChild(rect);
        } else if (estilo.forma === 'mesa') {
          const mesa = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          mesa.setAttribute('x', -9);
          mesa.setAttribute('y', -9);
          mesa.setAttribute('width', 18);
          mesa.setAttribute('height', 18);
          mesa.setAttribute('rx', 9);
          mesa.setAttribute('fill', estilo.cor);
          mesa.setAttribute('stroke', '#ffffff');
          mesa.setAttribute('stroke-width', '1.5');
          g.appendChild(mesa);
        } else {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('r', 11);
          circle.setAttribute('fill', estilo.cor);
          circle.setAttribute('stroke', '#ffffff');
          circle.setAttribute('stroke-width', '1.5');
          g.appendChild(circle);
        }

        // Exibição de número (somente se não for contagem)
        if (estilo.exibeNumero) {
          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('class', 'pessoa-numero');
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('dy', '3.5px');
          txt.setAttribute('fill', '#ffffff');
          txt.setAttribute('font-size', '9px');
          txt.setAttribute('font-weight', '700');
          txt.textContent = pId;
          g.appendChild(txt);
        }

        if (animar) {
          g.style.transition = `transform ${this.duracaoTransicao}s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease`;
        } else {
          g.style.transition = 'none';
        }

        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
        g.style.opacity = '1';
      }

      // Exibição de excedente (+N) para filas com mais de 25 itens
      if (excedente > 0) {
        const ultPos = this.obterPosicaoSlotPessoa(z.id, visiveis.length - 1, visiveis.length, zonas);
        const gInd = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gInd.setAttribute('transform', `translate(${ultPos.x + 28}, ${ultPos.y})`);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', -18);
        rect.setAttribute('y', -10);
        rect.setAttribute('width', 36);
        rect.setAttribute('height', 20);
        rect.setAttribute('rx', 10);
        rect.setAttribute('fill', z.cor || 'var(--primary)');

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('class', 'pessoa-numero');
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dy', '3.5px');
        txt.setAttribute('fill', '#ffffff');
        txt.setAttribute('font-size', '10px');
        txt.setAttribute('font-weight', '800');
        txt.textContent = `+${excedente}`;

        gInd.appendChild(rect);
        gInd.appendChild(txt);
        this.camadaIndicadores.appendChild(gInd);
      }
    }

    // Remove nós de pessoas que não estão mais em nenhuma zona visível
    for (const [pId, no] of nosExistentes.entries()) {
      if (!idsVisiveisAtuais.has(pId)) {
        if (animar) {
          no.style.opacity = '0';
          setTimeout(() => no.remove(), 400);
        } else {
          no.remove();
        }
      }
    }
  }

  aplicarOperacoes(diff = [], estadoNovo) {
    if (!this.habilitada) return;

    if (diff.length > 5 || this.abaEmSegundoPlano) {
      this.renderizarEstado(estadoNovo, false);
      return;
    }

    const zonas = (estadoNovo.config?.zonas || []).filter(z => z.habilitada !== false);

    for (const op of diff) {
      if (op.op === 'mover') {
        const no = this.camadaPessoas.querySelector(`[data-pessoa="${op.pessoa}"]`);
        if (no) {
          const posDest = this.obterPosicaoSlotPessoa(op.para, 0, 1, zonas);
          no.style.transition = `transform ${this.duracaoTransicao}s cubic-bezier(0.2, 0.8, 0.2, 1)`;
          no.setAttribute('transform', `translate(${posDest.x}, ${posDest.y})`);
        }
      } else if (op.op === 'sair') {
        const no = this.camadaPessoas.querySelector(`[data-pessoa="${op.pessoa}"]`);
        if (no) {
          const posSaida = this.obterPosicaoSlotPessoa('saida', 0, 1, zonas);
          no.style.transition = `transform ${this.duracaoTransicao}s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.5s ease`;
          no.setAttribute('transform', `translate(${posSaida.x}, ${posSaida.y})`);
          no.style.opacity = '0';
          setTimeout(() => no.remove(), this.duracaoTransicao * 1000);
        }
      } else if (op.op === 'anular') {
        const no = this.camadaPessoas.querySelector(`[data-pessoa="${op.pessoa}"]`);
        if (no) {
          no.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
          no.style.transform += ' scale(0.2)';
          no.style.opacity = '0';
          setTimeout(() => no.remove(), 400);
        }
      } else if (op.op === 'reverter') {
        // Reversão suave no caminho inverso
        this.renderizarEstado(estadoNovo, true);
      }
    }

    // Sincroniza posições finais dos slots
    setTimeout(() => {
      this.renderizarEstado(estadoNovo, true);
    }, this.duracaoTransicao * 1000);
  }

  verificarAlertasOciosidade() {
    if (!this.estadoAtual) return;
    const agora = Date.now();
    const config = this.estadoAtual.config;
    const limiarMs = (config?.limiarAlertaOciosoSeg || 120) * 1000;

    // Regra: se passar de 10s sem registro no ponto da cabeça de uma zona FIFO com zona seguinte vazia, NÃO alertar.
    // Alertar APENAS se houver fila acumulada sem avanço acima do limiar configurado.
    for (const [pId, pt] of Object.entries(this.estadoAtual.pontos || {})) {
      const zOrigem = this.estadoAtual.zonas?.[pt.de];
      if (zOrigem && zOrigem.fila.length > 0) {
        const ultEvento = pt.ultimoEventoMs || this.estadoAtual.config?.inicioMs || agora;
        const ociosoMs = agora - ultEvento;

        const elementoPonto = this.camadaPontos.querySelector(`[data-ponto="${pId}"] circle`);
        if (elementoPonto) {
          if (ociosoMs >= limiarMs) {
            elementoPonto.setAttribute('stroke', '#ef4444');
            elementoPonto.setAttribute('stroke-width', '3');
          } else {
            elementoPonto.setAttribute('stroke', '#ffffff');
            elementoPonto.setAttribute('stroke-width', '2');
          }
        }
      }
    }
  }
}
