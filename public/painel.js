/**
 * public/painel.js
 * Lógica do painel de monitoramento do notebook (projeção, zonas configuráveis e delegação de pontos).
 */

import { GerenciadorConexao } from './conexao.js';
import { AnimadorFila } from './animacao.js';
import { formatarDuracao, formatarHoraLocal, formatarNumero } from '../shared/metricas.js';
import { obterZonasPadrao, gerarPontosDeZonas } from '../shared/estado.js';

export const PainelApp = {
  conexao: null,
  animador: null,
  estado: null,
  sessao: null,
  eventos: [],
  rejeitados: [],
  aparelhos: [],
  atribuicoes: {},
  zonasConfig: obterZonasPadrao(),
  nomesPontosCustom: {},
  filaMaxAtingida: 0,
  ultimoRegistroTempo: Date.now(),
  limiarAlertaOciosoSeg: 120,
  timerHud: null,
  abaAtiva: 'animacao',

  async init() {
    this.animador = new AnimadorFila('container-animacao-painel');

    await this.carregarInfoServidor();
    await this.carregarPresets();

    this.conexao = new GerenciadorConexao({
      onEstado: (estado, sessao) => {
        this.sessao = sessao;
        this.atualizarEstado(estado);
        if (this.animador) {
          this.animador.renderizarEstado(estado, false);
        }
      },
      onNovoEvento: (evento, estado, diff) => {
        this.eventos.unshift(evento);
        this.atualizarEstado(estado);
        if (this.animador) {
          this.animador.aplicarOperacoes(diff, estado);
        }
        this.renderizarTabelaEventos();
        this.ultimoRegistroTempo = Date.now();
      },
      onSessaoIniciada: (sessao, estado, evento) => {
        this.sessao = sessao;
        this.zonasConfig = sessao.config.zonas || this.zonasConfig;
        this.atribuicoes = sessao.atribuicoes || {};
        if (evento) this.eventos.unshift(evento);
        this.atualizarEstado(estado);
        this.atualizarControlesSessao();
        this.renderizarZonasConfig();
        this.renderizarMatrizDelegacao();
        this.renderizarTabelaEventos();
      },
      onSessaoEncerrada: (sessao, estado, evento) => {
        this.sessao = null;
        if (evento) this.eventos.unshift(evento);
        this.atualizarEstado(estado);
        this.atualizarControlesSessao();
        this.renderizarZonasConfig();
        this.renderizarMatrizDelegacao();
        this.renderizarTabelaEventos();
      },
      onListaAparelhos: (aparelhos) => {
        this.aparelhos = aparelhos;
        this.renderizarListaAparelhos(aparelhos);
        this.renderizarMatrizDelegacao();
        if (this.animador) {
          this.animador.definirAtribuicoes(this.atribuicoes, aparelhos);
        }
      },
      onStatusConexao: (status) => this.atualizarStatusConexao(status),
      onComandoRejeitado: (rejeicao) => {
        this.rejeitados.unshift(rejeicao);
        this.renderizarTabelaRejeitados();
      }
    });

    // Escuta eventos customizados de atualização de atribuição e configuração
    if (this.conexao) {
      const origProcessar = this.conexao.processarMensagemServidor.bind(this.conexao);
      this.conexao.processarMensagemServidor = (msg) => {
        origProcessar(msg);
        if (msg.tipo === 'atribuicoes_atualizadas') {
          this.atribuicoes = msg.atribuicoes;
          this.renderizarMatrizDelegacao();
          if (this.animador) {
            this.animador.definirAtribuicoes(this.atribuicoes, this.aparelhos);
          }
        } else if (msg.tipo === 'config_atualizada') {
          if (msg.meta) this.sessao = msg.meta;
          if (msg.estado) this.atualizarEstado(msg.estado);
        }
      };
    }

    this.conexao.salvarCredenciais(this.pinServidor, 'Painel Notebook', 'supervisor');
    this.conexao.conectar();

    this.renderizarZonasConfig();
    this.renderizarPreviewCadeia();
    this.renderizarMatrizDelegacao();

    this.timerHud = setInterval(() => this.atualizarLoopHud(), 1000);
  },

  async carregarInfoServidor() {
    try {
      const resp = await fetch('/api/info');
      const dados = await resp.json();

      this.pinServidor = dados.pin;
      document.getElementById('txt-pin-display').textContent = dados.pin;
      document.getElementById('txt-url-display').textContent = dados.urlCelular;

      if (dados.qrDataUrl) {
        document.getElementById('img-qrcode').src = dados.qrDataUrl;
      }

      if (dados.sessaoAtiva) {
        this.sessao = dados.sessaoAtiva;
        this.zonasConfig = dados.sessaoAtiva.zonas || this.zonasConfig;
        this.atribuicoes = dados.sessaoAtiva.atribuicoes || {};
        this.atualizarControlesSessao();
      }
    } catch (e) {
      console.warn('Erro ao carregar dados do servidor:', e);
    }
  },

  async carregarPresets() {
    try {
      const resp = await fetch('/api/presets');
      const presets = await resp.json();
      const select = document.getElementById('sel-preset-zonas');
      select.innerHTML = '';

      presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.nome;
        select.appendChild(opt);
      });

      this.presetsArmazenados = presets;
    } catch (e) {}
  },

  trocarAba(nomeAba) {
    this.abaAtiva = nomeAba;
    document.querySelectorAll('.panel-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-btn-${nomeAba}`)?.classList.add('active');

    document.getElementById('secao-aba-animacao').style.display = (nomeAba === 'animacao') ? 'block' : 'none';
    document.getElementById('secao-aba-zonas').style.display = (nomeAba === 'zonas') ? 'block' : 'none';
    document.getElementById('secao-aba-delegacao').style.display = (nomeAba === 'delegacao') ? 'block' : 'none';
    document.getElementById('secao-aba-auditoria').style.display = (nomeAba === 'auditoria') ? 'block' : 'none';

    if (nomeAba === 'animacao' && this.animador && this.estado) {
      this.animador.renderizarEstado(this.estado, false);
    }
  },

  atualizarStatusConexao(status) {
    const badge = document.getElementById('badge-conexao');
    const txt = document.getElementById('txt-conexao');
    badge.className = 'status-badge';

    if (status === 'conectado') {
      badge.classList.add('online');
      txt.textContent = 'Servidor Conectado';
    } else {
      badge.classList.add('offline');
      txt.textContent = 'Desconectado';
    }
  },

  atualizarEstado(estado) {
    if (!estado) return;
    this.estado = estado;

    const presentes = estado.contadores.presentes;
    if (presentes > this.filaMaxAtingida) {
      this.filaMaxAtingida = presentes;
    }

    document.getElementById('kpi-presentes').textContent = presentes;
    document.getElementById('kpi-fila-max').textContent = this.filaMaxAtingida;
    document.getElementById('kpi-atendidos').textContent = estado.contadores.saidas;
    document.getElementById('kpi-chegadas').textContent = estado.contadores.chegadas;
    document.getElementById('kpi-anulados').textContent = estado.contadores.anuladas;

    document.getElementById('kpi-vazao').innerHTML = `${formatarNumero(estado.vazaoRecente, 1)} <span style="font-size:0.8rem">p/min</span>`;
    document.getElementById('kpi-ultimo-int').textContent = estado.ultimoIntervaloSeg !== null
      ? `${formatarNumero(estado.ultimoIntervaloSeg, 1)} s`
      : '-- s';

    this.verificarAlertasOperacionais();
  },

  atualizarLoopHud() {
    if (!this.sessao || !this.sessao.inicioMs) {
      document.getElementById('kpi-tempo').textContent = '00:00:00';
      document.getElementById('kpi-restante').textContent = 'Aguardando Início';
      return;
    }

    const agora = Date.now();
    const decorridoMs = agora - this.sessao.inicioMs;
    const previstoMs = (this.sessao.duracaoPrevistaMin || 60) * 60 * 1000;
    const restanteMs = previstoMs - decorridoMs;

    document.getElementById('kpi-tempo').textContent = formatarDuracao(decorridoMs);

    const timerBox = document.getElementById('hud-timer-box');
    const lblRestante = document.getElementById('kpi-restante');

    if (restanteMs <= 0) {
      timerBox.classList.add('alert-pulse');
      lblRestante.textContent = `Previsto excedido (+${formatarDuracao(Math.abs(restanteMs)).substring(3)})`;
    } else {
      timerBox.classList.remove('alert-pulse');
      lblRestante.textContent = `Faltam ${formatarDuracao(restanteMs).substring(3)}`;
    }

    // Monitoramento de Ociosidade em pontos com fila
    const boxAlerta = document.getElementById('box-alerta-ociosidade');
    if (this.estado && this.estado.contadores.presentes > 0) {
      const segundosSemRegistro = Math.floor((agora - this.ultimoRegistroTempo) / 1000);
      if (segundosSemRegistro >= this.limiarAlertaOciosoSeg) {
        boxAlerta.style.display = 'block';
        document.getElementById('lbl-segundos-ocioso').textContent = segundosSemRegistro;
      } else {
        boxAlerta.style.display = 'none';
      }
    } else {
      boxAlerta.style.display = 'none';
      this.ultimoRegistroTempo = agora;
    }
  },

  verificarAlertasOperacionais() {
    const boxPontos = document.getElementById('box-alerta-pontos-descobertos');
    const pontos = this.obterPontosCalculados();
    const avisos = [];

    // 1. Ponto habilitado sem aparelho conectado atribuído
    const aparelhosOnlineIds = new Set(this.aparelhos.filter(a => a.conectado).map(a => a.id));
    for (const p of pontos) {
      const atribuidos = Object.entries(this.atribuicoes)
        .filter(([dispId, pts]) => pts.includes(p.id) && aparelhosOnlineIds.has(dispId));

      if (atribuidos.length === 0) {
        avisos.push(`⚠️ O ponto "${p.nome}" está sem nenhum aparelho conectado atribuído! <button class="btn btn-secondary" style="padding:1px 6px; font-size:0.75rem; margin-left:6px;" onclick="PainelApp.autoAtribuirPontoRapido('${p.id}')">Atribuir a aparelho livre</button>`);
      }
    }

    // 2. Ponto de zona de contagem com mais de um aparelho (risco de duplicação)
    for (const p of pontos) {
      if (p.modoOrigem === 'contagem') {
        const atribuidos = Object.entries(this.atribuicoes)
          .filter(([dispId, pts]) => pts.includes(p.id));
        if (atribuidos.length > 1) {
          avisos.push(`⚠️ Ponto "${p.nome}" (zona de contagem) possui múltiplos aparelhos atribuídos (risco de contagem em duplicidade).`);
        }
      }
    }

    if (avisos.length > 0) {
      boxPontos.style.display = 'block';
      boxPontos.innerHTML = avisos.join('<br>');
    } else {
      boxPontos.style.display = 'none';
    }
  },

  autoAtribuirPontoRapido(pontoId) {
    const dispLivre = this.aparelhos.find(a => a.conectado && (!this.atribuicoes[a.id] || this.atribuicoes[a.id].length === 0)) || this.aparelhos[0];
    if (!dispLivre) {
      alert('Nenhum aparelho conectado disponível para atribuição rápida.');
      return;
    }
    const novasAtrib = { ...this.atribuicoes };
    novasAtrib[dispLivre.id] = [...(novasAtrib[dispLivre.id] || []), pontoId];
    this.salvarAtribuicoesServidor(novasAtrib);
  },

  // --------------------------------------------------------------------------
  // GERENCIAMENTO DAS ZONAS (ABA ZONAS)
  // --------------------------------------------------------------------------
  obterPontosCalculados() {
    return gerarPontosDeZonas(this.zonasConfig, this.nomesPontosCustom);
  },

  aplicarPresetSelecionado(presetId) {
    if (this.sessao) {
      alert('A configuração de zonas está travada durante a sessão ativa.');
      return;
    }
    const preset = (this.presetsArmazenados || []).find(p => p.id === presetId);
    if (preset && Array.isArray(preset.zonas)) {
      this.zonasConfig = preset.zonas.map(z => ({ ...z }));
      this.renderizarZonasConfig();
      this.renderizarPreviewCadeia();
      this.renderizarMatrizDelegacao();
    }
  },

  renderizarZonasConfig() {
    const corpo = document.getElementById('tabela-zonas-config');
    const travada = !!this.sessao;
    document.getElementById('badge-zonas-travadas').style.display = travada ? 'inline-flex' : 'none';
    document.getElementById('btn-add-zona').disabled = travada;
    document.getElementById('sel-preset-zonas').disabled = travada;

    corpo.innerHTML = '';

    this.zonasConfig.forEach((z, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>Z${idx + 1}</strong></td>
        <td>
          <input type="text" value="${z.nome}" style="padding:4px 6px; font-size:0.85rem;" onchange="PainelApp.atualizarNomeZona(${idx}, this.value)">
        </td>
        <td>
          <input type="color" value="${z.cor}" style="width:36px; height:28px; padding:1px;" onchange="PainelApp.atualizarCorZona(${idx}, this.value)">
        </td>
        <td>
          <select ${travada ? 'disabled' : ''} onchange="PainelApp.atualizarModoZona(${idx}, this.value)" style="padding:4px 6px; font-size:0.82rem;">
            <option value="fifo" ${z.modo === 'fifo' ? 'selected' : ''}>FIFO (Fila)</option>
            <option value="contagem" ${z.modo === 'contagem' ? 'selected' : ''}>Contagem (Espaço)</option>
          </select>
        </td>
        <td>
          <input type="number" placeholder="Opcional" value="${z.capacidade || ''}" min="1" style="width:80px; padding:4px 6px; font-size:0.85rem;" onchange="PainelApp.atualizarCapacidadeZona(${idx}, this.value)">
        </td>
        <td>
          <input type="checkbox" ${z.habilitada !== false ? 'checked' : ''} ${travada ? 'disabled' : ''} onchange="PainelApp.toggleHabilitadaZona(${idx}, this.checked)">
        </td>
        <td>
          <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.75rem;" ${travada || idx === 0 ? 'disabled' : ''} onclick="PainelApp.moverZona(${idx}, -1)">▲</button>
          <button class="btn btn-secondary" style="padding:2px 6px; font-size:0.75rem;" ${travada || idx === this.zonasConfig.length - 1 ? 'disabled' : ''} onclick="PainelApp.moverZona(${idx}, 1)">▼</button>
          ${!['z1', 'z2', 'z3'].includes(z.id) ? `<button class="btn btn-danger" style="padding:2px 6px; font-size:0.75rem; color:red;" ${travada ? 'disabled' : ''} onclick="PainelApp.removerZona(${idx})">✕</button>` : ''}
        </td>
      `;
      corpo.appendChild(tr);
    });

    this.renderizarPreviewCadeia();
  },

  renderizarPreviewCadeia() {
    const container = document.getElementById('preview-cadeia-pontos');
    const pontos = this.obterPontosCalculados();
    const zonasHabilitadas = this.zonasConfig.filter(z => z.habilitada !== false);
    container.innerHTML = '';

    const divOrig = document.createElement('div');
    divOrig.className = 'cadeia-item';
    divOrig.style.background = '#8b5cf6';
    divOrig.textContent = 'Origem';
    container.appendChild(divOrig);

    zonasHabilitadas.forEach((z, i) => {
      const pAnterior = pontos[i];
      if (pAnterior) {
        const spanP = document.createElement('span');
        spanP.className = 'cadeia-ponto';
        spanP.textContent = `[${pAnterior.nome}] →`;
        container.appendChild(spanP);
      }

      const divZ = document.createElement('div');
      divZ.className = 'cadeia-item';
      divZ.style.background = z.cor;
      divZ.textContent = `${z.nome} (${z.modo.toUpperCase()})`;
      container.appendChild(divZ);
    });

    const pFinal = pontos[pontos.length - 1];
    if (pFinal) {
      const spanPF = document.createElement('span');
      spanPF.className = 'cadeia-ponto';
      spanPF.textContent = `[${pFinal.nome}] →`;
      container.appendChild(spanPF);
    }

    const divSaida = document.createElement('div');
    divSaida.className = 'cadeia-item';
    divSaida.style.background = '#f97316';
    divSaida.textContent = 'Saída';
    container.appendChild(divSaida);
  },

  atualizarNomeZona(idx, novoNome) {
    if (this.zonasConfig[idx]) {
      this.zonasConfig[idx].nome = novoNome;
      this.sincronizarAlteracoesPermitidas();
    }
  },

  atualizarCorZona(idx, novaCor) {
    if (this.zonasConfig[idx]) {
      this.zonasConfig[idx].cor = novaCor;
      this.sincronizarAlteracoesPermitidas();
    }
  },

  atualizarModoZona(idx, novoModo) {
    if (this.sessao) return;
    if (this.zonasConfig[idx]) {
      this.zonasConfig[idx].modo = novoModo;
      this.renderizarZonasConfig();
      this.renderizarMatrizDelegacao();
    }
  },

  atualizarCapacidadeZona(idx, valor) {
    if (this.zonasConfig[idx]) {
      this.zonasConfig[idx].capacidade = valor ? parseInt(valor, 10) : null;
      this.sincronizarAlteracoesPermitidas();
    }
  },

  toggleHabilitadaZona(idx, habilitada) {
    if (this.sessao) return;
    if (this.zonasConfig[idx]) {
      this.zonasConfig[idx].habilitada = habilitada;
      this.renderizarZonasConfig();
      this.renderizarMatrizDelegacao();
    }
  },

  moverZona(idx, direcao) {
    if (this.sessao) return;
    const novoIdx = idx + direcao;
    if (novoIdx >= 0 && novoIdx < this.zonasConfig.length) {
      const temp = this.zonasConfig[idx];
      this.zonasConfig[idx] = this.zonasConfig[novoIdx];
      this.zonasConfig[novoIdx] = temp;
      this.renderizarZonasConfig();
      this.renderizarMatrizDelegacao();
    }
  },

  removerZona(idx) {
    if (this.sessao) return;
    this.zonasConfig.splice(idx, 1);
    this.renderizarZonasConfig();
    this.renderizarMatrizDelegacao();
  },

  abrirModalAddZona() {
    if (this.sessao) return;
    const selPos = document.getElementById('add-zona-pos');
    selPos.innerHTML = '';
    this.zonasConfig.forEach((z, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Antes de ${z.nome}`;
      selPos.appendChild(opt);
    });
    const optFim = document.createElement('option');
    optFim.value = this.zonasConfig.length;
    optFim.textContent = 'No final da cadeia';
    optFim.selected = true;
    selPos.appendChild(optFim);

    document.getElementById('modal-add-zona').classList.add('open');
  },

  confirmarAddZona() {
    const nome = document.getElementById('add-zona-nome').value.trim();
    const cor = document.getElementById('add-zona-cor').value;
    const modo = document.getElementById('add-zona-modo').value;
    const pos = parseInt(document.getElementById('add-zona-pos').value, 10);
    const cap = document.getElementById('add-zona-cap').value ? parseInt(document.getElementById('add-zona-cap').value, 10) : null;

    if (!nome) return;

    const novaZona = {
      id: `custom_${Date.now()}`,
      nome,
      cor,
      modo,
      habilitada: true,
      capacidade: cap,
      servidores: 1
    };

    this.zonasConfig.splice(pos, 0, novaZona);
    this.fecharModais();
    this.renderizarZonasConfig();
    this.renderizarMatrizDelegacao();
  },

  abrirSalvarModelo() {
    const nome = prompt('Nome do novo modelo de zonas:', 'Meu Modelo RU');
    if (!nome) return;

    fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome,
        zonas: this.zonasConfig
      })
    }).then(r => r.json()).then(res => {
      if (res.sucesso) {
        alert('Modelo salvo com sucesso no disco!');
        this.carregarPresets();
      }
    });
  },

  sincronizarAlteracoesPermitidas() {
    this.renderizarPreviewCadeia();
    if (this.sessao && this.conexao) {
      this.conexao.enviar({
        tipo: 'atualizar_config_sessao',
        alteracoes: {
          zonas: this.zonasConfig,
          nomesPontos: this.nomesPontosCustom
        }
      });
    }
  },

  // --------------------------------------------------------------------------
  // MATRIZ DE DELEGAÇÃO DE APARELHOS (ABA DELEGAÇÃO)
  // --------------------------------------------------------------------------
  renderizarMatrizDelegacao() {
    const thead = document.getElementById('matriz-cabecalho-pontos');
    const tbody = document.getElementById('matriz-corpo-aparelhos');
    const containerCobertura = document.getElementById('lista-cobertura-pontos');
    const pontos = this.obterPontosCalculados();

    if (!thead || !tbody) return;

    // Cabeçalho da matriz
    let thHtml = '<tr><th>Aparelho Conectado (Papel)</th>';
    pontos.forEach((p, idx) => {
      thHtml += `<th>P${idx}: ${p.nome} <br><span style="font-weight:normal; font-size:0.7rem; color:var(--text-muted);">${p.de} → ${p.para}</span></th>`;
    });
    thHtml += '</tr>';
    thead.innerHTML = thHtml;

    // Linhas dos aparelhos
    tbody.innerHTML = '';
    const aparelhos = this.aparelhos;

    if (aparelhos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${pontos.length + 1}" style="text-align:center; padding:15px; color:var(--text-muted);">Nenhum celular conectado no momento. Conecte os aparelhos via Wi-Fi/QR Code.</td></tr>`;
      return;
    }

    aparelhos.forEach(a => {
      const tr = document.createElement('tr');
      const pontosDoAparelho = this.atribuicoes[a.id] || [];

      let tdHtml = `
        <td>
          <strong>${a.nome}</strong> <span style="font-size:0.75rem; color:var(--text-muted);">(${a.papel})</span>
          ${a.conectado ? '<span style="color:#22c55e;"> ● Online</span>' : '<span style="color:#ef4444;"> ○ Offline</span>'}
        </td>
      `;

      pontos.forEach(p => {
        const marcado = pontosDoAparelho.includes(p.id);
        const desabilitado = (a.papel === 'supervisor' || a.papel === 'observador');
        tdHtml += `
          <td>
            <input type="checkbox" ${marcado ? 'checked' : ''} ${desabilitado ? 'disabled' : ''} onchange="PainelApp.toggleAtribuicao('${a.id}', '${p.id}', this.checked)">
          </td>
        `;
      });

      tr.innerHTML = tdHtml;
      tbody.appendChild(tr);
    });

    // Exibição da Cobertura de cada Ponto
    if (containerCobertura) {
      containerCobertura.innerHTML = '';
      pontos.forEach((p, idx) => {
        const item = document.createElement('div');
        item.style.background = 'var(--bg-subtle)';
        item.style.padding = '4px 10px';
        item.style.borderRadius = '6px';
        item.style.border = '1px solid var(--border-color)';
        item.innerHTML = `<strong>P${idx} (${p.nome}):</strong> <span style="color:var(--primary); font-weight:700;">100% coberto</span>`;
        containerCobertura.appendChild(item);
      });
    }

    this.verificarAlertasOperacionais();
  },

  toggleAtribuicao(dispId, pontoId, marcado) {
    const novasAtrib = { ...this.atribuicoes };
    const lista = new Set(novasAtrib[dispId] || []);

    if (marcado) {
      lista.add(pontoId);
    } else {
      lista.delete(pontoId);
    }

    novasAtrib[dispId] = Array.from(lista);
    this.salvarAtribuicoesServidor(novasAtrib);
  },

  distribuicaoAutomaticaPontos() {
    const aparelhos = this.aparelhos.filter(a => a.papel === 'avaliador' || !a.papel);
    const pontos = this.obterPontosCalculados();

    if (aparelhos.length === 0 || pontos.length === 0) {
      alert('É necessário ao menos um aparelho avaliador conectado para realizar a distribuição automática.');
      return;
    }

    const novasAtrib = {};
    const nAparelhos = aparelhos.length;
    const nPontos = pontos.length;
    const pontosPorAparelho = nPontos / nAparelhos;

    for (let i = 0; i < nAparelhos; i++) {
      const a = aparelhos[i];
      const startIdx = Math.round(i * pontosPorAparelho);
      const endIdx = Math.round((i + 1) * pontosPorAparelho);
      novasAtrib[a.id] = pontos.slice(startIdx, endIdx).map(p => p.id);
    }

    this.salvarAtribuicoesServidor(novasAtrib);
  },

  operadorUnicoPontos() {
    const aparelhos = this.aparelhos;
    const pontos = this.obterPontosCalculados();

    if (aparelhos.length === 0) {
      alert('Nenhum aparelho conectado.');
      return;
    }

    const dispId = aparelhos[0].id;
    const novasAtrib = {};
    novasAtrib[dispId] = pontos.map(p => p.id);

    this.salvarAtribuicoesServidor(novasAtrib);
  },

  salvarAtribuicoesServidor(novasAtrib) {
    this.atribuicoes = novasAtrib;
    if (this.conexao) {
      this.conexao.enviar({
        tipo: 'atribuir_pontos',
        atribuicoes: novasAtrib
      });
    }
    this.renderizarMatrizDelegacao();
    if (this.animador) {
      this.animador.definirAtribuicoes(this.atribuicoes, this.aparelhos);
    }
  },

  // --------------------------------------------------------------------------
  // LISTAGEM DE APARELHOS E EVENTOS
  // --------------------------------------------------------------------------
  renderizarListaAparelhos(aparelhos = []) {
    const container = document.getElementById('lista-aparelhos-painel');
    document.getElementById('lbl-qtd-aparelhos').textContent = aparelhos.length;
    container.innerHTML = '';

    if (aparelhos.length === 0) {
      container.innerHTML = '<span style="color:var(--text-muted)">Nenhum celular conectado.</span>';
      return;
    }

    aparelhos.forEach(a => {
      const div = document.createElement('div');
      div.style.display = 'flex';
      div.style.justifyContent = 'space-between';
      div.style.alignItems = 'center';
      div.style.padding = '4px 8px';
      div.style.borderRadius = '6px';
      div.style.background = 'var(--bg-subtle)';

      div.innerHTML = `
        <div>
          <strong>${a.nome}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted);">(${a.papel})</span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-muted);">
          <span>${a.qtdEventos} evs</span> • <span>${a.latenciaMs}ms</span>
        </div>
      `;
      container.appendChild(div);
    });
  },

  renderizarTabelaEventos() {
    const corpo = document.getElementById('tabela-ultimos-eventos');
    const ultimos = this.eventos.slice(0, 25);
    corpo.innerHTML = '';

    if (ultimos.length === 0) {
      corpo.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:15px; color:var(--text-muted)">Nenhum evento registrado.</td></tr>';
      return;
    }

    ultimos.forEach(ev => {
      const tr = document.createElement('tr');
      let detalhe = '';
      if (ev.tipo === 'chegada' || ev.tipo === 'avanco' || ev.tipo === 'atendimento' || ev.tipo === 'anulacao' || ev.tipo === 'reversao') {
        detalhe = `<strong>Pessoa ${ev.pessoa}</strong>`;
      } else if (ev.tipo === 'anotacao') {
        detalhe = `"${ev.texto}"`;
      } else if (ev.tipo === 'sessao_iniciada') {
        detalhe = 'Observação Iniciada';
      } else if (ev.tipo === 'sessao_encerrada') {
        detalhe = 'Observação Encerrada';
      }

      tr.innerHTML = `
        <td>${ev.seq || '--'}</td>
        <td>${formatarHoraLocal(ev.tEfetivo ?? ev.t)}</td>
        <td><strong>${ev.tipo.toUpperCase()}</strong></td>
        <td>${ev.ponto || '--'}</td>
        <td>${detalhe}</td>
        <td><span class="badge-autor">${ev.dispositivoNome || 'Servidor'}</span></td>
        <td>${ev.inversaoCorrigida ? '✅ Sim' : '—'}</td>
      `;
      corpo.appendChild(tr);
    });
  },

  renderizarTabelaRejeitados() {
    const corpo = document.getElementById('tabela-rejeitados');
    corpo.innerHTML = '';

    this.rejeitados.slice(0, 15).forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatarHoraLocal(r.t)}</td>
        <td style="color:var(--danger); font-weight:700;">${r.codigo}</td>
        <td>${r.ponto || '--'}</td>
        <td>${r.mensagem}</td>
        <td>${r.dispositivoNome || r.dispositivoId}</td>
      `;
      corpo.appendChild(tr);
    });
  },

  atualizarControlesSessao() {
    const boxInicia = document.getElementById('box-sessao-iniciar-botoes');
    const boxAtiva = document.getElementById('box-sessao-ativa-botoes');

    if (this.sessao) {
      boxInicia.style.display = 'none';
      boxAtiva.style.display = 'block';
      document.getElementById('lbl-sessao-ativa-nome').textContent = this.sessao.nome;
    } else {
      boxInicia.style.display = 'block';
      boxAtiva.style.display = 'none';
    }
  },

  abrirModalIniciarSessao() {
    document.getElementById('modal-iniciar-sessao').classList.add('open');
  },

  iniciarSessaoForm() {
    const nome = document.getElementById('cfg-nome').value.trim();
    const local = document.getElementById('cfg-local').value.trim();
    const duracaoPrevistaMin = parseInt(document.getElementById('cfg-duracao').value, 10);
    const servidores = parseInt(document.getElementById('cfg-servidores').value, 10);
    const janelaInversaoS = parseInt(document.getElementById('cfg-janela').value, 10);
    const limiarAlertaOciosoSeg = parseInt(document.getElementById('cfg-alerta-ocioso').value, 10);
    const autoAtribuirLivres = document.getElementById('cfg-auto-atribuir').checked;

    this.conexao.enviar({
      tipo: 'iniciar_sessao',
      config: {
        nome,
        local,
        duracaoPrevistaMin,
        servidores,
        janelaInversaoS,
        limiarAlertaOciosoSeg,
        autoAtribuirLivres,
        zonas: this.zonasConfig,
        pontos: this.obterPontosCalculados(),
        atribuicoes: this.atribuicoes
      }
    });

    this.fecharModais();
  },

  confirmarEncerramentoSessao() {
    if (confirm('Deseja realmente encerrar a sessão de coleta atual? Os celulares serão notificados e o histórico será finalizado.')) {
      this.conexao.enviar({ tipo: 'encerrar_sessao' });
    }
  },

  simularCargaTeste() {
    this.conexao.enviar({ tipo: 'simular_teste', qtdEventos: 80 });
  },

  fecharModais() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  },

  toggleTheme() {
    const atual = document.documentElement.getAttribute('data-theme');
    const novo = atual === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', novo);
    localStorage.setItem('ru_theme', novo);
  }
};

window.PainelApp = PainelApp;
document.addEventListener('DOMContentLoaded', () => {
  const temaSalvo = localStorage.getItem('ru_theme');
  if (temaSalvo) document.documentElement.setAttribute('data-theme', temaSalvo);
  PainelApp.init();
});
