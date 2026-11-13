/**
 * public/animacao.js
 * Renderizador de animação fiel da fila em SVG, seguindo rigorosamente o esboço visual
 * do Restaurante Universitário.
 * 
 * Suporta dois modos de renderização:
 * 1. Renderização Contínua e Determinística (Replay de Histórico via renderizarBlocosAnimados):
 *    Posiciona instantaneamente cada bloco no frame t a partir do cálculo matemático contínuo
 *    da TimelineAnimada, garantindo fluidez a 60 fps, sem concorrência de CSS transitions,
 *    e compatibilidade total com 1x, 5x, 10x, 60x, scrubbing e reinício idêntico.
 * 
 * 2. Renderização Incremental (Painel ao Vivo e Celular via renderizarEstado):
 *    Aplica transições suaves aos novos eventos recebidos via WebSocket, com percurso seguro
 *    e tratamento à prova de falhas para todas as filas.
 */

import { CAIXAS, ROTAS, CONECTORES, CORES, interpolarPolilinha, calcularComprimentoPolilinha } from '../shared/movimento.js';

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

        // Durações de transição para modo ao vivo (segundos)
        this.duracaoChegada = opcoes.duracaoChegada || 0.9;
        this.duracaoAvanco = opcoes.duracaoAvanco || 0.6;

        this.estadoAtual = null;
        this.abaEmSegundoPlano = false;
        this.timerPulso = null;
        this.timerAvanco = null;
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
        this.svg.style.backgroundColor = "#ffffff";
        this.svg.style.borderRadius = "8px";

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
              50% { transform: scale(1.15); opacity: 0.85; }
            }
            .pulso-ativo {
              animation: pulsoCabeca 1s infinite ease-in-out;
              transform-origin: center;
            }
          </style>
        `;
        this.svg.appendChild(defs);

        this.camadaFundo = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const rectFundo = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rectFundo.setAttribute("x", geom.minX);
        rectFundo.setAttribute("y", geom.minY);
        rectFundo.setAttribute("width", geom.largura);
        rectFundo.setAttribute("height", geom.altura);
        rectFundo.setAttribute("fill", "#ffffff");
        this.camadaFundo.appendChild(rectFundo);

        this.camadaSetas = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.camadaCaixas = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.camadaRotulos = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.camadaPessoas = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.camadaBadges = document.createElementNS("http://www.w3.org/2000/svg", "g");

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
            this.container.style.maxHeight = this.maxHeight || "calc(100vh - 280px)";
        }
    }

    alternarTelaCheia() {
        const alvo = this.container.closest(".animacao-wrapper") || this.container;
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

        // Caixas físicas conforme o diagrama oficial do RU
        this.criarCaixa("catraca", 527, 173, 95, 85, "catraca");
        this.criarCaixa("atendimento", 390, 221, 75, 142, ["Atendi", "mento"]);
        this.criarCaixa("mesas", 123, 172, 99, 86, "Mesas");
        this.criarCaixa("saida", 123, 462, 99, 86, "Saída");

        // Setas direcionais do fluxo
        this.criarSeta(820, 70, 820, 180);
        this.criarSeta(770, 270, 650, 270);
        this.criarSeta(545, 250, 545, 360);
        this.criarSeta(490, 420, 370, 420);
        this.criarSeta(305, 360, 305, 240);
        this.criarSeta(350, 165, 240, 165);
        this.criarSeta(85, 300, 85, 410);

        // Rótulos de fila
        this.criarRotuloTexto("rotulo_f1", 700, 185, "Fila 1");
        this.criarRotuloTexto("rotulo_f2", 427, 185, "Fila 2");
        this.criarRotuloTexto("rotulo_f3", 135, 350, "Fila 3");
    }

    criarCaixa(id, x, y, w, h, texto) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("id", `caixa_${id}`);

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", y);
        rect.setAttribute("width", w);
        rect.setAttribute("height", h);
        rect.setAttribute("fill", "#ffffff");
        rect.setAttribute("stroke", "#000000");
        rect.setAttribute("stroke-width", "2.5");
        g.appendChild(rect);

        if (Array.isArray(texto)) {
            const t1 = document.createElementNS("http://www.w3.org/2000/svg", "text");
            t1.setAttribute("x", x + w / 2);
            t1.setAttribute("y", y + h / 2 - 4);
            t1.setAttribute("text-anchor", "middle");
            t1.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
            t1.setAttribute("font-size", "16");
            t1.setAttribute("font-weight", "500");
            t1.setAttribute("fill", "#000000");
            t1.textContent = texto[0];

            const t2 = document.createElementNS("http://www.w3.org/2000/svg", "text");
            t2.setAttribute("x", x + w / 2);
            t2.setAttribute("y", y + h / 2 + 18);
            t2.setAttribute("text-anchor", "middle");
            t2.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
            t2.setAttribute("font-size", "16");
            t2.setAttribute("font-weight", "500");
            t2.setAttribute("fill", "#000000");
            t2.textContent = texto[1];

            g.appendChild(t1);
            g.appendChild(t2);
        } else {
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", x + w / 2);
            text.setAttribute("y", y + h / 2 + 6);
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
            text.setAttribute("font-size", "16");
            text.setAttribute("font-weight", "500");
            text.setAttribute("fill", "#000000");
            text.textContent = texto;
            g.appendChild(text);
        }

        const cont = document.createElementNS("http://www.w3.org/2000/svg", "text");
        cont.setAttribute("id", `contador_caixa_${id}`);
        cont.setAttribute("x", x + w / 2);
        cont.setAttribute("y", y + h - 8);
        cont.setAttribute("text-anchor", "middle");
        cont.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
        cont.setAttribute("font-size", "12");
        cont.setAttribute("font-weight", "bold");
        cont.setAttribute("fill", "#64748b");
        cont.textContent = "";
        g.appendChild(cont);

        this.camadaCaixas.appendChild(g);
    }

    criarSeta(x1, y1, x2, y2) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
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
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("id", id);
        text.setAttribute("x", x);
        text.setAttribute("y", y);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
        text.setAttribute("font-size", "15");
        text.setAttribute("font-weight", "500");
        text.setAttribute("fill", "#334155");
        text.textContent = texto;
        this.camadaRotulos.appendChild(text);
    }

    // ========================================================================
    // MODO REPLAY: RENDERIZAÇÃO CONTÍNUA E DETERMINÍSTICA A 60 FPS
    // ========================================================================

    /**
     * Renderiza o quadro da animação contínua calculada deterministicamente a partir de t.
     * Atualiza as coordenadas (x, y), dimensões, cores e estados dos blocos SVG instantaneamente.
     * @param {{ blocos: Array<Object>, badges: Array<Object>, t: number }} dadosAnimados
     */
    renderizarBlocosAnimados(dadosAnimados) {
        if (!this.habilitada || !this.svg || !dadosAnimados) return;

        const listaBlocos = dadosAnimados.blocos || [];
        const badges = dadosAnimados.badges || [];

        // Mapeia nós já presentes na camada
        const nosExistentes = new Map();
        for (const no of Array.from(this.camadaPessoas.children)) {
            const chave = no.dataset.chave;
            if (chave) nosExistentes.set(chave, no);
        }

        const chavesVisiveis = new Set();

        // 1. Atualiza ou insere cada bloco ativo na posição contínua interpolada
        for (let i = 0; i < listaBlocos.length; i++) {
            const b = listaBlocos[i];
            const chave = b.chave;
            chavesVisiveis.add(chave);

            let g = nosExistentes.get(chave);
            let ehNovo = false;

            if (!g) {
                ehNovo = true;
                g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                g.setAttribute("class", "item-pessoa");
                g.dataset.chave = chave;
                g.dataset.pessoa = String(b.pessoa);
                g.dataset.fila = String(b.fila);

                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("rx", "1.5");
                g.appendChild(rect);

                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", "0");
                text.setAttribute("y", "0");
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("dominant-baseline", "central");
                text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
                text.setAttribute("font-size", "8");
                text.setAttribute("font-weight", "bold");
                text.setAttribute("fill", "#ffffff");
                text.textContent = String(b.pessoa);
                g.appendChild(text);

                this.camadaPessoas.appendChild(g);
            }

            // Atualiza geometria e cor do retângulo do bloco
            g.dataset.fila = String(b.fila);
            const textEl = g.querySelector("text");
            if (textEl && textEl.textContent !== String(b.pessoa)) {
                textEl.textContent = String(b.pessoa);
            }

            const rect = g.querySelector("rect");
            if (rect) {
                rect.setAttribute("x", -b.w / 2);
                rect.setAttribute("y", -b.h / 2);
                rect.setAttribute("width", b.w);
                rect.setAttribute("height", b.h);
                rect.setAttribute("fill", b.cor);

                // Destaque de borda na cabeça da fila
                if (b.ehCabeca) {
                    const strokeCor = b.fila === 1 ? '#15803d' : (b.fila === 2 ? '#be185d' : '#c2410c');
                    rect.setAttribute("stroke", strokeCor);
                    rect.setAttribute("stroke-width", "2");
                } else {
                    rect.removeAttribute("stroke");
                    rect.removeAttribute("stroke-width");
                }
            }

            // Opacidade e escala determinísticas
            const opacidadeFinal = this.destaqueFila && this.destaqueFila !== b.fila ? 0.35 : (b.opacidade ?? 1);
            g.style.opacity = String(opacidadeFinal);
            g.style.transition = "none"; // Sem transições CSS assíncronas no replay 60fps

            // Posiciona diretamente nas coordenadas (x, y) contínuas do instante t
            const escalaStr = (b.escala && b.escala !== 1) ? ` scale(${b.escala})` : '';
            g.setAttribute("transform", `translate(${b.x}, ${b.y})${escalaStr}`);

            // Controle de pulso da cabeça da fila
            if (b.ehCabeca && b.devePulsar) {
                g.classList.add("pulso-ativo");
            } else {
                g.classList.remove("pulso-ativo");
            }
        }

        // 2. Remove blocos que concluíram saída ou deixaram o sistema
        for (const [chave, no] of nosExistentes.entries()) {
            if (!chavesVisiveis.has(chave)) {
                no.remove();
            }
        }

        // 3. Atualiza selos de excesso de capacidade (+N)
        this.camadaBadges.innerHTML = "";
        for (const badge of badges) {
            this.desenharBadgeMaisN(badge.fila, badge.excedente, { x: badge.x, y: badge.y });
        }
    }

    // ========================================================================
    // MODO AO VIVO: COMPATIBILIDADE COM O PAINEL E O CELULAR
    // ========================================================================

    obterPontoNoCaminho(filaNum, d) {
        const rota = ROTAS[Number(filaNum)];
        if (!rota) return { x: 0, y: 0, w: 10, h: 24, orientacao: "horizontal" };
        const compTotal = calcularComprimentoPolilinha(rota);
        const distDoInicio = Math.max(0, compTotal - d);
        return interpolarPolilinha(rota, distDoInicio);
    }

    obterPosicaoOrigem(filaNum) {
        const rota = ROTAS[Number(filaNum)];
        if (rota && rota.length > 0) return rota[0];
        return { x: 0, y: 0 };
    }

    obterPosicaoDestino(filaNum) {
        if (filaNum === 1) return { x: 585, y: 212 }; // Centro catraca
        if (filaNum === 2) return { x: 192, y: 214 }; // Centro mesas
        if (filaNum === 3) return { x: 192, y: 505 }; // Centro saída
        return { x: 0, y: 0 };
    }

    obterComprimentoMaximoCaminho(filaNum) {
        const rota = ROTAS[Number(filaNum)];
        return rota ? calcularComprimentoPolilinha(rota) : 200;
    }

    /**
     * Animação suave e segura contornando a caixa Atendimento na Fila 2.
     * Utiliza Web Animations API com fallback seguro.
     */
    animarPercursoFila2(g, dist, pt) {
        if (!g || typeof g.animate !== "function") return;
        try {
            const waypoints = [
                { x: 521, y: 215 },
                { x: 521, y: 376 },
                { x: 368, y: 376 },
                { x: 368, y: 214 },
                { x: pt.x, y: pt.y }
            ];

            const keyframes = waypoints.map(wp => ({
                transform: `translate(${wp.x}px, ${wp.y}px)`
            }));

            g.animate(keyframes, {
                duration: this.duracaoChegada * 1000,
                easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
                fill: "none"
            });
        } catch (e) {
            console.warn("Aviso na animação do percurso da Fila 2:", e);
        }
    }

    /**
     * Aplica operações atômicas recebidas pelo diff de estados em tempo real.
     */
    aplicarOperacoes(diff = [], estadoNovo) {
        if (!this.habilitada) return;

        if (this.abaEmSegundoPlano || (Array.isArray(diff) && diff.length > 8)) {
            this.renderizarEstado(estadoNovo, false);
            return;
        }

        if (!diff || !Array.isArray(diff) || diff.length === 0) {
            this.renderizarEstado(estadoNovo, true);
            return;
        }

        for (const op of diff) {
            if (op.op === "confirmar") {
                const fNum = op.fila || 1;
                const no = this.camadaPessoas.querySelector(`[data-chave="f${fNum}_p${op.pessoa}"]`);
                if (no) {
                    const posDest = this.obterPosicaoDestino(fNum);
                    no.style.transition = "transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.5s ease";
                    no.setAttribute("transform", `translate(${posDest.x}, ${posDest.y})`);
                    no.style.opacity = "0";
                    setTimeout(() => no.remove(), 600);
                }
            } else if (op.op === "transferir") {
                const fOrig = op.fila || op.deFila || 1;
                const noOrig = this.camadaPessoas.querySelector(`[data-chave="f${fOrig}_p${op.pessoa}"]`) ||
                               this.camadaPessoas.querySelector(`[data-chave="f1_p${op.pessoa}"]`);
                if (noOrig) {
                    const posDest = this.obterPosicaoDestino(fOrig);
                    noOrig.style.transition = "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s ease";
                    noOrig.setAttribute("transform", `translate(${posDest.x}, ${posDest.y})`);
                    noOrig.style.opacity = "0";
                    setTimeout(() => noOrig.remove(), 500);
                }
            } else if (op.op === "anular") {
                const fNum = op.fila || 1;
                const no = this.camadaPessoas.querySelector(`[data-chave="f${fNum}_p${op.pessoa}"]`);
                if (no) {
                    no.style.transition = "transform 0.4s ease, opacity 0.4s ease";
                    no.style.transform += " scale(0.2)";
                    no.style.opacity = "0";
                    setTimeout(() => no.remove(), 400);
                }
            }
        }

        if (this.timerAvanco) clearTimeout(this.timerAvanco);
        this.timerAvanco = setTimeout(() => {
            this.timerAvanco = null;
            this.renderizarEstado(estadoNovo, true);
        }, 150);
    }

    /**
     * Renderiza o estado das filas para o modo ao vivo do Painel e Celular.
     */
    renderizarEstado(estado, animar = true) {
        if (!this.habilitada || !this.svg || !estado) return;

        const primeiraRenderizacao = this.estadoAtual === null;
        this.estadoAtual = estado;

        if (this.abaEmSegundoPlano || primeiraRenderizacao) animar = false;

        // Contadores nas caixas
        const contCatraca = document.getElementById("contador_caixa_catraca");
        if (contCatraca) {
            const totalPassaram = estado.filas?.[1]?.contadores?.atendidas ?? estado.contadores?.atendidas ?? 0;
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
            const filaArray = fObj?.fila || (fNum === 1 ? estado.fila : []) || [];

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
            const qtdRenderizar = precisaAgrupar ? Math.max(1, maxCabem - 1) : totalPessoas;

            for (let i = 0; i < qtdRenderizar; i++) {
                const pNum = filaArray[i];
                const chave = `f${fNum}_p${pNum}`;
                chavesVisiveisAtuais.add(chave);

                const dist = i * espacamento;
                const pt = this.obterPontoNoCaminho(fNum, dist);
                const ehCabeca = (i === 0);

                let g = nosExistentes.get(chave);
                let novo = false;

                if (!g) {
                    novo = true;
                    g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                    g.setAttribute("class", "item-pessoa");
                    g.dataset.chave = chave;
                    g.dataset.pessoa = String(pNum);
                    g.dataset.fila = String(fNum);

                    const ptInicial = animar ? this.obterPosicaoOrigem(fNum) : pt;
                    g.style.transition = "none";
                    g.setAttribute("transform", `translate(${ptInicial.x}, ${ptInicial.y})`);

                    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                    rect.setAttribute("x", -pt.w / 2);
                    rect.setAttribute("y", -pt.h / 2);
                    rect.setAttribute("width", pt.w);
                    rect.setAttribute("height", pt.h);
                    rect.setAttribute("rx", "1.5");
                    g.appendChild(rect);

                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    text.setAttribute("x", "0");
                    text.setAttribute("y", "0");
                    text.setAttribute("text-anchor", "middle");
                    text.setAttribute("dominant-baseline", "central");
                    text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
                    text.setAttribute("font-size", "8");
                    text.setAttribute("font-weight", "bold");
                    text.setAttribute("fill", "#ffffff");
                    text.textContent = String(pNum);
                    g.appendChild(text);

                    this.camadaPessoas.appendChild(g);
                }

                if (ehCabeca) {
                    g.setAttribute("id", `cabeca_f${fNum}`);
                    g.dataset.esperaMs = fObj?.esperaNaCabecaMs || 0;
                } else if (g.id === `cabeca_f${fNum}`) {
                    g.removeAttribute("id");
                }

                let fillCor = CORES[`fila${fNum}`] || "#ef4444";
                let strokeCor = "none";
                let strokeW = "0";

                if (ehCabeca) {
                    if (fNum === 1) { fillCor = CORES.cabecaF1; strokeCor = "#15803d"; strokeW = "2"; }
                    else if (fNum === 2) { fillCor = CORES.cabecaF2; strokeCor = "#be185d"; strokeW = "2"; }
                    else if (fNum === 3) { fillCor = CORES.cabecaF3; strokeCor = "#c2410c"; strokeW = "2"; }
                }

                const opacidadeFinal = this.destaqueFila && this.destaqueFila !== fNum ? "0.35" : "1";

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

                if (animar) {
                    const dur = novo ? this.duracaoChegada : this.duracaoAvanco;
                    g.style.transition = `transform ${dur}s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s ease`;
                } else {
                    g.style.transition = "none";
                }
                g.style.opacity = opacidadeFinal;
                g.setAttribute("transform", `translate(${pt.x}, ${pt.y})`);

                if (novo && animar && fNum === 2) {
                    g.style.transition = "none";
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

        // Remove nós ausentes da fila
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

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", pt.x - badgeW / 2);
        rect.setAttribute("y", pt.y - badgeH / 2);
        rect.setAttribute("width", badgeW);
        rect.setAttribute("height", badgeH);
        rect.setAttribute("rx", "8");
        rect.setAttribute("fill", "#475569");
        g.appendChild(rect);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", pt.x);
        text.setAttribute("y", pt.y + 4);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
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
            this.renderizarEstado(this.estadoAtual, false);
        }
    }

    destruir() {
        if (this.timerPulso) clearInterval(this.timerPulso);
        if (this.timerAvanco) clearTimeout(this.timerAvanco);
        if (this.resizeObserver) this.resizeObserver.disconnect();
    }
}
