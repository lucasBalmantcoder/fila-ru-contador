/**
 * teste/testes.js
 * Suíte de testes automatizados do sistema Fila RU.
 * Executável sem frameworks externos via `node teste/testes.js`.
 */

import { derivarEstado, diffEstado } from '../shared/estado.js';
import {
  calcularEstatisticas,
  calcularComprimentoFilaTempo,
  calcularVazaoBlocos,
  calcularOciosidade,
  calcularModeloTeorico,
  verificarLeiDeLittle,
  calcularMetricas
} from '../shared/metricas.js';
import { GerenciadorSessoes } from '../server/sessao.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n================================================================');
console.log('   SUÍTE DE TESTES AUTOMATIZADOS - FILA RU');
console.log('================================================================\n');

let passou = 0;
let falhou = 0;

function assert(condicao, descricao) {
  if (condicao) {
    console.log(`  ✔ PASS: ${descricao}`);
    passou++;
  } else {
    console.error(`  ❌ FAIL: ${descricao}`);
    falhou++;
  }
}

const t0 = 1700000000000;

/* --------------------------------------------------------------------------
   1. Teste: Sessão Vazia
   -------------------------------------------------------------------------- */
console.log('\n--- 1. Sessão Vazia ---');
const estVazio = derivarEstado([]);
assert(estVazio.pessoas.length === 0, 'Estado sem eventos deve ter 0 pessoas');
assert(estVazio.fila.length === 0, 'Fila deve estar vazia');
assert(estVazio.primeiraDaFila === null, 'Primeira da fila deve ser null');
assert(estVazio.contadores.chegadas === 0, 'Contador de chegadas deve ser 0');

const metVazio = calcularMetricas([], { servidores: 1 });
assert(metVazio.n_chegadas === 0, 'Métricas vazias: chegadas = 0');
assert(metVazio.n_atendimentos === 0, 'Métricas vazias: atendimentos = 0');
assert(metVazio.lambda === 0, 'Taxa lambda deve ser 0');

/* --------------------------------------------------------------------------
   2. Teste: Evento Único (Chegada isolada)
   -------------------------------------------------------------------------- */
console.log('\n--- 2. Evento Único ---');
const evUnico = [{ seq: 1, t: t0, tipo: 'chegada', pessoa: 1, dispositivoNome: 'Cel 1' }];
const estUnico = derivarEstado(evUnico);
assert(estUnico.pessoas.length === 1, 'Deve ter 1 pessoa registrada');
assert(estUnico.fila.length === 1, 'Fila deve ter tamanho 1');
assert(estUnico.primeiraDaFila === 1, 'Pessoa 1 deve ser a primeira da fila');
assert(estUnico.pessoas[0].status === 'na_catraca', 'Status da pessoa 1 deve ser derivado para "na_catraca"');

/* --------------------------------------------------------------------------
   3. Teste: Fila FIFO e Pareamento
   -------------------------------------------------------------------------- */
console.log('\n--- 3. Fila FIFO e Pareamento ---');
const evsFifo = [
  { seq: 1, t: t0, tipo: 'chegada', pessoa: 1 },
  { seq: 2, t: t0 + 5000, tipo: 'chegada', pessoa: 2 },
  { seq: 3, t: t0 + 10000, tipo: 'atendimento', pessoa: 1 },
  { seq: 4, t: t0 + 12000, tipo: 'chegada', pessoa: 3 },
  { seq: 5, t: t0 + 18000, tipo: 'atendimento', pessoa: 2 }
];
const estFifo = derivarEstado(evsFifo);
assert(estFifo.contadores.chegadas === 3, 'Total de chegadas deve ser 3');
assert(estFifo.contadores.atendidas === 2, 'Total de atendidos deve ser 2');
assert(estFifo.fila.length === 1, 'Fila restante deve ter 1 pessoa');
assert(estFifo.primeiraDaFila === 3, 'Pessoa 3 deve ser a próxima na catraca');
assert(estFifo.pessoas.find(p => p.pessoa === 1).esperaMs === 10000, 'Pessoa 1 esperou 10.000 ms');
assert(estFifo.pessoas.find(p => p.pessoa === 2).esperaMs === 13000, 'Pessoa 2 esperou 13.000 ms');

/* --------------------------------------------------------------------------
   4. Teste: Validação do Servidor e Confirmação Simultânea
   -------------------------------------------------------------------------- */
console.log('\n--- 4. Validação e Concorrência de Comandos no Servidor ---');
const gs = new GerenciadorSessoes();
// Garante encerramento de sessão anterior se houver
if (gs.sessaoAtiva) gs.encerrarSessao();

gs.iniciarSessao({ nome: 'Teste Unitário', duracaoPrevistaMin: 60, servidores: 1, teste: true });

const disp1 = { id: 'cel_1', nome: 'Celular 1' };
const disp2 = { id: 'cel_2', nome: 'Celular 2' };

// Celular 1 registra chegada
const rCheg1 = gs.processarComando({ acao: 'chegada', clientEventId: 'c1_1' }, disp1);
assert(rCheg1.sucesso && rCheg1.evento.pessoa === 1, 'Chegada 1 aceita com pessoa = 1');

// Celular 2 registra chegada
const rCheg2 = gs.processarComando({ acao: 'chegada', clientEventId: 'c2_1' }, disp2);
assert(rCheg2.sucesso && rCheg2.evento.pessoa === 2, 'Chegada 2 aceita com pessoa = 2');

// Dois celulares tentam confirmar o atendimento da Pessoa 1 simultaneamente:
// Primeiro celular a chegar no servidor ganha:
const rAtend1 = gs.processarComando({ acao: 'atendido', pessoaEsperada: 1, clientEventId: 'c1_2' }, disp1);
assert(rAtend1.sucesso === true, 'Primeiro atendimento deve ter sucesso');

// Segundo celular tenta confirmar a mesma Pessoa 1:
const rAtend2 = gs.processarComando({ acao: 'atendido', pessoaEsperada: 1, clientEventId: 'c2_2' }, disp2);
assert(rAtend2.sucesso === false, 'Segundo atendimento da mesma pessoa deve ser rejeitado');
assert(rAtend2.codigo === 'JA_ATENDIDO', 'Código de rejeição deve ser JA_ATENDIDO');

/* --------------------------------------------------------------------------
   5. Teste: Rejeição CABECA_MUDOU
   -------------------------------------------------------------------------- */
console.log('\n--- 5. Validação CABECA_MUDOU ---');
// Celular 1 tenta atender a Pessoa 99 que não é a cabeça atual (Pessoa 2 é a cabeça)
const rMudou = gs.processarComando({ acao: 'atendido', pessoaEsperada: 99, clientEventId: 'c1_3' }, disp1);
assert(rMudou.sucesso === false && rMudou.codigo === 'CABECA_MUDOU', 'Tentativa de atender pessoa fora da catraca rejeitada com CABECA_MUDOU');

/* --------------------------------------------------------------------------
   6. Teste: Anulação da Primeira da Fila e de Pessoa Já Atendida
   -------------------------------------------------------------------------- */
console.log('\n--- 6. Anulação da Primeira da Fila e Pessoa Já Atendida ---');
// Pessoa 2 está na catraca. Vamos anulá-la da fila:
const rAnul = gs.processarComando({ acao: 'anulacao', pessoa: 2, clientEventId: 'c1_4' }, disp1);
assert(rAnul.sucesso === true && rAnul.evento.tipo === 'anulacao', 'Anulação da pessoa 2 aceita');
assert(gs.sessaoAtiva.estadoAtual.fila.length === 0, 'Fila ficou vazia após anulação');

// Tentativa de anular a Pessoa 1 (que já foi atendida anteriormente):
const rAnulAtendida = gs.processarComando({ acao: 'anulacao', pessoa: 1, clientEventId: 'c1_5' }, disp1);
assert(rAnulAtendida.sucesso === false && rAnulAtendida.codigo === 'JA_ATENDIDO', 'Anular pessoa já atendida é rejeitado com JA_ATENDIDO');

/* --------------------------------------------------------------------------
   7. Teste: Reversão de Atendimento
   -------------------------------------------------------------------------- */
console.log('\n--- 7. Reversão de Atendimento ---');
// Reverte o atendimento da Pessoa 1
const rRev = gs.processarComando({ acao: 'reversao', clientEventId: 'c1_6' }, disp1);
assert(rRev.sucesso === true && rRev.evento.tipo === 'reversao', 'Reversão aceita');
assert(rRev.evento.pessoa === 1, 'Pessoa revertida deve ser a Pessoa 1');
assert(gs.sessaoAtiva.estadoAtual.fila[0] === 1, 'Pessoa 1 deve retornar ao início da fila');
assert(gs.sessaoAtiva.estadoAtual.primeiraDaFila === 1, 'Pessoa 1 voltou a ser a primeira da fila');

/* --------------------------------------------------------------------------
   8. Teste: Idempotência por clientEventId
   -------------------------------------------------------------------------- */
console.log('\n--- 8. Idempotência por clientEventId ---');
// Envia exatamente o mesmo comando com clientEventId 'c1_1' já processado no passo 4
const rIdemp = gs.processarComando({ acao: 'chegada', clientEventId: 'c1_1' }, disp1);
assert(rIdemp.sucesso === true && rIdemp.idempotente === true, 'Comando duplicado respondido com sucesso idempotente');
assert(rIdemp.evento.seq === 2, 'Deve retornar o mesmo evento original da primeira execução');

/* --------------------------------------------------------------------------
   9. Teste: Evento Tardio (Fila Offline Reenviada)
   -------------------------------------------------------------------------- */
console.log('\n--- 9. Evento Tardio de Fila Offline ---');
const rTardio = gs.processarComando({
  acao: 'chegada',
  clientEventId: 'offline_1',
  tardio: true,
  tCliente: Date.now() - 5000
}, disp1, 100);
assert(rTardio.sucesso === true && rTardio.evento.tardio === true, 'Evento offline marcado como tardio: true');

/* --------------------------------------------------------------------------
   10. Teste: Propriedade de Reprodução Fiel (derivarEstado em cada seq)
   -------------------------------------------------------------------------- */
console.log('\n--- 10. Propriedade de Reprodução Fiel do Histórico ---');
const todosEventos = [...gs.sessaoAtiva.eventos];
let reproducaoConsistente = true;

for (let i = 1; i <= todosEventos.length; i++) {
  const subconjunto = todosEventos.slice(0, i);
  const tInstante = todosEventos[i - 1].t;
  const estParcial1 = derivarEstado(subconjunto);
  const estParcial2 = derivarEstado(todosEventos, tInstante);

  if (estParcial1.fila.length !== estParcial2.fila.length ||
      estParcial1.contadores.chegadas !== estParcial2.contadores.chegadas ||
      estParcial1.primeiraDaFila !== estParcial2.primeiraDaFila) {
    reproducaoConsistente = false;
    break;
  }
}
assert(reproducaoConsistente, 'derivarEstado(eventos, t) reproduz com 100% de exatidão o estado em cada seq');

// Encerra sessão de teste e limpa
const sFinal = gs.encerrarSessao();
assert(sFinal.evento.tipo === 'sessao_encerrada', 'Sessão encerrada com evento de encerramento');

/* --------------------------------------------------------------------------
   11. Teste Isolado das Funções de Métricas
   -------------------------------------------------------------------------- */
console.log('\n--- 11. Teste Isolado das Funções de Métricas ---');

// a) Estatísticas
const estat = calcularEstatisticas([10, 20, 30, 40, 50]);
assert(estat.media === 30, 'Média aritmética = 30');
assert(estat.mediana === 30, 'Mediana = 30');
assert(estat.min === 10 && estat.max === 50, 'Mín = 10, Máx = 50');
assert(estat.cv === (estat.desvioPadrao / 30), 'CV = DP / Média');

// b) Fila Ponderada no Tempo
const filaT = calcularComprimentoFilaTempo([
  { t: 0, tipo: 'chegada' },
  { t: 10000, tipo: 'atendimento' }
], 0, 10000);
assert(Math.abs(filaT.mediaPonderada - 1.0) < 0.001, 'Fila com 1 pessoa por 10s deve ter comprimento médio = 1.0');

// c) Modelo Teórico Erlang C (M/M/1 com lambda = 2, mu = 4, c = 1)
const mm1 = calcularModeloTeorico(2, 4, 1);
assert(mm1.aplicavel === true, 'M/M/1 com rho = 0.5 é aplicável');
assert(Math.abs(mm1.rho - 0.5) < 0.001, 'rho = 0.5');
assert(Math.abs(mm1.Lq - 0.5) < 0.001, 'Lq teórico = 0.5');

// d) Lei de Little (L = lambda * W)
const little = verificarLeiDeLittle(2.0, 4.0, 30); // 4 p/min * 0.5 min = 2.0
assert(little.consistente === true, 'Lei de Little perfeitamente consistente (diferença = 0%)');
assert(Math.abs(little.diffPerc) < 0.001, 'Diferença percentual deve ser 0%');

// e) Ociosidade
const oci = calcularOciosidade([
  { t: 0, tipo: 'atendimento' },
  { t: 70000, tipo: 'atendimento' }
], 0, 70000, 60);
assert(oci.qtdPausas === 1, 'Pausa de 70s identificada acima do limiar de 60s');
assert(oci.tempoOciosoTotalMs === 70000, 'Tempo ocioso contabilizado = 70.000 ms');

console.log('\n================================================================');
console.log(`   RESULTADO DOS TESTES: ${passou} aprovados, ${falhou} falhas.`);
console.log('================================================================\n');

if (falhou > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

