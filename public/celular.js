/**
 * public/celular.js
 * Lógica do cliente de coleta em smartphone para o Restaurante Universitário.
 * Suporta seleção de área (Fila 1, Fila 2, Fila 3, Fila 1+2 ou Modo Apoio),
 * encadeamento automático da catraca, ajuste de fila, reconexão imediata e wake lock.
 */

import { GerenciadorConexao } from "./conexao.js";
import { AnimadorFila } from "./animacao.js";
import { formatarDuracao } from "../shared/metricas.js";

// Encadeamento automático Fila 2 -> Fila 3 quando ambas estão ativas
export const ENCADEAR_FILA3 = true;

// Sintetizador Web Audio para cliques e bipes táteis sem dependências externas
const AudioClick = {
    ctx: null,
    init() {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    tocar(freq = 600, dur = 0.08) {
        try {
            this.init();
            if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(
                0.001,
                this.ctx.currentTime + dur,
            );
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + dur);
        } catch (e) {}
    },
};

const CelularApp = {
    conexao: null,
    animador: null,
    estado: null,
    sessao: null,
    ultimoToqueMs: 0,
    intervaloMinToqueMs: 220,
    animacaoAtiva: true,
    timerHud: null,
    wakeLockObj: null,

    // Preferências locais
    prefSom: true,
    prefVibracao: true,
    prefWakeLock: true,

    init() {
        // Carrega preferências salvas
        this.prefSom = localStorage.getItem("ru_pref_som") !== "false";
        this.prefVibracao =
            localStorage.getItem("ru_pref_vibracao") !== "false";
        this.prefWakeLock =
            localStorage.getItem("ru_pref_wakelock") !== "false";
        this.animacaoAtiva =
            localStorage.getItem("ru_pref_animacao") !== "false";

        // Lê parâmetros da URL (ex: ?fila=2)
        const urlParams = new URLSearchParams(window.location.search);
        const filaUrl = urlParams.get("fila");

        // Inicia Animador com o esquema fixo do RU
        this.animador = new AnimadorFila("container-animacao");

        // Inicializa Gerenciador de Conexão
        this.conexao = new GerenciadorConexao({
            onEstado: (estado, sessao) => this.atualizarEstado(estado, sessao),
            onNovoEvento: (evento, estado, diff) => {
                this.atualizarEstado(estado);
                if (this.animador) this.animador.renderizarEstado(estado);
                this.notificarNovoEvento(evento);
            },
            onSessaoIniciada: (sessao, estado) => {
                this.sessao = sessao;
                this.atualizarEstado(estado);
                this.mostrarToast(`Sessão iniciada: ${sessao.nome}`, "🟢");
            },
            onSessaoEncerrada: (sessao, estado) => {
                this.sessao = null;
                this.atualizarEstado(estado);
                this.mostrarToast("Sessão encerrada pelo painel.", "⏹");
            },
            onStatusConexao: (status, pendentesQtd) =>
                this.atualizarStatusConexao(status, pendentesQtd),
            onComandoResposta: (res) => {
                if (!res.sucesso) {
                    if (this.prefSom) AudioClick.tocar(320, 0.2);
                    this.mostrarToast(`⚠️ Rejeitado: ${res.mensagem}`, "❌");
                }
            },
            onAreaAtualizada: (novaArea) => {
                this.mostrarToast(
                    `Área alterada pelo painel: Fila ${novaArea}`,
                    "ℹ️",
                );
                this.atualizarInterfaceArea();
                if (this.estado) this.renderizarCartoes();
            },
        });

        if (filaUrl && ["1", "2", "3"].includes(filaUrl)) {
            this.conexao.dispositivo.area = filaUrl;
            localStorage.setItem(
                "ru_fila_disp_info_v2",
                JSON.stringify(this.conexao.dispositivo),
            );
        }

        // Gerencia WakeLock para manter tela ligada
        if (this.prefWakeLock) {
            this.ativarWakeLock();
        }

        // Conecta imediatamente com credenciais salvas em localStorage
        this.conexao.conectar();

        // Timer do HUD
        this.timerHud = setInterval(() => this.atualizarTimerHud(), 1000);

        this.atualizarInterfaceArea();
    },

    async ativarWakeLock() {
        if ("wakeLock" in navigator) {
            try {
                this.wakeLockObj = await navigator.wakeLock.request("screen");
                console.log("[WAKELOCK] Screen Wake Lock ativo.");
                this.wakeLockObj.addEventListener("release", () => {
                    this.wakeLockObj = null;
                });
            } catch (e) {
                this.ativarFallbackWakeLock();
            }
        } else {
            this.ativarFallbackWakeLock();
        }
    },

    ativarFallbackWakeLock() {
        // Fallback: vídeo mudo em loop com canvas ou video sem rede
        const v = document.getElementById("video-wakelock-fallback");
        if (v) {
            try {
                v.src =
                    "data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAADpmcmVlAAAABG1kYXQ=";
                v.play().catch(() => {});
            } catch (e) {}
        }
    },

    desativarWakeLock() {
        if (this.wakeLockObj) {
            try {
                this.wakeLockObj.release();
                this.wakeLockObj = null;
            } catch (e) {}
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

    darFeedback(tipo = "chegada") {
        if (this.prefVibracao && navigator.vibrate) {
            navigator.vibrate(tipo === "chegada" ? 35 : 55);
        }
        if (this.prefSom) {
            AudioClick.tocar(tipo === "chegada" ? 580 : 820, 0.08);
        }
    },

    mostrarToast(mensagem, icone = "🟢") {
        const toast = document.getElementById("toast-feedback");
        if (!toast) return;
        document.getElementById("toast-icone").textContent = icone;
        document.getElementById("toast-msg").textContent = mensagem;
        toast.classList.remove("flash");
        void toast.offsetWidth;
        toast.classList.add("flash");
    },

    atualizarStatusConexao(status, pendentesQtd = 0) {
        const badge = document.getElementById("badge-conexao");
        const txt = document.getElementById("txt-conexao");
        if (!badge || !txt) return;

        badge.className = "status-badge";

        if (status === "conectado") {
            badge.classList.add("online");
            txt.textContent =
                pendentesQtd > 0
                    ? `Online (${pendentesQtd} pend.)`
                    : "Conectado";
        } else if (status === "reconectando") {
            badge.classList.add("reconnecting");
            txt.textContent =
                pendentesQtd > 0
                    ? `Reconectando (${pendentesQtd})`
                    : "Reconectando...";
        } else {
            badge.classList.add("offline");
            txt.textContent =
                pendentesQtd > 0
                    ? `Offline (${pendentesQtd} pend.)`
                    : "Desconectado";
        }
    },

    atualizarInterfaceArea() {
        const area = this.conexao.dispositivo.area || "1";
        const banner = document.getElementById("banner-area-atual");
        const lbl = document.getElementById("lbl-area-atual");
        const boxApoio = document.getElementById("box-modo-apoio");

        banner.className = "area-badge-banner";

        if (area === "apoio" || area === "sem_area") {
            banner.classList.add("area-apoio");
            lbl.textContent = "Modo Apoio (Sem área de coleta)";
            boxApoio.style.display = "block";
            if (this.animador) this.animador.definirDestaqueFila(null);
        } else if (area === "1,2") {
            banner.classList.add("area-f1");
            lbl.textContent = "Coleta Dupla: Filas 1 e 2";
            boxApoio.style.display = "none";
            if (this.animador) this.animador.definirDestaqueFila(null);
        } else {
            const fNum = Number(area);
            banner.classList.add(`area-f${fNum}`);
            const nomes = {
                1: "Fila 1 (Entrada → Catraca)",
                2: "Fila 2 (Catraca → Mesas)",
                3: "Fila 3 (Mesas → Saída)",
            };
            lbl.textContent = `Área: ${nomes[fNum] || `Fila ${fNum}`}`;
            boxApoio.style.display = "none";
            if (this.animador) this.animador.definirDestaqueFila(fNum);
        }
    },

    obterFilasDesignadas() {
        const area = this.conexao.dispositivo.area || "1";
        if (area === "apoio" || area === "sem_area") return [];
        if (area === "1,2") return [1, 2];
        if (area === "todas") return [1, 2, 3];
        const n = Number(area);
        return isNaN(n) ? [1] : [n];
    },

    atualizarEstado(estado, sessao = null) {
        if (sessao) this.sessao = sessao;
        if (!estado) return;
        this.estado = estado;

        // Atualiza HUD compacto
        const designadas = this.obterFilasDesignadas();
        const fRef = designadas[0] || 1;
        const fObj = estado.filas?.[fRef] || estado.filas?.[1];

        if (fObj) {
            document.getElementById("hud-fila").textContent =
                fObj.contadores.naFila;
            document.getElementById("hud-atendidos").textContent =
                fObj.contadores.atendidas;
            document.getElementById("hud-chegadas").textContent =
                fObj.contadores.chegadas;
        }

        // Renderiza os cartões das filas designadas
        this.renderizarCartoes();

        // Atualiza animação visual completa
        if (this.animador && this.animacaoAtiva) {
            this.animador.renderizarEstado(estado);
        }
    },

    renderizarCartoes() {
        const container = document.getElementById("container-cartoes-filas");
        container.innerHTML = "";

        const designadas = this.obterFilasDesignadas();
        if (designadas.length === 0) {
            // Modo apoio: sem cartões
            return;
        }

        const filasAtivas = this.estado?.filasAtivas || [1];

        for (const fNum of designadas) {
            const fObj = this.estado?.filas?.[fNum];
            if (!fObj) continue;

            const card = document.createElement("div");
            card.className = `cartao-fila f${fNum}`;

            const nomesFilas = {
                1: "Fila 1 (Entrada → Catraca)",
                2: "Fila 2 (Catraca → Mesas)",
                3: "Fila 3 (Mesas → Saída)",
            };

            const cabecaPessoa = fObj.primeiraDaFila;
            const temGente = cabecaPessoa !== null;
            const fila1Ativa =
                filasAtivas.includes(1) &&
                this.estado?.filas?.[1]?.ativa !== false;

            // Cabeçalho do cartão com estatísticas e botão de ajuste
            let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
                <strong style="font-size:0.95rem;">${nomesFilas[fNum]}</strong>
                <span style="font-size:0.75rem; color:var(--text-muted); display:block;">
                Na fila: <strong>${fObj.contadores.naFila}</strong> | Saídas: <strong>${fObj.contadores.atendidas}</strong>
                </span>
            </div>
            <button class="btn btn-secondary" style="padding:3px 8px; font-size:0.75rem;" onclick="CelularApp.abrirModalAjuste(${fNum})">
                ⚖️ Ajustar Fila
            </button>
            </div>
        `;

            // Botões de Coleta específicos para a Fila
            html += `<div class="collection-buttons" style="margin-bottom:8px;">`;

            if (fNum === 1) {
                // Fila 1: CHEGADA e PASSOU NA CATRACA
                html += `
            <button class="big-btn chegada" onclick="CelularApp.registrarChegada(1)">
                <span class="big-btn-title">CHEGADA</span>
                <span class="big-btn-subtitle">+1 Pessoa na Fila</span>
                <span class="big-btn-counter">Total: ${fObj.contadores.chegadas}</span>
            </button>

            <button class="big-btn atendimento" onclick="CelularApp.registrarAtendimento(1)" ${temGente ? "" : "disabled"}>
                <span class="big-btn-title">PASSOU NA CATRACA</span>
                <span class="big-btn-subtitle">${temGente ? `próxima: Pessoa ${cabecaPessoa}` : "Fila Vazia"}</span>
                <span class="big-btn-counter">Total: ${fObj.contadores.atendidas}</span>
            </button>
            `;
            } else if (fNum === 2) {
                // Fila 2:
                // Se Fila 1 estiver ativa, a entrada é automática via catraca da Fila 1!
                if (fila1Ativa) {
                    html += `
                <div style="grid-column: 1 / -1; background:rgba(34,197,94,0.1); border:1px solid #22c55e; padding:6px 10px; border-radius:8px; font-size:0.78rem; color:#16a34a; margin-bottom:6px; text-align:center;">
                ℹ️ Entradas geradas automaticamente pela confirmação da catraca (Fila 1).
                </div>
                <button class="big-btn atendimento" style="grid-column: 1 / -1;" onclick="CelularApp.registrarAtendimento(2)" ${temGente ? "" : "disabled"}>
                <span class="big-btn-title">CHEGOU ÀS MESAS</span>
                <span class="big-btn-subtitle">${temGente ? `próxima: Pessoa ${cabecaPessoa}` : "Fila Vazia"}</span>
                <span class="big-btn-counter">Total: ${fObj.contadores.atendidas}</span>
                </button>
            `;
                } else {
                    // Fila 1 inativa: operador da Fila 2 registra ambas as pontas
                    html += `
                <button class="big-btn chegada" onclick="CelularApp.registrarChegada(2)">
                <span class="big-btn-title">PASSOU NA CATRACA</span>
                <span class="big-btn-subtitle">+1 na Fila 2</span>
                <span class="big-btn-counter">Total: ${fObj.contadores.chegadas}</span>
                </button>

                <button class="big-btn atendimento" onclick="CelularApp.registrarAtendimento(2)" ${temGente ? "" : "disabled"}>
                <span class="big-btn-title">CHEGOU ÀS MESAS</span>
                <span class="big-btn-subtitle">${temGente ? `próxima: Pessoa ${cabecaPessoa}` : "Fila Vazia"}</span>
                <span class="big-btn-counter">Total: ${fObj.contadores.atendidas}</span>
                </button>
            `;
                }
            } else if (fNum === 3) {
                // Fila 3:
                // Se Fila 2 estiver ativa e ENCADEAR_FILA3 for true, a entrada é gerada automaticamente pela chegada às mesas (Fila 2)
                const fila2Ativa =
                    filasAtivas.includes(2) &&
                    this.estado?.filas?.[2]?.ativa !== false;

                if (ENCADEAR_FILA3 && fila2Ativa) {
                    html += `
                <div style="grid-column: 1 / -1; background:rgba(236,72,153,0.1); border:1px solid #ec4899; padding:6px 10px; border-radius:8px; font-size:0.78rem; color:#db2777; margin-bottom:6px; text-align:center;">
                ℹ️ Entradas geradas automaticamente pela chegada às mesas (Fila 2).
                </div>
                <button class="big-btn atendimento" style="grid-column: 1 / -1;" onclick="CelularApp.registrarAtendimento(3)" ${temGente ? "" : "disabled"}>
                <span class="big-btn-title">PASSOU NA SAÍDA</span>
                <span class="big-btn-subtitle">${temGente ? `próxima: Pessoa ${cabecaPessoa}` : "Fila Vazia"}</span>
                <span class="big-btn-counter">Total: ${fObj.contadores.atendidas}</span>
                </button>
            `;
                } else {
                    // Fila 2 inativa ou sem encadeamento: operador registra ambas as pontas
                    html += `
                <button class="big-btn chegada" onclick="CelularApp.registrarChegada(3)">
                <span class="big-btn-title">SAIU DAS MESAS</span>
                <span class="big-btn-subtitle">+1 na Fila 3</span>
                <span class="big-btn-counter">Total: ${fObj.contadores.chegadas}</span>
                </button>

                <button class="big-btn atendimento" onclick="CelularApp.registrarAtendimento(3)" ${temGente ? "" : "disabled"}>
                <span class="big-btn-title">PASSOU NA SAÍDA</span>
                <span class="big-btn-subtitle">${temGente ? `próxima: Pessoa ${cabecaPessoa}` : "Fila Vazia"}</span>
                <span class="big-btn-counter">Total: ${fObj.contadores.atendidas}</span>
                </button>
            `;
                }
            }

            html += `</div>`;

            // Tags das pessoas atualmente nesta fila
            html += `
            <div style="background:var(--bg-subtle); border-radius:8px; padding:6px 8px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; font-size:0.75rem;">
                <span>Pessoas nesta fila (${fObj.fila.length})</span>
                ${
                    fObj.fila.length > 0
                        ? `
                <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.7rem; color:var(--danger);" onclick="CelularApp.removerUltimaChegada(${fNum})">
                    ✕ Remover Última
                </button>
                `
                        : ""
                }
            </div>
            <div class="lista-fila-compacta" id="lista-tags-f${fNum}">
                ${fObj.fila.length === 0 ? '<span style="font-size:0.75rem; color:var(--text-muted)">Fila vazia</span>' : ""}
            </div>
            </div>
        `;

            // Botão de Reversão do último atendimento desta fila
            html += `
            <div style="display:flex; justify-content:flex-end;">
            <button class="btn btn-secondary" style="padding:4px 10px; font-size:0.78rem;" onclick="CelularApp.reverterUltimoAtendimento(${fNum})">
                ↩ Reverter Último Atendimento
            </button>
            </div>
        `;

            card.innerHTML = html;
            container.appendChild(card);

            // Preenche as tags da fila
            const tagsBox = document.getElementById(`lista-tags-f${fNum}`);
            if (tagsBox && fObj.fila.length > 0) {
                tagsBox.innerHTML = "";
                fObj.fila.forEach((pId, idx) => {
                    const tag = document.createElement("span");
                    tag.className = `tag-pessoa ${idx === 0 ? "primeira" : ""}`;
                    tag.innerHTML = `
                <span>${idx === 0 ? "Cabeça: " : ""}Pessoa ${pId}</span>
                <button class="btn-anular-tag" title="Anular Pessoa ${pId}" onclick="CelularApp.anularPessoa(${fNum}, ${pId})">×</button>
            `;
                    tagsBox.appendChild(tag);
                });
            }
        }
    },

    atualizarTimerHud() {
        if (!this.sessao || !this.sessao.inicioMs) {
            document.getElementById("hud-tempo").textContent = "00:00";
            return;
        }
        const decorrido = Date.now() - this.sessao.inicioMs;
        document.getElementById("hud-tempo").textContent =
            formatarDuracao(decorrido).substring(3);
    },

    notificarNovoEvento(evento) {
        const f = evento.fila || 1;
        if (evento.tipo === "chegada") {
            this.mostrarToast(
                `[Fila ${f}] Pessoa ${evento.pessoa} ENTROU`,
                "👥",
            );
        } else if (evento.tipo === "atendimento") {
            this.mostrarToast(
                `[Fila ${f}] Pessoa ${evento.pessoa} ATENDIDA`,
                "🍽️",
            );
        } else if (evento.tipo === "anulacao") {
            this.mostrarToast(
                `[Fila ${f}] Pessoa ${evento.pessoa} ANULADA`,
                "❌",
            );
        } else if (evento.tipo === "reversao") {
            this.mostrarToast(
                `[Fila ${f}] Atendimento de Pessoa ${evento.pessoa} REVERTIDO`,
                "↩",
            );
        } else if (evento.tipo === "fila_desativada") {
            this.mostrarToast(`Fila ${f} foi DESATIVADA`, "⚠️");
        }
    },

    registrarChegada(filaNum) {
        if (!this.verificarDebounce()) return;
        this.darFeedback("chegada");
        this.conexao.enviarComando({
            acao: "chegada",
            fila: filaNum,
        });
        this.mostrarToast(`Chegada registrada na Fila ${filaNum}...`, "⏳");
    },

    registrarAtendimento(filaNum) {
        if (!this.verificarDebounce()) return;
        const fObj = this.estado?.filas?.[filaNum];
        if (!fObj || fObj.primeiraDaFila === null) {
            alert("A fila está vazia no momento.");
            return;
        }

        const pessoaEsperada = fObj.primeiraDaFila;
        this.darFeedback("atendimento");
        this.conexao.enviarComando({
            acao: "atendido",
            fila: filaNum,
            pessoaEsperada,
        });
        this.mostrarToast(
            `Confirmando saída da Pessoa ${pessoaEsperada} na Fila ${filaNum}...`,
            "⏳",
        );
    },

    anularPessoa(filaNum, pessoaId) {
        if (
            !confirm(
                `Deseja anular a Pessoa ${pessoaId} da Fila ${filaNum}? Ela não entrará nas métricas.`,
            )
        ) {
            return;
        }
        this.conexao.enviarComando({
            acao: "anulacao",
            fila: filaNum,
            pessoa: pessoaId,
        });
        this.mostrarToast(
            `Solicitação de anulação da Pessoa ${pessoaId} enviada...`,
            "⏳",
        );
    },

    removerUltimaChegada(filaNum) {
        const fObj = this.estado?.filas?.[filaNum];
        if (!fObj || fObj.fila.length === 0) {
            alert("Nenhuma pessoa na fila para remover.");
            return;
        }
        const ultima = fObj.fila[fObj.fila.length - 1];
        this.anularPessoa(filaNum, ultima);
    },

    reverterUltimoAtendimento(filaNum) {
        if (
            !confirm(
                `Deseja reverter o último atendimento confirmado na Fila ${filaNum}? A pessoa retornará à cabeça da fila.`,
            )
        ) {
            return;
        }
        this.conexao.enviarComando({
            acao: "reversao",
            fila: filaNum,
        });
        this.mostrarToast(`Reversão na Fila ${filaNum} enviada...`, "⏳");
    },

    // Ajuste de Fila
    abrirModalAjuste(filaPreSelecionada = null) {
        const sel = document.getElementById("ajuste-fila-sel");
        if (filaPreSelecionada) {
            sel.value = String(filaPreSelecionada);
        } else {
            const designadas = this.obterFilasDesignadas();
            sel.value = String(designadas[0] || 1);
        }

        const fNum = Number(sel.value);
        const atual = this.estado?.filas?.[fNum]?.fila.length || 0;
        document.getElementById("ajuste-qtd-real").value = atual;

        this.calcularPrevisaoAjuste();
        document.getElementById("modal-ajuste").classList.add("open");
    },

    calcularPrevisaoAjuste() {
        const fNum = Number(document.getElementById("ajuste-fila-sel").value);
        const qtdReal = Math.max(
            0,
            parseInt(document.getElementById("ajuste-qtd-real").value, 10) || 0,
        );
        const tamAtual = this.estado?.filas?.[fNum]?.fila.length || 0;
        const box = document.getElementById("ajuste-previsao-box");

        if (qtdReal === tamAtual) {
            box.innerHTML = `A quantidade informada (${qtdReal}) é <strong>idêntica</strong> ao estado atual do sistema. Nenhuma alteração necessária.`;
            box.style.color = "#94a3b8";
        } else if (qtdReal < tamAtual) {
            const diff = tamAtual - qtdReal;
            box.innerHTML = `<span style="color:var(--danger)">⚠️ Fila diminuirá:</span> Serão <strong>anuladas ${diff} pessoas da cabeça da fila</strong> (presumindo que passaram durante a lacuna).`;
        } else {
            const diff = qtdReal - tamAtual;
            box.innerHTML = `<span style="color:var(--success)">➕ Fila aumentará:</span> Serão <strong>adicionadas ${diff} pessoas na cauda da fila</strong>.`;
        }
    },

    confirmarAjusteFila() {
        const fNum = Number(document.getElementById("ajuste-fila-sel").value);
        const qtdReal = Math.max(
            0,
            parseInt(document.getElementById("ajuste-qtd-real").value, 10) || 0,
        );

        this.conexao.enviarComando({
            acao: "ajuste_fila",
            fila: fNum,
            quantidadeReal: qtdReal,
        });

        this.fecharModais();
        this.mostrarToast(
            `Ajuste da Fila ${fNum} para ${qtdReal} pessoas enviado.`,
            "⚖️",
        );
    },

    // Modal Anotação
    abrirModalAnotacao() {
        document.getElementById("txt-anotacao").value = "";
        document.getElementById("modal-anotacao").classList.add("open");
        setTimeout(() => document.getElementById("txt-anotacao").focus(), 150);
    },

    preencherAnotacao(texto) {
        document.getElementById("txt-anotacao").value = texto;
    },

    enviarAnotacao() {
        const texto = document.getElementById("txt-anotacao").value.trim();
        if (!texto) return;

        const designadas = this.obterFilasDesignadas();
        const fNum = designadas[0] || null;

        this.conexao.enviarComando({
            acao: "anotacao",
            fila: fNum,
            texto,
        });

        this.fecharModais();
        this.mostrarToast(`Anotação registrada: "${texto}"`, "📝");
    },

    // Configurações e Áreas
    abrirModalConfig() {
        document.getElementById("cfg-pin").value = this.conexao.pin || "1234";
        document.getElementById("cfg-nome").value =
            this.conexao.dispositivo.nome || "Celular 1";
        document.getElementById("cfg-area").value =
            this.conexao.dispositivo.area || "1";

        document.getElementById("cfg-wakelock").checked = this.prefWakeLock;
        document.getElementById("cfg-som").checked = this.prefSom;
        document.getElementById("cfg-vibracao").checked = this.prefVibracao;
        document.getElementById("cfg-mostrar-animacao").checked =
            this.animacaoAtiva;

        document.getElementById("modal-config").classList.add("open");
    },

    salvarConfiguracoes() {
        const pin = document.getElementById("cfg-pin").value.trim() || "1234";
        const nome =
            document.getElementById("cfg-nome").value.trim() || "Celular";
        const area = document.getElementById("cfg-area").value;

        this.prefWakeLock = document.getElementById("cfg-wakelock").checked;
        this.prefSom = document.getElementById("cfg-som").checked;
        this.prefVibracao = document.getElementById("cfg-vibracao").checked;
        this.animacaoAtiva = document.getElementById(
            "cfg-mostrar-animacao",
        ).checked;

        localStorage.setItem("ru_pref_wakelock", String(this.prefWakeLock));
        localStorage.setItem("ru_pref_som", String(this.prefSom));
        localStorage.setItem("ru_pref_vibracao", String(this.prefVibracao));
        localStorage.setItem("ru_pref_animacao", String(this.animacaoAtiva));

        if (this.prefWakeLock) this.ativarWakeLock();
        else this.desativarWakeLock();

        document.getElementById("box-mini-animacao").style.display = this
            .animacaoAtiva
            ? "block"
            : "none";

        this.conexao.salvarCredenciais(pin, nome, area, "ambos");
        this.conexao.mudarArea(area);

        this.atualizarInterfaceArea();
        if (this.estado) this.renderizarCartoes();

        this.fecharModais();
        this.mostrarToast("Configurações salvas e aplicadas.", "⚙️");
    },

    selecionarAreaDireta(areaNum) {
        this.conexao.mudarArea(String(areaNum));
        this.atualizarInterfaceArea();
        if (this.estado) this.renderizarCartoes();
        this.mostrarToast(`Área alterada para Fila ${areaNum}`, "🟢");
    },

    forcarReconexao() {
        this.fecharModais();
        this.mostrarToast("Reconectando ao servidor...", "🔄");
        this.conexao.reconectarImediatamente();
    },

    toggleAnimacao() {
        this.animacaoAtiva = !this.animacaoAtiva;
        document.getElementById("box-mini-animacao").style.display = this
            .animacaoAtiva
            ? "block"
            : "none";
        document.getElementById("btn-toggle-animacao").textContent = this
            .animacaoAtiva
            ? "Ocultar"
            : "Mostrar";
        localStorage.setItem("ru_pref_animacao", String(this.animacaoAtiva));
    },

    fecharModais() {
        document
            .querySelectorAll(".modal-backdrop")
            .forEach((m) => m.classList.remove("open"));
    },
};

window.CelularApp = CelularApp;
document.addEventListener("DOMContentLoaded", () => CelularApp.init());
