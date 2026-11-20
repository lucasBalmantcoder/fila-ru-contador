/**
 * public/simulacoes.js
 * Controlador do módulo de Simulações What-If do Sistema Fila RU.
 */

import { simularSessao } from '../shared/simulador.js';
import { formatarNumero, formatarDuracao } from '../shared/metricas.js';
import { derivarEstado } from '../shared/estado.js';

let chartFilaInstance = null;
let chartMesasInstance = null;
let sessoesDisponiveis = [];

export const SimulacoesApp = {
  async init() {
    await this.carregarSessoes();
    this.aplicarTemaInicial();
  },

  aplicarTemaInicial() {
    const temaSalvo = localStorage.getItem('fila_ru_tema');
    if (temaSalvo === 'escuro' || (!temaSalvo && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.body.classList.add('dark-mode');
    }
  },

  async carregarSessoes() {
    const sel = document.getElementById('sel-sessao');
    try {
      const res = await fetch('/api/sessoes');
      if (!res.ok) throw new Error('Falha ao obter lista de sessões.');
      sessoesDisponiveis = await res.json();

      sel.innerHTML = '';
      if (!sessoesDisponiveis || sessoesDisponiveis.length === 0) {
        sel.innerHTML = '<option value="">Nenhuma sessão encontrada</option>';
        return;
      }

      for (const s of sessoesDisponiveis) {
        const opt = document.createElement('option');
        opt.value = s.id;
        const dataStr = s.inicioMs ? new Date(s.inicioMs).toLocaleDateString('pt-BR') : '';
        const statusLabel = s.status === 'encerrada' ? 'Finalizada' : 'Em andamento';
        opt.textContent = `${s.nome || 'Sessão'} (${dataStr}) — ${statusLabel}`;
        sel.appendChild(opt);
      }
    } catch (err) {
      sel.innerHTML = '<option value="">Erro ao carregar sessões</option>';
      console.error(err);
    }
  },

  alternarModoF1(modo) {
    const grpTaxa = document.getElementById('grp-fatorF1');
    const grpTempo = document.getElementById('grp-tempoFixoF1');
    if (modo === 'tempoFixo') {
      grpTaxa.style.display = 'none';
      grpTempo.style.display = 'flex';
    } else {
      grpTaxa.style.display = 'flex';
      grpTempo.style.display = 'none';
    }
  },

  atualizarLabelSlider(inpId, lblId, sulfixo = '', ehDelta = false) {
    const inp = document.getElementById(inpId);
    const lbl = document.getElementById(lblId);
    if (!inp || !lbl) return;
    const val = Number(inp.value);
    const prefixo = (ehDelta && val > 0) ? '+' : '';
    lbl.textContent = `${prefixo}${val}${sulfixo}`;
  },

  restaurarValoresPadrao() {
    document.getElementById('inp-c1').value = '1';
    document.querySelector('input[name="modoF1"][value="taxa"]').checked = true;
    this.alternarModoF1('taxa');
    document.getElementById('inp-fatorF1').value = '0';
    this.atualizarLabelSlider('inp-fatorF1', 'lbl-fatorF1', '%');
    document.getElementById('inp-tempoFixoF1').value = '4';

    document.getElementById('inp-c2').value = '1';
    document.getElementById('inp-fatorF2').value = '0';
    this.atualizarLabelSlider('inp-fatorF2', 'lbl-fatorF2', '%');

    document.getElementById('inp-capacidadeMesas').value = '216';
    document.getElementById('inp-deltaMesas').value = '0';
    this.atualizarLabelSlider('inp-deltaMesas', 'lbl-deltaMesas', ' min', true);
  },

  exibirStatus(msg, tipo = 'info') {
    const box = document.getElementById('box-status-msg');
    box.style.display = 'block';
    box.textContent = msg;
    box.className = `status-${tipo}`;
  },

  ocultarStatus() {
    const box = document.getElementById('box-status-msg');
    box.style.display = 'none';
  },

  async executarSimulacao() {
    const sessaoId = document.getElementById('sel-sessao').value;
    if (!sessaoId) {
      alert('Por favor, selecione uma sessão base para simular.');
      return;
    }

    this.exibirStatus('Carregando traço empírico e executando simulação...', 'amarelo');
    const containerResultados = document.getElementById('container-resultados');
    containerResultados.style.display = 'none';

    try {
      const res = await fetch(`/api/sessoes/${encodeURIComponent(sessaoId)}`);
      if (!res.ok) throw new Error('Não foi possível obter os dados da sessão selecionada.');
      const dadosSessao = await res.json();

      if (!dadosSessao.eventos || dadosSessao.eventos.length < 5) {
        this.exibirStatus('Esta sessão não possui dados suficientes para simulação.', 'vermelho');
        return;
      }

      // Parâmetros da simulação
      const params = {
        c1: parseInt(document.getElementById('inp-c1').value, 10) || 1,
        modoF1: document.querySelector('input[name="modoF1"]:checked')?.value || 'taxa',
        fatorF1: Number(document.getElementById('inp-fatorF1').value) || 0,
        tempoFixoF1: Number(document.getElementById('inp-tempoFixoF1').value) || 4,
        c2: parseInt(document.getElementById('inp-c2').value, 10) || 1,
        fatorF2: Number(document.getElementById('inp-fatorF2').value) || 0,
        capacidadeMesas: parseInt(document.getElementById('inp-capacidadeMesas').value, 10) || 216,
        deltaMinutosMesas: Number(document.getElementById('inp-deltaMesas').value) || 0
      };

      const resultado = simularSessao(dadosSessao.eventos, dadosSessao.meta?.config || {}, params);

      if (!resultado.sucesso) {
        this.exibirStatus(`Falha na simulação: ${resultado.motivo}`, 'vermelho');
        return;
      }

      this.ocultarStatus();
      this.renderizarResultados(resultado, dadosSessao);
      containerResultados.style.display = 'block';

    } catch (err) {
      this.exibirStatus(`Erro ao executar simulação: ${err.message}`, 'vermelho');
      console.error(err);
    }
  },

  renderizarResultados(simRes, dadosSessao) {
    const { calibracao, diagnostico, metricasSimuladas, metricasReais } = simRes;

    // 1. Banner de Calibração
    const bannerCalib = document.getElementById('banner-calibracao');
    if (calibracao.aderente) {
      bannerCalib.className = 'status-verde';
      bannerCalib.innerHTML = `<strong>✔ Calibração do Modelo Aderente:</strong> Desvio de apenas <strong>${formatarNumero(calibracao.diffPerc, 1)}%</strong> no tempo de espera do baseline em relação aos dados empíricos observados.`;
    } else {
      bannerCalib.className = 'status-amarelo';
      bannerCalib.innerHTML = `<strong>⚠️ Calibração com Variação (${formatarNumero(calibracao.diffPerc, 1)}%):</strong> O traço histórico original apresentou pequenas oscilações operacionais de campo (atendimento não-FIFO ou pausas manuais).`;
    }

    // 2. Card de Diagnóstico
    const cardDiag = document.getElementById('card-diagnostico');
    cardDiag.className = `status-card status-${diagnostico.status}`;
    cardDiag.innerHTML = `<span><strong>Diagnóstico Operacional:</strong> ${diagnostico.mensagem}</span>`;

    // 3. Tabela Comparativa de Métricas
    const tbody = document.getElementById('tbody-metricas');
    tbody.innerHTML = '';

    const mReal1 = metricasReais?.filas?.[1];
    const mSim1 = metricasSimuladas?.filas?.[1];
    const mReal2 = metricasReais?.filas?.[2];
    const mSim2 = metricasSimuladas?.filas?.[2];

    const linhas = [
      {
        nome: 'Alunos Atendidos na Catraca (n_s)',
        real: mReal1?.n_atendimentos || 0,
        sim: mSim1?.n_atendimentos || 0,
        tipo: 'int',
        inverterMelhoria: true
      },
      {
        nome: 'Tempo Médio de Espera na Fila 1 (Catraca)',
        real: mReal1?.statsEspera?.media || 0,
        sim: mSim1?.statsEspera?.media || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Mediana de Espera na Fila 1',
        real: mReal1?.statsEspera?.mediana || 0,
        sim: mSim1?.statsEspera?.mediana || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Percentil 95 (P95) de Espera Fila 1',
        real: mReal1?.statsEspera?.p95 || 0,
        sim: mSim1?.statsEspera?.p95 || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Fila Média Ponderada no Tempo (L_q1)',
        real: mReal1?.filaTempo?.mediaPonderada || 0,
        sim: mSim1?.filaTempo?.mediaPonderada || 0,
        tipo: 'num2'
      },
      {
        nome: 'Pico de Pessoas na Fila 1',
        real: mReal1?.filaTempo?.max || 0,
        sim: mSim1?.filaTempo?.max || 0,
        tipo: 'int'
      },
      {
        nome: 'Fator de Utilização das Catracas (ρ₁)',
        real: (mReal1?.utilizacao || 0) * 100,
        sim: (mSim1?.utilizacao || 0) * 100,
        tipo: 'perc'
      },
      {
        nome: 'Tempo Médio de Espera na Fila 2 (Buffet)',
        real: mReal2?.statsEspera?.media || 0,
        sim: mSim2?.statsEspera?.media || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Fator de Utilização do Buffet (ρ₂)',
        real: (mReal2?.utilizacao || 0) * 100,
        sim: (mSim2?.utilizacao || 0) * 100,
        tipo: 'perc'
      },
      {
        nome: 'Tempo Médio de Trânsito até as Mesas (F1 + F2)',
        real: metricasReais?.transitoMesas?.media || 0,
        sim: metricasSimuladas?.transitoMesas?.media || 0,
        tipo: 'tempo'
      },
      {
        nome: 'Pico de Assentos Ocupados nas Mesas',
        real: metricasReais?.mesas?.picoOcupacao || 0,
        sim: diagnostico.picoOcupacaoMesas || 0,
        tipo: 'int'
      },
      {
        nome: 'Alunos Bloqueados por Falta de Cadeiras',
        real: 0,
        sim: diagnostico.alunosBloqueadosCount || 0,
        tipo: 'int'
      }
    ];

    for (const item of linhas) {
      const tr = document.createElement('tr');
      const tdNome = document.createElement('td');
      tdNome.textContent = item.nome;

      const tdReal = document.createElement('td');
      tdReal.className = 'num';
      tdReal.textContent = this.formatarValorMetrica(item.real, item.tipo);

      const tdSim = document.createElement('td');
      tdSim.className = 'num';
      tdSim.textContent = this.formatarValorMetrica(item.sim, item.tipo);

      const tdDelta = document.createElement('td');
      tdDelta.className = 'num';

      const diff = item.sim - item.real;
      const diffPerc = item.real > 0 ? (diff / item.real) * 100 : (item.sim > 0 ? 100 : 0);

      let classeDelta = 'delta-neutro';
      if (Math.abs(diff) > 0.01) {
        const ehMelhor = item.inverterMelhoria ? diff > 0 : diff < 0;
        classeDelta = ehMelhor ? 'delta-melhoria' : 'delta-piora';
      }

      const sinal = diff > 0 ? '+' : '';
      tdDelta.className = `num ${classeDelta}`;
      tdDelta.textContent = `${sinal}${formatarNumero(diffPerc, 1)}%`;

      tr.appendChild(tdNome);
      tr.appendChild(tdReal);
      tr.appendChild(tdSim);
      tr.appendChild(tdDelta);
      tbody.appendChild(tr);
    }

    // 4. Renderizar Gráficos Chart.js
    this.renderizarGraficos(dadosSessao.eventos, simRes.eventosSimulados, diagnostico.capacidadeMesas);
  },

  formatarValorMetrica(val, tipo) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    if (tipo === 'tempo') return formatarDuracao(val * 1000);
    if (tipo === 'perc') return `${formatarNumero(val, 1)}%`;
    if (tipo === 'int') return Math.round(val).toLocaleString('pt-BR');
    return formatarNumero(val, 2);
  },

  renderizarGraficos(eventosReais, eventosSimulados, capacidadeMesas) {
    const t0 = eventosReais[0]?.t || Date.now();
    const tFim = Math.max(
      eventosReais[eventosReais.length - 1]?.t || t0,
      eventosSimulados[eventosSimulados.length - 1]?.t || t0
    );

    // Amostragem minuto a minuto (máx 120 pontos para performance ágil)
    const duracaoTotalMs = tFim - t0;
    const passoMs = Math.max(30000, Math.floor(duracaoTotalMs / 60)); // ~60 pontos
    const rotulos = [];
    const filaRealPontos = [];
    const filaSimPontos = [];
    const mesasSimPontos = [];

    for (let t = t0; t <= tFim; t += passoMs) {
      const minRelativo = Math.round((t - t0) / 60000);
      rotulos.push(`${minRelativo}m`);

      const estReal = derivarEstado(eventosReais, t);
      const estSim = derivarEstado(eventosSimulados, t);

      filaRealPontos.push(estReal?.filas?.[1]?.fila?.length || 0);
      filaSimPontos.push(estSim?.filas?.[1]?.fila?.length || 0);
      mesasSimPontos.push(estSim?.mesas?.cadeirasOcupadas || 0);
    }

    // Gráfico 1: Fila 1 no Tempo
    if (chartFilaInstance) chartFilaInstance.destroy();
    const ctxFila = document.getElementById('chart-fila-tempo').getContext('2d');
    chartFilaInstance = new Chart(ctxFila, {
      type: 'line',
      data: {
        labels: rotulos,
        datasets: [
          {
            label: 'Cenário Real',
            data: filaRealPontos,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.2,
            pointRadius: 1
          },
          {
            label: 'Cenário Simulado',
            data: filaSimPontos,
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22, 163, 74, 0.1)',
            tension: 0.2,
            pointRadius: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Pessoas na Fila' } },
          x: { title: { display: true, text: 'Tempo Decorrido' } }
        }
      }
    });

    // Gráfico 2: Ocupação das Mesas no Tempo
    if (chartMesasInstance) chartMesasInstance.destroy();
    const ctxMesas = document.getElementById('chart-mesas-tempo').getContext('2d');
    chartMesasInstance = new Chart(ctxMesas, {
      type: 'line',
      data: {
        labels: rotulos,
        datasets: [
          {
            label: 'Cadeiras Ocupadas (Simulado)',
            data: mesasSimPontos,
            borderColor: '#ec4899',
            backgroundColor: 'rgba(236, 72, 153, 0.15)',
            tension: 0.2,
            pointRadius: 1,
            fill: true
          },
          {
            label: `Capacidade Nominal (${capacidadeMesas})`,
            data: new Array(rotulos.length).fill(capacidadeMesas),
            borderColor: '#dc2626',
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Cadeiras Ocupadas' } },
          x: { title: { display: true, text: 'Tempo Decorrido' } }
        }
      }
    });
  }
};

window.SimulacoesApp = SimulacoesApp;
window.toggleTheme = function() {
  document.body.classList.toggle('dark-mode');
  const ehEscuro = document.body.classList.contains('dark-mode');
  localStorage.setItem('fila_ru_tema', ehEscuro ? 'escuro' : 'claro');
};

document.addEventListener('DOMContentLoaded', () => {
  SimulacoesApp.init();
});
