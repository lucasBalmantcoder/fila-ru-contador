/**
 * public/animacao.js
 * Renderizador de animação fiel da fila em SVG, seguindo rigorosamente o esboço visual
 * do Restaurante Universitário.
 * O viewBox é calculado deterministicamente a partir da geometria estática do layout.
 * O contêiner usa aspect-ratio com overflow: hidden e isolation: isolate, garantindo
 * que o mapa nunca ultrapasse seus limites nem sobreponha outros blocos.
 *
 * Movimentação: novos blocos partem da origem da fila e deslizam até a posição
 * (como na versão anterior). Sem animação apenas na primeira renderização,
 * em rajadas de operações e com a aba em segundo plano.
 */

/**
 * Calcula os limites e viewBox a partir da geometria estática invariante do layout
 * (caixas físicas, setas direcionais, rótulos e percursos completos das filas).
 * @returns {Object} { minX, minY, largura, altura, aspectRatio, viewBoxStr }
 */
export function calcularViewBoxEstatico() {
    const minX = 65;
    const minY = 15;
    const maxX = 845;
    const maxY = 565;
    const largura = maxX - minX;
    const altura = maxY - minY;

    return {
        minX,
        minY,
        largura,
        altura,
        aspectRatio: largura / altura,
        viewBoxStr: `${minX} ${minY} ${largura} ${altura}`,
    };
}

export class AnimadorFila {
    constructor(containerId, opcoes = {}) {
        this.container =
            typeof containerId === "string"
                ? document.getElementById(containerId)
                : containerId;
        this.habilitada = true;
        this.destaqueFila = opcoes.destaqueFila || null; // 1, 2, 3 ou null (todas)
        this.maxHeight = opcoes.maxHeight || null;

        // Durações (segundos)
        this.duracaoChegada = opcoes.duracaoChegada || 0.9;
        this.duracaoAvanco = opcoes.duracaoAvanco || 0.6;

        this.estadoAtual = null;
        this.abaEmSegundoPlano = false;
        this.timerPulso = null;
        this.resizeObserver = null;
        this.modoAjustado = false;

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
        this.container.innerHTML = "";

        const geom = calcularViewBoxEstatico();

        this.container.style.aspectRatio = `${geom.largura} / ${geom.altura}`;
        this.container.style.width = "100%";
        this.container.style.height = "auto";
        this.container.style.overflow = "hidden";
        this.container.style.isolation = "isolate";
        this.container.style.position = "relative";

        if (this.maxHeight) {
            this.container.style.maxHeight = this.maxHeight;
        } else {
            this.container.style.maxHeight = "calc(100vh - 280px)";
        }

        this.svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
        );
        this.svg.setAttribute("class", "fila-svg");
        this.svg.setAttribute("viewBox", geom.viewBoxStr);
        this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        this.svg.style.width = "100%";
        this.svg.style.height = "100%";
        this.svg.style.display = "block";
        this.svg.style.pointerEvents = "none";

        const defs = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "defs",
        );
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

        this.camadaFundo = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "g",
        );
        this.camadaSetas = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "g",
        );
        this.camadaCaixas = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "g",
        );
        this.camadaRotulos = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "g",
        );
        this.camadaPessoas = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "g",
        );
        this.camadaBadges = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "g",
        );

        this.svg.appendChild(this.camadaFundo);
        this.svg.appendChild(this.camadaSetas);
        this.svg.appendChild(this.camadaCaixas);
        this.svg.appendChild(this.camadaRotulos);
        this.svg.appendChild(this.camadaPessoas);
        this.svg.appendChild(this.camadaBadges);

        this.container.appendChild(this.svg);

        this.desenharEstruturaEstatica();

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                this.ajustarDimensoes();
            });
            this.resizeObserver.observe(this.container);
        }

        document.addEventListener("visibilitychange", () => {
            this.abaEmSegundoPlano = document.hidden;
            if (!this.abaEmSegundoPlano && this.estadoAtual) {
                // Ao voltar, posiciona tudo direto, sem fila de transições acumuladas
                this.renderizarEstado(this.estadoAtual, false);
            }
        });

        this.timerPulso = setInterval(() => {
            this.verificarPulsos();
        }, 1000);
    }

    ajustarDimensoes() {
        if (!this.container || !this.svg) return;
        const geom = calcularViewBoxEstatico();
        this.svg.setAttribute("viewBox", geom.viewBoxStr);
    }

    alternarAjustarTela() {
        this.modoAjustado = !this.modoAjustado;
        if (this.modoAjustado) {
            this.container.style.maxHeight = "calc(100vh - 220px)";
        } else {
            this.container.style.maxHeight =
                this.maxHeight || "calc(100vh - 280px)";
        }
    }

    alternarTelaCheia() {
        const alvo =
            this.container.closest(".animacao-wrapper") || this.container;
        if (!document.fullscreenElement) {
            if (alvo.requestFullscreen) {
                alvo.requestFullscreen();
            } else if (alvo.webkitRequestFullscreen) {
                alvo.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    desenharEstruturaEstatica() {
        this.camadaCaixas.innerHTML = "";
        this.camadaSetas.innerHTML = "";
        this.camadaRotulos.innerHTML = "";

        this.criarCaixa("catraca", 527, 173, 95, 85, "catraca");
        this.criarCaixa("atendimento", 390, 221, 75, 142, ["Atendi", "mento"]);
        this.criarCaixa("mesas", 123, 172, 99, 86, "Mesas");
        this.criarCaixa("saida", 123, 462, 99, 86, "Saída");

        this.criarSeta(820, 70, 820, 180);
        this.criarSeta(770, 270, 650, 270);
        this.criarSeta(545, 250, 545, 360);
        this.criarSeta(490, 420, 370, 420);
        this.criarSeta(305, 360, 305, 240);
        this.criarSeta(350, 165, 240, 165);
        this.criarSeta(85, 300, 85, 410);

        this.criarRotuloTexto("rotulo_f1", 700, 185, "Fila 1");
        this.criarRotuloTexto("rotulo_f2", 427, 185, "Fila 2");
        this.criarRotuloTexto("rotulo_f3", 135, 350, "Fila 3");
    }

    criarCaixa(id, x, y, w, h, texto) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("id", `caixa_${id}`);

        const rect = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "rect",
        );
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", w);
        rect.setAttribute("height", h);
        rect.setAttribute("fill", "#ffffff");
        rect.setAttribute("stroke", "#000000");
        rect.setAttribute("stroke-width", "2.5");
        g.appendChild(rect);

        if (Array.isArray(texto)) {
            const t1 = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "text",
            );
            t1.setAttribute("x", x + w / 2);
            t1.setAttribute("y", y + h / 2 - 4);
            t1.setAttribute("text-anchor", "middle");
            t1.setAttribute(
                "font-family",
                "system-ui, -apple-system, sans-serif",
            );
            t1.setAttribute("font-size", "16");
            t1.setAttribute("font-weight", "500");
            t1.setAttribute("fill", "#000000");
            t1.textContent = texto[0];

            const t2 = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "text",
            );
            t2.setAttribute("x", x + w / 2);
            t2.setAttribute("y", y + h / 2 + 18);
            t2.setAttribute("text-anchor", "middle");
            t2.setAttribute(
                "font-family",
                "system-ui, -apple-system, sans-serif",
            );
            t2.setAttribute("font-size", "16");
            t2.setAttribute("font-weight", "500");
            t2.setAttribute("fill", "#000000");
            t2.textContent = texto[1];

            g.appendChild(t1);
            g.appendChild(t2);
        } else {
            const text = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "text",
            );
            text.setAttribute("x", x + w / 2);
            text.setAttribute("y", y + h / 2 + 6);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute(
                "font-family",
                "system-ui, -apple-system, sans-serif",
            );
            text.setAttribute("font-size", "16");
            text.setAttribute("font-weight", "500");
            text.setAttribute("fill", "#000000");
            text.textContent = texto;
            g.appendChild(text);
        }

        const cont = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
        );
        cont.setAttribute("id", `contador_caixa_${id}`);
        cont.setAttribute("x", x + w / 2);
        cont.setAttribute("y", y + h - 8);
        cont.setAttribute("text-anchor", "middle");
        cont.setAttribute(
            "font-family",
            "system-ui, -apple-system, sans-serif",
        );
        cont.setAttribute("font-size", "12");
        cont.setAttribute("font-weight", "bold");
        cont.setAttribute("fill", "#64748b");
        cont.textContent = "";
        g.appendChild(cont);

        this.camadaCaixas.appendChild(g);
    }

    criarSeta(x1, y1, x2, y2) {
        const line = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line",
        );
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        line.setAttribute("stroke", "#1e293b");
        line.setAttribute("stroke-width", "2.5");
        line.setAttribute("marker-end", "url(#seta-preta)");
        this.camadaSetas.appendChild(line);
    }

    criarRotuloTexto(id, x, y, texto) {
        const text = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
        );
        text.setAttribute("id", id);
        text.setAttribute("x", x);
        text.setAttribute("y", y);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute(
            "font-family",
            "system-ui, -apple-system, sans-serif",
        );
        text.setAttribute("font-size", "15");
        text.setAttribute("font-weight", "500");
        text.setAttribute("fill", "#334155");
        text.textContent = texto;
        this.camadaRotulos.appendChild(text);
    }

    obterPontoNoCaminho(filaNum, d) {
        if (filaNum === 1) {
            if (d <= 126) {
                return {
                    x: 640 + d,
                    y: 210,
                    w: 10,
                    h: 24,
                    orientacao: "horizontal",
                };
            }
            const dVert = d - 126;
            return {
                x: 766,
                y: Math.max(30, 210 - dVert),
                w: 24,
                h: 10,
                orientacao: "vertical",
            };
        }

        if (filaNum === 2) {
            if (d <= 115) {
                return {
                    x: 235 + d,
                    y: 214,
                    w: 10,
                    h: 24,
                    orientacao: "horizontal",
                };
            }
            if (d <= 277) {
                const dSub = d - 115;
                return {
                    x: 350,
                    y: 214 + dSub,
                    w: 24,
                    h: 10,
                    orientacao: "vertical",
                };
            }
            if (d <= 432) {
                const dHoriz = d - 277;
                return {
                    x: 350 + dHoriz,
                    y: 376,
                    w: 10,
                    h: 24,
                    orientacao: "horizontal",
                };
            }
            const dVert = d - 432;
            return {
                x: 505,
                y: Math.max(210, 376 - dVert),
                w: 24,
                h: 10,
                orientacao: "vertical",
            };
        }

        if (filaNum === 3) {
            return {
                x: 176,
                y: Math.max(265, 432 - d),
                w: 24,
                h: 10,
                orientacao: "vertical",
            };
        }

        return { x: 0, y: 0, w: 10, h: 10, orientacao: "horizontal" };
    }

    obterPosicaoOrigem(filaNum) {
        if (filaNum === 1) return { x: 766, y: 20 };
        if (filaNum === 2) return { x: 505, y: 210 };
        if (filaNum === 3) return { x: 176, y: 265 };
        return { x: 0, y: 0 };
    }

    obterPosicaoDestino(filaNum) {
        if (filaNum === 1) return { x: 574, y: 215 };
        if (filaNum === 2) return { x: 172, y: 215 };
        if (filaNum === 3) return { x: 172, y: 505 };
        return { x: 0, y: 0 };
    }

    obterComprimentoMaximoCaminho(filaNum) {
        if (filaNum === 1) return 296;
        if (filaNum === 2) return 593;
        if (filaNum === 3) return 164;
        return 200;
    }

    /**
     * Aplica operações atômicas recebidas pelo diff de estados.
     * - diff vazio (ex.: chegadas): renderiza COM animação, imediatamente.
     * - rajada (> 8 operações) ou aba em segundo plano: renderiza sem animação.
     * - demais casos: anima as operações e sincroniza a fila restante.
     */
    aplicarOperacoes(diff = [], estadoNovo) {
        if (!this.habilitada) return;

        if (
            this.abaEmSegundoPlano ||
            (Array.isArray(diff) && diff.length > 8)
        ) {
            this.renderizarEstado(estadoNovo, false);
            return;
        }

        if (!diff || !Array.isArray(diff) || diff.length === 0) {
            // Chegadas e avanços sem operação explícita: animar deslizamento
            this.renderizarEstado(estadoNovo, true);
            return;
        }

        for (const op of diff) {
            if (op.op === "confirmar") {
                const fNum = op.fila || 1;
                const no = this.camadaPessoas.querySelector(
                    `[data-chave="f${fNum}_p${op.pessoa}"]`,
                );
                if (no) {
                    const posDest = this.obterPosicaoDestino(fNum);
                    no.style.transition =
                        "transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.5s ease";
                    no.setAttribute(
                        "transform",
                        `translate(${posDest.x}, ${posDest.y})`,
                    );
                    no.style.opacity = "0";
                    setTimeout(() => no.remove(), 600);
                }
            } else if (op.op === "transferir") {
                const fOrig = op.fila || op.deFila || 1;
                const noOrig = this.camadaPessoas.querySelector(
                    `[data-chave="f${fOrig}_p${op.pessoa}"]`,
                ) || this.camadaPessoas.querySelector(
                    `[data-chave="f1_p${op.pessoa}"]`,
                );
                if (noOrig) {
                    const posDest = this.obterPosicaoDestino(fOrig);
                    noOrig.style.transition =
                        "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s ease";
                    noOrig.setAttribute(
                        "transform",
                        `translate(${posDest.x}, ${posDest.y})`,
                    );
                    noOrig.style.opacity = "0";
                    setTimeout(() => noOrig.remove(), 500);
                }
            } else if (op.op === "anular") {
                const fNum = op.fila || 1;
                const no = this.camadaPessoas.querySelector(
                    `[data-chave="f${fNum}_p${op.pessoa}"]`,
                );
                if (no) {
                    no.style.transition =
                        "transform 0.4s ease, opacity 0.4s ease";
                    no.style.transform += " scale(0.2)";
                    no.style.opacity = "0";
                    setTimeout(() => no.remove(), 400);
                }
            }
        }

        // Sincroniza posições da fila restante com avanço suave
        setTimeout(() => {
            this.renderizarEstado(estadoNovo, true);
        }, 150);
    }

    /**
     * Renderiza o estado completo das filas.
     * @param {Object} estado - Estado derivado de derivarEstado.
     * @param {boolean} [animar=true] - Se deve aplicar transição suave ou atualizar direto.
     */
    renderizarEstado(estado, animar = true) {
        if (!this.habilitada || !this.svg || !estado) return;

        // Primeira renderização: posiciona direto, sem fazer todos os blocos "voarem" da origem
        const primeiraRenderizacao = this.estadoAtual === null;
        this.estadoAtual = estado;

        if (this.abaEmSegundoPlano || primeiraRenderizacao) animar = false;

        const contCatraca = document.getElementById("contador_caixa_catraca");
        if (contCatraca) {
            const totalPassaram =
                estado.filas?.[1]?.contadores?.atendidas ??
                estado.contadores?.atendidas ??
                0;
            contCatraca.textContent = `${totalPassaram} passaram`;
        }

        const contMesas = document.getElementById("contador_caixa_mesas");
        if (contMesas) {
            const totalMesas = estado.filas?.[2]?.contadores?.atendidas ?? 0;
            contMesas.textContent = `${totalMesas} chegaram`;
        }

        const contSaida = document.getElementById("contador_caixa_saida");
        if (contSaida) {
            const totalSaida = estado.filas?.[3]?.contadores?.atendidas ?? 0;
            contSaida.textContent = `${totalSaida} saíram`;
        }

        const filasAtivas = estado.filasAtivas || [1];

        const nosExistentes = new Map();
        for (const no of Array.from(this.camadaPessoas.children)) {
            const chave = no.dataset.chave;
            if (chave) nosExistentes.set(chave, no);
        }

        const chavesVisiveisAtuais = new Set();
        this.camadaBadges.innerHTML = "";

        for (const fNum of [1, 2, 3]) {
            const fObj = estado.filas?.[fNum];
            const ativa = filasAtivas.includes(fNum) && fObj?.ativa !== false;
            const filaArray =
                fObj?.fila || (fNum === 1 ? estado.fila : []) || [];

            const rotuloEl = document.getElementById(`rotulo_f${fNum}`);
            if (rotuloEl) {
                if (!filasAtivas.includes(fNum)) {
                    rotuloEl.textContent = `Fila ${fNum} (não coletada)`;
                    rotuloEl.setAttribute("fill", "#94a3b8");
                } else if (fObj?.desativadaEm) {
                    rotuloEl.textContent = `Fila ${fNum} (desativada)`;
                    rotuloEl.setAttribute("fill", "#94a3b8");
                } else if (fObj?.semDados) {
                    rotuloEl.textContent = `Fila ${fNum} (sem dados)`;
                    rotuloEl.setAttribute("fill", "#d97706");
                } else {
                    rotuloEl.textContent = `Fila ${fNum} (${filaArray.length})`;
                    rotuloEl.setAttribute("fill", "#334155");
                }
            }

            if (!ativa) continue;

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
            const qtdRenderizar = precisaAgrupar
                ? Math.max(1, maxCabem - 1)
                : totalPessoas;

            for (let i = 0; i < qtdRenderizar; i++) {
                const pNum = filaArray[i];
                const chave = `f${fNum}_p${pNum}`;
                chavesVisiveisAtuais.add(chave);

                const dist = i * espacamento;
                const pt = this.obterPontoNoCaminho(fNum, dist);
                const ehCabeca = i === 0;

                let g = nosExistentes.get(chave);
                let novo = false;

                if (!g) {
                    novo = true;
                    g = document.createElementNS(
                        "http://www.w3.org/2000/svg",
                        "g",
                    );
                    g.setAttribute("class", "item-pessoa");
                    g.dataset.chave = chave;
                    g.dataset.pessoa = String(pNum);
                    g.dataset.fila = String(fNum);

                    // Com animação: nasce na origem e desliza até a posição.
                    // Sem animação: nasce direto na posição final.
                    const percursoCatraca =
                        fNum === 2 && animar && typeof g.animate === "function";
                    const ptInicial =
                        animar && !percursoCatraca
                            ? this.obterPosicaoOrigem(fNum)
                            : pt;
                    g.style.transition = "none";
                    g.setAttribute(
                        "transform",
                        `translate(${ptInicial.x}, ${ptInicial.y})`,
                    );

                    const rect = document.createElementNS(
                        "http://www.w3.org/2000/svg",
                        "rect",
                    );
                    rect.setAttribute("x", -pt.w / 2);
                    rect.setAttribute("y", -pt.h / 2);
                    rect.setAttribute("width", pt.w);
                    rect.setAttribute("height", pt.h);
                    rect.setAttribute("rx", "1.5");
                    g.appendChild(rect);

                    const text = document.createElementNS(
                        "http://www.w3.org/2000/svg",
                        "text",
                    );
                    text.setAttribute("x", "0");
                    text.setAttribute("y", "3");
                    text.setAttribute("text-anchor", "middle");
                    text.setAttribute(
                        "font-family",
                        "system-ui, -apple-system, sans-serif",
                    );
                    text.setAttribute("font-size", "8");
                    text.setAttribute("font-weight", "bold");
                    text.setAttribute("fill", "#ffffff");
                    text.textContent = String(pNum);
                    g.appendChild(text);

                    this.camadaPessoas.appendChild(g);

                    // Força reflow para o navegador registrar a posição inicial antes de animar
                    void g.getBoundingClientRect();
                }

                if (ehCabeca) {
                    g.setAttribute("id", `cabeca_f${fNum}`);
                    g.dataset.esperaMs = fObj?.esperaNaCabecaMs || 0;
                } else if (g.id === `cabeca_f${fNum}`) {
                    g.removeAttribute("id");
                }

                let fillCor = "#ef4444";
                let strokeCor = "none";
                let strokeW = "0";

                if (fNum === 1) {
                    if (ehCabeca) {
                        fillCor = "#22c55e";
                        strokeCor = "#15803d";
                        strokeW = "2";
                    } else {
                        fillCor = "#ef4444";
                    }
                } else if (fNum === 2) {
                    if (ehCabeca) {
                        fillCor = "#ec4899";
                        strokeCor = "#be185d";
                        strokeW = "2";
                    } else {
                        fillCor = "#22c55e";
                    }
                } else if (fNum === 3) {
                    if (ehCabeca) {
                        fillCor = "#f97316";
                        strokeCor = "#c2410c";
                        strokeW = "2";
                    } else {
                        fillCor = "#ec4899";
                    }
                }

                const opacidadeFinal =
                    this.destaqueFila && this.destaqueFila !== fNum
                        ? "0.35"
                        : "1";

                const rect = g.querySelector("rect");
                if (rect) {
                    rect.setAttribute("x", -pt.w / 2);
                    rect.setAttribute("y", -pt.h / 2);
                    rect.setAttribute("width", pt.w);
                    rect.setAttribute("height", pt.h);
                    rect.setAttribute("fill", fillCor);
                    if (strokeCor !== "none") {
                        rect.setAttribute("stroke", strokeCor);
                        rect.setAttribute("stroke-width", strokeW);
                    } else {
                        rect.removeAttribute("stroke");
                        rect.removeAttribute("stroke-width");
                    }
                }

                // Transição até a posição de destino no trajeto
                const usarPercurso =
                    novo &&
                    animar &&
                    fNum === 2 &&
                    typeof g.animate === "function";

                if (usarPercurso) {
                    g.style.transition = "none";
                } else if (animar) {
                    const dur = novo ? this.duracaoChegada : this.duracaoAvanco;
                    g.style.transition = `transform ${dur}s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s ease`;
                } else {
                    g.style.transition = "none";
                }
                g.style.opacity = opacidadeFinal;
                g.setAttribute("transform", `translate(${pt.x}, ${pt.y})`);

                if (usarPercurso) {
                    this.animarPercursoFila2(g, dist, pt);
                }
            }

            if (precisaAgrupar) {
                const excedente = totalPessoas - qtdRenderizar;
                const distBadge = qtdRenderizar * espacamento;
                const ptBadge = this.obterPontoNoCaminho(fNum, distBadge);
                this.desenharBadgeMaisN(fNum, excedente, ptBadge);
            }
        }

        // Remove nós que não estão mais na fila
        for (const [chave, no] of nosExistentes.entries()) {
            if (!chavesVisiveisAtuais.has(chave)) {
                if (animar) {
                    no.style.opacity = "0";
                    setTimeout(() => no.remove(), 400);
                } else {
                    no.remove();
                }
            }
        }
    }

    desenharBadgeMaisN(filaNum, excedente, pt) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const badgeW = 32;
        const badgeH = 16;

        const rect = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "rect",
        );
        rect.setAttribute("x", pt.x - badgeW / 2);
        rect.setAttribute("y", pt.y - badgeH / 2);
        rect.setAttribute("width", badgeW);
        rect.setAttribute("height", badgeH);
        rect.setAttribute("rx", "8");
        rect.setAttribute("fill", "#475569");
        g.appendChild(rect);

        const text = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
        );
        text.setAttribute("x", pt.x);
        text.setAttribute("y", pt.y + 4);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute(
            "font-family",
            "system-ui, -apple-system, sans-serif",
        );
        text.setAttribute("font-size", "9");
        text.setAttribute("font-weight", "bold");
        text.setAttribute("fill", "#ffffff");
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
                    cabecaEl.classList.add("pulso-ativo");
                } else {
                    cabecaEl.classList.remove("pulso-ativo");
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
        if (this.resizeObserver) this.resizeObserver.disconnect();
    }
}
