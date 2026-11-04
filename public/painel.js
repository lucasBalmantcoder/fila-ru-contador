/**
 * public/painel.js
 * Lógica do painel de monitoramento do notebook (tela larga para projeção).
 * Acompanha até 3 filas simultâneas com indicadores de cobertura e delegação de aparelhos.
 *
 * Encadeamento de filas:
 * - F1 → F2: a passagem na catraca (saída da F1) gera a entrada na F2.
 * - F2 → F3: a chegada às mesas (saída da F2) gera a entrada na F3.
 * Nas filas encadeadas, o aparelho coleta apenas a saída da fila.
 */

import { GerenciadorConexao } from "./conexao.js";
import { AnimadorFila } from "./animacao.js";
import {
    formatarDuracao,
    formatarHoraLocal,
    formatarNumero,
    calcularCoberturaPorFila,
} from "../shared/metricas.js";

const PainelApp = {
    conexao: null,
    animador: null,
    estado: null,
    sessao: null,
    aparelhos: [],
    eventos: [],
    rejeitados: [],
    filaMaxAtingida: 0,
    ultimoAtendimentoTempo: Date.now(),
    limiarAlertaOciosoSeg: 120,
    timerHud: null,
    infoServidor: null,
    qrTabAtual: "geral",
    statusConexaoAtual: "desconectado",
    ultimaAtualizacaoTempo: Date.now(),

    async init() {
        this.animador = new AnimadorFila("container-animacao-painel");

        await this.carregarInfoServidor();

        this.conexao = new GerenciadorConexao({
            papel: "painel",
            onEstado: (estado, sessao) => {
                this.sessao = sessao;
                this.ultimaAtualizacaoTempo = Date.now();
                this.atualizarEstado(estado);
                if (this.animador)
                    this.animador.renderizarEstado(estado, false);
            },
            onNovoEvento: (evento, estado, diff) => {
                this.eventos.unshift(evento);
                this.ultimaAtualizacaoTempo = Date.now();
                this.atualizarEstado(estado);
                if (this.animador) this.animador.aplicarOperacoes(diff, estado);
                this.renderizarTabelaEventos();

                if (evento.tipo === "atendimento" || evento.tipo === "saida") {
                    this.ultimoAtendimentoTempo = Date.now();
                }
            },
            onSessaoIniciada: (sessao, estado, evento) => {
                this.sessao = sessao;
                if (evento) this.eventos.unshift(evento);
                this.atualizarEstado(estado);
                this.atualizarControlesSessao();
                this.renderizarTabelaEventos();
            },
            onSessaoEncerrada: (sessao, estado, evento) => {
                this.sessao = null;
                if (evento) this.eventos.unshift(evento);
                this.atualizarEstado(estado);
                this.atualizarControlesSessao();
                this.renderizarTabelaEventos();
            },
            onListaAparelhos: (aparelhos) => {
                this.aparelhos = aparelhos || [];
                this.renderizarListaAparelhos(this.aparelhos);
                this.renderizarFilasMonitor();
            },
            onStatusConexao: (status) => this.atualizarStatusConexao(status),
            onComandoRejeitado: (rejeicao) => {
                this.rejeitados.unshift(rejeicao);
                this.renderizarTabelaRejeitados();
            },
        });

        const pin = (this.infoServidor && this.infoServidor.pin) || "1234";
        this.conexao.salvarCredenciais(pin, "Painel Notebook", "todas");
        this.conexao.conectar();

        this.timerHud = setInterval(() => this.atualizarLoopHud(), 1000);
    },

    async carregarInfoServidor() {
        try {
            const resp = await fetch("/api/info");
            const dados = await resp.json();
            this.infoServidor = dados;

            document.getElementById("txt-pin-display").textContent =
                dados.pin || "1234";
            document.getElementById("txt-url-display").textContent =
                dados.urlCelular;

            this.selecionarQrTab("geral");

            if (dados.sessaoAtiva) {
                this.sessao = dados.sessaoAtiva;
                this.atualizarControlesSessao();
            }
        } catch (e) {
            console.warn("Erro ao carregar dados do servidor:", e);
        }
    },

    selecionarQrTab(tab) {
        this.qrTabAtual = tab;
        document.querySelectorAll(".tab-qr-btn").forEach((b) => {
            b.classList.toggle("active", b.id === `btn-qr-${tab}`);
        });

        if (!this.infoServidor) return;

        const img = document.getElementById("img-qrcode");
        const urlTxt = document.getElementById("txt-url-display");

        if (tab === "geral") {
            img.src = this.infoServidor.qrDataUrl || "";
            urlTxt.textContent = this.infoServidor.urlCelular || "";
        } else {
            const qrFila =
                (this.infoServidor.qrPorFila &&
                    this.infoServidor.qrPorFila[tab]) ||
                this.infoServidor.qrDataUrl;
            const urlFila =
                (this.infoServidor.urlPorFila &&
                    this.infoServidor.urlPorFila[tab]) ||
                `${this.infoServidor.urlCelular}?fila=${tab}`;
            img.src = qrFila || "";
            urlTxt.textContent = urlFila;
        }
    },

    atualizarStatusConexao(status) {
        this.statusConexaoAtual = status;
        const badge = document.getElementById("badge-conexao");
        const txt = document.getElementById("txt-conexao");
        if (!badge || !txt) return;

        badge.className = "status-badge";

        if (status === "conectado") {
            badge.classList.add("online");
            txt.textContent = "Ao vivo";
            this.ultimaAtualizacaoTempo = Date.now();
        } else if (status === "reconectando") {
            badge.classList.add("reconectando");
            txt.textContent = "Reconectando…";
        } else if (status === "polling") {
            badge.classList.add("polling");
            const seg = Math.max(
                0,
                Math.round((Date.now() - this.ultimaAtualizacaoTempo) / 1000),
            );
            txt.textContent = `Sem conexão, atualizando por consulta (há ${seg} s)`;
        } else {
            badge.classList.add("offline");
            const seg = Math.max(
                0,
                Math.round((Date.now() - this.ultimaAtualizacaoTempo) / 1000),
            );
            txt.textContent = `Sem conexão, atualizando por consulta (há ${seg} s)`;
        }
    },

    atualizarEstado(estado) {
        if (!estado) return;
        this.estado = estado;

        const f1 = estado.filas ? estado.filas["1"] : null;
        const f1Count = f1
            ? f1.fila.length
            : estado.fila
              ? estado.fila.length
              : 0;
        if (f1Count > this.filaMaxAtingida) {
            this.filaMaxAtingida = f1Count;
        }

        document.getElementById("kpi-fila").textContent = f1Count;
        document.getElementById("kpi-fila-max").textContent =
            this.filaMaxAtingida;
        document.getElementById("kpi-atendidos").textContent = f1
            ? f1.atendidas
            : estado.contadores.atendidas;
        document.getElementById("kpi-chegadas").textContent = f1
            ? f1.chegadas
            : estado.contadores.chegadas;
        document.getElementById("kpi-anulados").textContent =
            estado.contadores.anuladas;

        document.getElementById("kpi-vazao").innerHTML =
            `${formatarNumero(estado.vazaoRecente, 1)} <span style="font-size:0.8rem">p/min</span>`;
        document.getElementById("kpi-ultimo-int").textContent =
            estado.ultimoIntervaloSeg !== null
                ? `${formatarNumero(estado.ultimoIntervaloSeg, 1)} s`
                : "-- s";

        this.renderizarFilasMonitor();
    },

    renderizarFilasMonitor() {
        const grid = document.getElementById("grid-filas-monitor");
        const lblEncadeamento = document.getElementById(
            "lbl-status-encadeamento",
        );
        if (!grid) return;

        const ativas = (this.estado && this.estado.filasAtivas) ||
            (this.sessao && this.sessao.filasAtivas) || [1];
        const desativadas = (this.estado && this.estado.filasDesativadas) || [];
        const filasObj = (this.estado && this.estado.filas) || {};

        const f1Ativa = ativas.includes(1) && !desativadas.includes(1);
        const f2Ativa = ativas.includes(2) && !desativadas.includes(2);
        const f3Ativa = ativas.includes(3) && !desativadas.includes(3);

        // Encadeamentos: F1→F2 (catraca) e F2→F3 (mesas)
        const encadeada = {
            2: f1Ativa && f2Ativa,
            3: f2Ativa && f3Ativa,
        };

        if (lblEncadeamento) {
            const avisos = [];
            if (encadeada[2]) {
                avisos.push(
                    "🔗 Fila 1 e 2 encadeadas: catraca (F1) gera entrada na F2 automaticamente.",
                );
            }
            if (encadeada[3]) {
                avisos.push(
                    "🔗 Fila 2 e 3 encadeadas: chegada às mesas (F2) gera entrada na F3 automaticamente.",
                );
            }
            lblEncadeamento.textContent = avisos.join(" ");
        }

        const configsFilas = [
            {
                num: 1,
                nome: "Fila 1 (Entrada → Catraca)",
                cls: "f1",
                cor: "#dc2626",
            },
            {
                num: 2,
                nome: "Fila 2 (Catraca → Atendimento → Mesas)",
                cls: "f2",
                cor: "#16a34a",
            },
            {
                num: 3,
                nome: "Fila 3 (Mesas → Saída)",
                cls: "f3",
                cor: "#ec4899",
            },
        ];

        let html = "";

        configsFilas.forEach((cfg) => {
            const isAtiva = ativas.includes(cfg.num);
            const isDesativada = desativadas.includes(cfg.num);
            const dados = filasObj[String(cfg.num)] || {
                fila: [],
                atendidas: 0,
                chegadas: 0,
            };
            const herdaEntrada = !!encadeada[cfg.num];

            // Aparelhos cobrindo esta fila
            const aparelhosFila = this.aparelhos.filter((a) => {
                const p = a.papel || "apoio";
                if (p === "apoio") return false;
                if (p === "todas") return true;
                if (p === "ambas" && (cfg.num === 1 || cfg.num === 2))
                    return true;
                if (p === `fila${cfg.num}`) return true;
                return false;
            });

            const qtdAparelhos = aparelhosFila.length;
            const semAparelhos = isAtiva && !isDesativada && qtdAparelhos === 0;

            let statusBadge = "";
            if (!isAtiva) {
                statusBadge =
                    '<span style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">(Não selecionada)</span>';
            } else if (isDesativada) {
                statusBadge =
                    '<span style="font-size:0.75rem; color:var(--danger); font-weight:700;">(Desativada)</span>';
            } else {
                statusBadge =
                    '<span style="font-size:0.75rem; color:var(--success); font-weight:700;">● Em Coleta</span>';
            }

            let notaEncadeamento = "";
            if (cfg.num === 2 && herdaEntrada) {
                notaEncadeamento =
                    "Entrada herdada da F1 (catraca) • coleta só as chegadas às mesas";
            } else if (cfg.num === 3 && herdaEntrada) {
                notaEncadeamento =
                    "Entrada herdada da F2 (mesas) • coleta só a passagem na saída";
            }

            html += `
        <div class="fila-monitor-card ${cfg.cls} ${isDesativada ? "desativada" : ""}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:${cfg.cor}; font-size:0.95rem;">${cfg.nome}</strong>
            ${statusBadge}
          </div>

          ${
              isAtiva && !isDesativada
                  ? `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; margin-top:2px;">
              <span>Aparelhos: <strong>${qtdAparelhos}</strong></span>
              ${semAparelhos ? '<span class="coverage-warning">⚠️ Sem aparelhos!</span>' : ""}
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; background:var(--bg-subtle); padding:6px; border-radius:6px; text-align:center; margin-top:4px;">
              <div>
                <span style="font-size:0.7rem; color:var(--text-muted); display:block;">Na Fila</span>
                <strong style="font-size:1.1rem; color:${cfg.cor};">${dados.fila ? dados.fila.length : 0}</strong>
              </div>
              <div>
                <span style="font-size:0.7rem; color:var(--text-muted); display:block;">Passagens</span>
                <strong style="font-size:1.1rem; color:var(--primary);">${dados.atendidas || 0}</strong>
              </div>
              <div>
                <span style="font-size:0.7rem; color:var(--text-muted); display:block;">Chegadas${herdaEntrada ? " (auto)" : ""}</span>
                <strong style="font-size:1.1rem;">${dados.chegadas || 0}</strong>
              </div>
            </div>

            <div style="margin-top:4px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <span style="font-size:0.72rem; color:var(--text-muted);">
                ${notaEncadeamento}
              </span>
              <button class="btn btn-secondary" style="font-size:0.72rem; padding:2px 8px; color:var(--danger); white-space:nowrap;" onclick="PainelApp.confirmarDesativarFila(${cfg.num})">
                Desativar Fila
              </button>
            </div>
          `
                  : `
            <div style="font-size:0.8rem; color:var(--text-muted); padding:10px 0; text-align:center;">
              ${isDesativada ? "Fila desativada durante a sessão." : "Fila não incluída nesta coleta."}
            </div>
          `
          }
        </div>
      `;
        });

        grid.innerHTML = html;
    },

    confirmarDesativarFila(num) {
        if (
            !confirm(
                `Tem certeza que deseja desativar a Fila ${num}? Esta ação é definitiva para o restante da sessão e será registrada no histórico.`,
            )
        ) {
            return;
        }

        this.conexao.enviar({
            tipo: "desativar_fila",
            fila: num,
        });
    },

    atualizarLoopHud() {
        if (!this.sessao || !this.sessao.inicioMs) {
            document.getElementById("kpi-tempo").textContent = "00:00:00";
            document.getElementById("kpi-restante").textContent =
                "Aguardando início";
            return;
        }

        const agora = Date.now();
        const decorridoMs = agora - this.sessao.inicioMs;
        const previstoMs = (this.sessao.duracaoPrevistaMin || 60) * 60 * 1000;
        const restanteMs = previstoMs - decorridoMs;

        document.getElementById("kpi-tempo").textContent =
            formatarDuracao(decorridoMs);

        const timerBox = document.getElementById("hud-timer-box");
        const lblRestante = document.getElementById("kpi-restante");

        if (restanteMs <= 0) {
            timerBox.classList.add("alert-pulse");
            lblRestante.textContent = `Previsto excedido (+${formatarDuracao(Math.abs(restanteMs)).substring(3)})`;
        } else {
            timerBox.classList.remove("alert-pulse");
            lblRestante.textContent = `Faltam ${formatarDuracao(restanteMs).substring(3)}`;
        }

        // Monitoramento de Ociosidade da Catraca com Fila
        const boxAlerta = document.getElementById("box-alerta-ociosidade");
        const filaLength =
            (this.estado &&
                this.estado.filas &&
                this.estado.filas["1"] &&
                this.estado.filas["1"].fila.length) ||
            (this.estado && this.estado.fila ? this.estado.fila.length : 0);

        if (this.estado && filaLength > 0) {
            const segundosSemAtendimento = Math.floor(
                (agora - this.ultimoAtendimentoTempo) / 1000,
            );
            if (segundosSemAtendimento >= this.limiarAlertaOciosoSeg) {
                boxAlerta.style.display = "block";
                document.getElementById("lbl-segundos-ocioso").textContent =
                    segundosSemAtendimento;
            } else {
                boxAlerta.style.display = "none";
            }
        } else {
            boxAlerta.style.display = "none";
            this.ultimoAtendimentoTempo = agora;
        }

        if (
            this.statusConexaoAtual === "polling" ||
            this.statusConexaoAtual === "desconectado"
        ) {
            const seg = Math.max(
                0,
                Math.round((agora - this.ultimaAtualizacaoTempo) / 1000),
            );
            const txt = document.getElementById("txt-conexao");
            if (txt) {
                txt.textContent = `Sem conexão, atualizando por consulta (há ${seg} s)`;
            }
        }
    },

    renderizarListaAparelhos(aparelhos = []) {
        const container = document.getElementById("lista-aparelhos-painel");
        document.getElementById("lbl-qtd-aparelhos").textContent =
            aparelhos.length;
        container.innerHTML = "";

        if (aparelhos.length === 0) {
            container.innerHTML =
                '<span style="color:var(--text-muted)">Nenhum celular conectado.</span>';
            return;
        }

        aparelhos.forEach((a) => {
            const div = document.createElement("div");
            div.style.display = "flex";
            div.style.justifyContent = "space-between";
            div.style.alignItems = "center";
            div.style.padding = "6px 8px";
            div.style.borderRadius = "6px";
            div.style.background = "var(--bg-subtle)";
            div.style.gap = "8px";

            const papelAtual = a.papel || "todas";

            div.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.nome}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">
            <span>${a.qtdEventos || 0} evs</span> • <span>${a.latenciaMs || 0}ms</span>
          </div>
        </div>
        <div>
          <select onchange="PainelApp.alterarAreaAparelho('${a.id}', this.value)" style="padding:3px 6px; font-size:0.78rem; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main);">
            <option value="fila1" ${papelAtual === "fila1" ? "selected" : ""}>Fila 1 (Entrada)</option>
            <option value="fila2" ${papelAtual === "fila2" ? "selected" : ""}>Fila 2 (Atend.)</option>
            <option value="fila3" ${papelAtual === "fila3" ? "selected" : ""}>Fila 3 (Saída)</option>
            <option value="ambas" ${papelAtual === "ambas" ? "selected" : ""}>Filas 1 e 2</option>
            <option value="todas" ${papelAtual === "todas" ? "selected" : ""}>Todas as Filas</option>
            <option value="apoio" ${papelAtual === "apoio" ? "selected" : ""}>Modo Apoio</option>
          </select>
        </div>
      `;
            container.appendChild(div);
        });
    },

    alterarAreaAparelho(id, novaArea) {
        this.conexao.enviar({
            tipo: "definir_area_aparelho",
            id,
            area: novaArea,
        });
    },

    renderizarTabelaEventos() {
        const corpo = document.getElementById("tabela-ultimos-eventos");
        const ultimos = this.eventos.slice(0, 25);
        corpo.innerHTML = "";

        if (ultimos.length === 0) {
            corpo.innerHTML =
                '<tr><td colspan="6" style="text-align:center; padding:15px; color:var(--text-muted)">Nenhum evento registrado.</td></tr>';
            return;
        }

        ultimos.forEach((ev) => {
            const tr = document.createElement("tr");
            let detalhe = "";
            const filaStr = ev.fila ? `F${ev.fila}` : "--";

            if (
                ev.tipo === "chegada" ||
                ev.tipo === "atendimento" ||
                ev.tipo === "saida" ||
                ev.tipo === "anulacao" ||
                ev.tipo === "reversao"
            ) {
                detalhe = `<strong>Pessoa ${ev.pessoa}</strong>`;
            } else if (ev.tipo === "ajuste_fila") {
                const sinal = ev.delta > 0 ? `+${ev.delta}` : `${ev.delta}`;
                detalhe = `Ajuste fila (${sinal}) → agora: ${ev.tamanhoApos}`;
            } else if (ev.tipo === "fila_desativada") {
                detalhe = `Fila ${ev.fila} desativada por ${ev.autor || "Painel"}`;
            } else if (ev.tipo === "anotacao") {
                detalhe = `"${ev.texto}"`;
            } else if (ev.tipo === "sessao_iniciada") {
                detalhe = "Observação Iniciada";
            } else if (ev.tipo === "sessao_encerrada") {
                detalhe = "Observação Encerrada";
            }

            tr.innerHTML = `
        <td>${ev.seq || "--"}</td>
        <td>${formatarHoraLocal(ev.t)}</td>
        <td><strong>${filaStr}</strong></td>
        <td><strong>${ev.tipo.toUpperCase()}</strong></td>
        <td>${detalhe}</td>
        <td><span class="badge-autor">${ev.dispositivoNome || "Servidor"}</span></td>
      `;
            corpo.appendChild(tr);
        });
    },

    renderizarTabelaRejeitados() {
        const card = document.getElementById("card-rejeitados");
        const corpo = document.getElementById("tabela-rejeitados");
        if (this.rejeitados.length === 0) {
            card.style.display = "none";
            return;
        }

        card.style.display = "block";
        corpo.innerHTML = "";

        this.rejeitados.slice(0, 10).forEach((r) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
        <td>${formatarHoraLocal(r.t)}</td>
        <td><strong style="color:var(--danger)">${r.codigo}</strong></td>
        <td>${r.mensagem}</td>
        <td>${r.dispositivoNome || "--"}</td>
      `;
            corpo.appendChild(tr);
        });
    },

    atualizarControlesSessao() {
        const boxAtiva = document.getElementById("box-sessao-ativa-botoes");
        const boxIniciar = document.getElementById("box-sessao-iniciar-botoes");
        const lblTitulo = document.getElementById("lbl-status-sessao-titulo");

        if (this.sessao && this.sessao.status === "ativa") {
            boxAtiva.style.display = "block";
            boxIniciar.style.display = "none";
            lblTitulo.textContent = "Sessão em Andamento";
            document.getElementById("lbl-sessao-ativa-nome").textContent =
                this.sessao.nome;
        } else {
            boxAtiva.style.display = "none";
            boxIniciar.style.display = "block";
            lblTitulo.textContent = "Controle da Sessão";
        }
    },

    abrirModalIniciarSessao() {
        document.getElementById("modal-iniciar-sessao").classList.add("open");
    },

    fecharModais() {
        document
            .querySelectorAll(".modal-backdrop")
            .forEach((m) => m.classList.remove("open"));
    },

    aplicarPresetFilas(filas) {
        document.getElementById("chk-fila-1").checked = filas.includes(1);
        document.getElementById("chk-fila-2").checked = filas.includes(2);
        document.getElementById("chk-fila-3").checked = filas.includes(3);
    },

    iniciarSessaoForm() {
        const filasAtivas = [];
        if (document.getElementById("chk-fila-1").checked) filasAtivas.push(1);
        if (document.getElementById("chk-fila-2").checked) filasAtivas.push(2);
        if (document.getElementById("chk-fila-3").checked) filasAtivas.push(3);

        if (filasAtivas.length === 0) {
            alert("Selecione ao menos uma fila para iniciar a observação.");
            return;
        }

        const rotulosFilas = {
            1: {
                chegada:
                    document.getElementById("rot-f1-cheg").value.trim() ||
                    "CHEGADA",
                saida:
                    document.getElementById("rot-f1-saida").value.trim() ||
                    "PASSOU NA CATRACA",
            },
            2: {
                chegada:
                    document.getElementById("rot-f2-cheg").value.trim() ||
                    "PASSOU NA CATRACA",
                saida:
                    document.getElementById("rot-f2-saida").value.trim() ||
                    "CHEGOU ÀS MESAS",
            },
            3: {
                chegada:
                    document.getElementById("rot-f3-cheg").value.trim() ||
                    "SAIU DAS MESAS",
                saida:
                    document.getElementById("rot-f3-saida").value.trim() ||
                    "PASSOU NA SAÍDA",
            },
        };

        const servidoresPorFila = {
            1: parseInt(document.getElementById("srv-f1").value, 10) || 1,
            2: parseInt(document.getElementById("srv-f2").value, 10) || 1,
            3: parseInt(document.getElementById("srv-f3").value, 10) || 1,
        };

        const config = {
            nome:
                document.getElementById("cfg-nome").value.trim() || "Almoço RU",
            local:
                document.getElementById("cfg-local").value.trim() ||
                "RU Central",
            observacoes: document.getElementById("cfg-obs").value.trim(),
            duracaoPrevistaMin:
                parseInt(document.getElementById("cfg-duracao").value, 10) ||
                60,
            filasAtivas,
            rotulosFilas,
            servidoresPorFila,
            servidores: servidoresPorFila["1"] || 1,
            blocoMin:
                parseInt(document.getElementById("cfg-bloco").value, 10) || 5,
            limiarPausaSeg:
                parseInt(document.getElementById("cfg-pausa").value, 10) || 60,
            teste: document.getElementById("cfg-teste").checked,
        };

        this.conexao.enviar({
            tipo: "iniciar_sessao",
            config,
        });

        this.fecharModais();
    },

    confirmarEncerramentoSessao() {
        if (
            !confirm(
                "Deseja realmente encerrar a sessão de observação ativa? Todos os celulares serão notificados e o relatório final estará disponível no Histórico.",
            )
        ) {
            return;
        }

        this.conexao.enviar({
            tipo: "encerrar_sessao",
        });
    },

    simularCargaTeste() {
        if (
            !confirm(
                "Deseja simular uma coleta de teste sintética com ~80 eventos automáticos? Uma sessão marcada como teste será criada.",
            )
        ) {
            return;
        }

        this.conexao.enviar({
            tipo: "simular_teste",
            qtdEventos: 80,
        });
    },

    ajustarMapa() {
        if (this.animador) this.animador.alternarAjustarTela();
    },

    telaCheiaMapa() {
        if (this.animador) this.animador.alternarTelaCheia();
    },

    async abrirModalPin() {
        const modal = document.getElementById("modal-config-pin");
        const erroEl = document.getElementById("pin-feedback-erro");
        const sucessoEl = document.getElementById("pin-feedback-sucesso");
        const avisoFixo = document.getElementById("pin-aviso-fixo");
        const pinAtual = document.getElementById("pin-atual");
        const pinNovo = document.getElementById("pin-novo");
        const pinConfirma = document.getElementById("pin-confirma");
        const btnSalvar = document.getElementById("btn-salvar-pin");
        const btnRestaurar = document.getElementById("btn-restaurar-pin");
        const chkDesconectar = document.getElementById(
            "chk-desconectar-aparelhos",
        );

        erroEl.style.display = "none";
        sucessoEl.style.display = "none";
        pinNovo.value = "";
        pinConfirma.value = "";
        chkDesconectar.checked = false;

        try {
            const resp = await fetch("/api/config/pin");
            if (resp.status === 403) {
                erroEl.textContent =
                    "Acesso restrito ao computador local (notebook).";
                erroEl.style.display = "block";
                return;
            }
            const data = await resp.json();
            pinAtual.value = data.pin || "****";
            if (data.fixoPorParametro) {
                avisoFixo.style.display = "block";
                pinNovo.disabled = true;
                pinConfirma.disabled = true;
                btnSalvar.disabled = true;
                btnRestaurar.disabled = true;
                chkDesconectar.disabled = true;
            } else {
                avisoFixo.style.display = "none";
                pinNovo.disabled = false;
                pinConfirma.disabled = false;
                btnSalvar.disabled = false;
                btnRestaurar.disabled = false;
                chkDesconectar.disabled = false;
            }
        } catch (e) {
            pinAtual.value =
                (this.infoServidor && this.infoServidor.pin) || "1234";
        }

        modal.classList.add("open");
    },

    fecharModalPin() {
        const modal = document.getElementById("modal-config-pin");
        if (modal) modal.classList.remove("open");
    },

    toggleVerPin(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.type = el.type === "password" ? "text" : "password";
    },

    restaurarPinPadrao() {
        document.getElementById("pin-novo").value = "1234";
        document.getElementById("pin-confirma").value = "1234";
    },

    async salvarNovoPin() {
        const erroEl = document.getElementById("pin-feedback-erro");
        const sucessoEl = document.getElementById("pin-feedback-sucesso");
        const pinAtual = document.getElementById("pin-atual").value;
        const pinNovo = document.getElementById("pin-novo").value.trim();
        const pinConfirma = document
            .getElementById("pin-confirma")
            .value.trim();
        const desconectarOutros = document.getElementById(
            "chk-desconectar-aparelhos",
        ).checked;

        erroEl.style.display = "none";
        sucessoEl.style.display = "none";

        if (!pinNovo || !pinConfirma) {
            erroEl.textContent = "Por favor, preencha todos os campos.";
            erroEl.style.display = "block";
            return;
        }

        if (!/^\d{4,8}$/.test(pinNovo)) {
            erroEl.textContent =
                "A nova senha deve ter entre 4 e 8 dígitos numéricos.";
            erroEl.style.display = "block";
            return;
        }

        if (pinNovo !== pinConfirma) {
            erroEl.textContent = "A confirmação não coincide com a nova senha.";
            erroEl.style.display = "block";
            return;
        }

        if (pinAtual && pinNovo === pinAtual) {
            erroEl.textContent =
                "A nova senha deve ser diferente da senha atual.";
            erroEl.style.display = "block";
            return;
        }

        if (
            !confirm(
                `Confirma a alteração da senha de acesso para "${pinNovo}"?`,
            )
        ) {
            return;
        }

        try {
            const resp = await fetch("/api/config/pin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ novoPin: pinNovo, desconectarOutros }),
            });

            const res = await resp.json();
            if (!resp.ok || !res.sucesso) {
                erroEl.textContent =
                    res.erro || "Falha ao alterar senha no servidor.";
                erroEl.style.display = "block";
                return;
            }

            sucessoEl.textContent = "Senha atualizada com sucesso!";
            sucessoEl.style.display = "block";
            document.getElementById("txt-pin-display").textContent = pinNovo;
            if (this.conexao)
                this.conexao.salvarCredenciais(
                    pinNovo,
                    "Painel Notebook",
                    "todas",
                );

            setTimeout(() => {
                this.fecharModalPin();
            }, 1200);
        } catch (e) {
            erroEl.textContent =
                "Erro ao conectar ao servidor para alterar senha.";
            erroEl.style.display = "block";
        }
    },

    toggleTheme() {
        const current = document.documentElement.getAttribute("data-theme");
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
    },
};

window.PainelApp = PainelApp;
document.addEventListener("DOMContentLoaded", () => PainelApp.init());
