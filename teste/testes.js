/**
 * teste/testes.js
 * Suíte de testes automatizados do sistema Fila RU.
 * Executável sem frameworks externos via `node teste/testes.js`.
 */

import { derivarEstado, diffEstado, obterZonasPadrao, gerarPontosDeZonas, normalizarConfiguracao } from '../shared/estado.js';
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
const DIR_DADOS = path.resolve(__dirname, '..', 'dados');

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
if (gs.sessaoAtiva) gs.encerrarSessao();

gs.iniciarSessao({ nome: 'Teste Unitário', duracaoPrevistaMin: 60, servidores: 1, teste: true });

const disp1 = { id: 'cel_1', nome: 'Celular 1' };
const disp2 = { id: 'cel_2', nome: 'Celular 2' };

const rCheg1 = gs.processarComando({ acao: 'chegada', clientEventId: 'c1_1' }, disp1);
assert(rCheg1.sucesso && rCheg1.evento.pessoa === 1, 'Chegada 1 aceita com pessoa = 1');

const rCheg2 = gs.processarComando({ acao: 'chegada', clientEventId: 'c2_1' }, disp2);
assert(rCheg2.sucesso && rCheg2.evento.pessoa === 2, 'Chegada 2 aceita com pessoa = 2');

const rAtend1 = gs.processarComando({ acao: 'atendido', pessoaEsperada: 1, clientEventId: 'c1_2' }, disp1);
assert(rAtend1.sucesso === true, 'Primeiro atendimento deve ter sucesso');

const rAtend2 = gs.processarComando({ acao: 'atendido', pessoaEsperada: 1, clientEventId: 'c2_2' }, disp2);
assert(rAtend2.sucesso === false, 'Segundo atendimento da mesma pessoa deve ser rejeitado');
assert(rAtend2.codigo === 'JA_ATENDIDO', 'Código de rejeição deve ser JA_ATENDIDO');

/* --------------------------------------------------------------------------
   5. Teste: Rejeição CABECA_MUDOU
   -------------------------------------------------------------------------- */
console.log('\n--- 5. Validação CABECA_MUDOU ---');
const rMudou = gs.processarComando({ acao: 'atendido', pessoaEsperada: 99, clientEventId: 'c1_3' }, disp1);
assert(rMudou.sucesso === false && rMudou.codigo === 'CABECA_MUDOU', 'Tentativa de atender pessoa fora da catraca rejeitada com CABECA_MUDOU');

/* --------------------------------------------------------------------------
   6. Teste: Anulação da Primeira da Fila e de Pessoa Já Atendida
   -------------------------------------------------------------------------- */
console.log('\n--- 6. Anulação da Primeira da Fila e Pessoa Já Atendida ---');
const rAnul = gs.processarComando({ acao: 'anulacao', pessoa: 2, clientEventId: 'c1_4' }, disp1);
assert(rAnul.sucesso === true && rAnul.evento.tipo === 'anulacao', 'Anulação da pessoa 2 aceita');
assert(gs.sessaoAtiva.estadoAtual.fila.length === 0, 'Fila ficou vazia após anulação');

const rAnulAtendida = gs.processarComando({ acao: 'anulacao', pessoa: 1, clientEventId: 'c1_5' }, disp1);
assert(rAnulAtendida.sucesso === false && rAnulAtendida.codigo === 'JA_ATENDIDO', 'Anular pessoa já atendida é rejeitado com JA_ATENDIDO');

/* --------------------------------------------------------------------------
   7. Teste: Reversão de Atendimento
   -------------------------------------------------------------------------- */
console.log('\n--- 7. Reversão de Atendimento ---');
const rRev = gs.processarComando({ acao: 'reversao', clientEventId: 'c1_6' }, disp1);
assert(rRev.sucesso === true && rRev.evento.tipo === 'reversao', 'Reversão aceita');
assert(rRev.evento.pessoa === 1, 'Pessoa revertida deve ser a Pessoa 1');
assert(gs.sessaoAtiva.estadoAtual.fila[0] === 1, 'Pessoa 1 deve retornar ao início da fila');
assert(gs.sessaoAtiva.estadoAtual.primeiraDaFila === 1, 'Pessoa 1 voltou a ser a primeira da fila');

/* --------------------------------------------------------------------------
   8. Teste: Idempotência por clientEventId
   -------------------------------------------------------------------------- */
console.log('\n--- 8. Idempotência por clientEventId ---');
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

const sFinal = gs.encerrarSessao();
assert(sFinal.evento.tipo === 'sessao_encerrada', 'Sessão encerrada com evento de encerramento');

/* --------------------------------------------------------------------------
   11. Teste Isolado das Funções de Métricas
   -------------------------------------------------------------------------- */
console.log('\n--- 11. Teste Isolado das Funções de Métricas ---');

const estat = calcularEstatisticas([10, 20, 30, 40, 50]);
assert(estat.media === 30, 'Média aritmética = 30');
assert(estat.mediana === 30, 'Mediana = 30');
assert(estat.min === 10 && estat.max === 50, 'Mín = 10, Máx = 50');
assert(estat.cv === (estat.desvioPadrao / 30), 'CV = DP / Média');

const filaT = calcularComprimentoFilaTempo([
  { t: 0, tipo: 'chegada' },
  { t: 10000, tipo: 'atendimento' }
], 0, 10000);
assert(Math.abs(filaT.mediaPonderada - 1.0) < 0.001, 'Fila com 1 pessoa por 10s deve ter comprimento médio = 1.0');

const mm1 = calcularModeloTeorico(2, 4, 1);
assert(mm1.aplicavel === true, 'M/M/1 com rho = 0.5 é aplicável');
assert(Math.abs(mm1.rho - 0.5) < 0.001, 'rho = 0.5');
assert(Math.abs(mm1.Lq - 0.5) < 0.001, 'Lq teórico = 0.5');

const little = verificarLeiDeLittle(2.0, 4.0, 30);
assert(little.consistente === true, 'Lei de Little perfeitamente consistente (diferença = 0%)');
assert(Math.abs(little.diffPerc) < 0.001, 'Diferença percentual deve ser 0%');

const oci = calcularOciosidade([
  { t: 0, tipo: 'atendimento' },
  { t: 70000, tipo: 'atendimento' }
], 0, 70000, 60);
assert(oci.qtdPausas === 1, 'Pausa de 70s identificada acima do limiar de 60s');
assert(oci.tempoOciosoTotalMs === 70000, 'Tempo ocioso contabilizado = 70.000 ms');

/* ==========================================================================
   NOVOS TESTES ESPECÍFICOS DA EXPANSÃO MULTI-ZONA (SEÇÃO 10)
   ========================================================================== */

/* --------------------------------------------------------------------------
   12. Teste: Cadeias de Zonas e Fusão de Pontos
   -------------------------------------------------------------------------- */
console.log('\n--- 12. Cadeias de Zonas e Fusão de Pontos ---');

// a) Completo: Z1, Z2, Z3 -> 4 pontos
const zonasCompleto = obterZonasPadrao();
const pontosCompleto = gerarPontosDeZonas(zonasCompleto);
assert(pontosCompleto.length === 4, 'Cadeia completa (3 zonas) deve ter 4 pontos de verificação');
assert(pontosCompleto[0].id === 'origem->z1' && pontosCompleto[0].nome === 'Chegada', 'Ponto 0 deve ser Chegada (origem->z1)');
assert(pontosCompleto[1].id === 'z1->z2' && pontosCompleto[1].nome === 'Catraca', 'Ponto 1 deve ser Catraca (z1->z2)');
assert(pontosCompleto[2].id === 'z2->z3' && pontosCompleto[2].nome === 'Saída do atendimento', 'Ponto 2 deve ser Saída do atendimento (z2->z3)');
assert(pontosCompleto[3].id === 'z3->saida' && pontosCompleto[3].nome === 'Saída das mesas', 'Ponto 3 deve ser Saída das mesas (z3->saida)');

// b) Sem Mesas (Z3 desabilitada): Z1, Z2 -> 3 pontos com fusão de P2 e P3
const zonasSemMesas = [
  { id: 'z1', nome: 'Fila inicial', modo: 'fifo', habilitada: true },
  { id: 'z2', nome: 'Atendimento', modo: 'fifo', habilitada: true },
  { id: 'z3', nome: 'Mesas', modo: 'contagem', habilitada: false }
];
const pontosSemMesas = gerarPontosDeZonas(zonasSemMesas);
assert(pontosSemMesas.length === 3, 'Sem mesas (2 zonas) deve ter 3 pontos (k+1)');
assert(pontosSemMesas[2].id === 'z2->saida', 'Ponto final deve ser z2->saida (fusão de P2 e P3)');
assert(pontosSemMesas[2].nome === 'Saída do atendimento', 'Nome fundido deve ser Saída do atendimento');

// c) Somente Fila (Z2 e Z3 desabilitadas): Z1 -> 2 pontos
const zonasSomenteFila = [
  { id: 'z1', nome: 'Fila inicial', modo: 'fifo', habilitada: true },
  { id: 'z2', modo: 'fifo', habilitada: false },
  { id: 'z3', modo: 'contagem', habilitada: false }
];
const pontosSomenteFila = gerarPontosDeZonas(zonasSomenteFila);
assert(pontosSomenteFila.length === 2, 'Somente fila deve ter 2 pontos (origem->z1 e z1->saida)');
assert(pontosSomenteFila[1].id === 'z1->saida' && pontosSomenteFila[1].nome === 'Catraca', 'Ponto de saída deve ser Catraca (z1->saida)');

/* --------------------------------------------------------------------------
   13. Teste: Zona Personalizada Inserida no Meio da Cadeia
   -------------------------------------------------------------------------- */
console.log('\n--- 13. Zona Personalizada no Meio da Cadeia ---');

const zonasComCaixa = [
  { id: 'z1', nome: 'Fila inicial', cor: '#dc2626', modo: 'fifo', habilitada: true },
  { id: 'z_caixa', nome: 'Caixa Pagamento', cor: '#8b5cf6', modo: 'fifo', habilitada: true },
  { id: 'z2', nome: 'Atendimento', cor: '#16a34a', modo: 'fifo', habilitada: true },
  { id: 'z3', nome: 'Mesas', cor: '#ec4899', modo: 'contagem', habilitada: true }
];
const pontosComCaixa = gerarPontosDeZonas(zonasComCaixa);
assert(pontosComCaixa.length === 5, '4 zonas habilitadas devem gerar 5 pontos');
assert(pontosComCaixa[1].id === 'z1->z_caixa', 'Ponto 1 deve ligar z1 à nova zona z_caixa');
assert(pontosComCaixa[2].id === 'z_caixa->z2', 'Ponto 2 deve ligar z_caixa a z2');

// Fluxo sintético pela zona personalizada
const evsCaixa = [
  { seq: 1, t: t0, tipo: 'chegada', pessoa: 10, ponto: 'origem->z1' },
  { seq: 2, t: t0 + 2000, tipo: 'avanco', pessoa: 10, de: 'z1', para: 'z_caixa', ponto: 'z1->z_caixa' },
  { seq: 3, t: t0 + 5000, tipo: 'avanco', pessoa: 10, de: 'z_caixa', para: 'z2', ponto: 'z_caixa->z2' },
  { seq: 4, t: t0 + 8000, tipo: 'avanco', pessoa: 10, de: 'z2', para: 'saida', ponto: 'z2->saida' }
];
const estCaixa = derivarEstado(evsCaixa, t0 + 10000, { zonas: zonasComCaixa, pontos: pontosComCaixa });
const p10 = estCaixa.pessoas.find(p => p.pessoa === 10);
assert(p10 && p10.tempoZonaMs['z_caixa'] === 3000, 'Aluno deve permanecer 3.000 ms na zona personalizada Caixa');
assert(p10.situacao === 'saiu', 'Aluno deve concluir percurso passando pela zona personalizada');

const metCaixa = calcularMetricas(evsCaixa, { zonas: zonasComCaixa, pontos: pontosComCaixa }, t0 + 10000);
assert(metCaixa.zonas['z_caixa'].saidas === 1, 'Métricas devem contabilizar 1 saída na zona Caixa');
assert(metCaixa.zonas['z_caixa'].tempoMedioConcluidosSeg === 3.0, 'Tempo médio na zona Caixa deve ser 3.0 s');

/* --------------------------------------------------------------------------
   14. Teste: Delegação de Aparelhos e Permissões por Ponto
   -------------------------------------------------------------------------- */
console.log('\n--- 14. Delegação de Aparelhos e Permissões por Ponto ---');

const gsDeleg = new GerenciadorSessoes();
if (gsDeleg.sessaoAtiva) gsDeleg.encerrarSessao();

const configDeleg = {
  nome: 'Teste Delegação',
  zonas: obterZonasPadrao(),
  atribuicoes: {
    'disp_entrada': ['origem->z1'],
    'disp_catraca': ['z1->z2']
  },
  teste: true
};
gsDeleg.iniciarSessao(configDeleg);

const avaliadorEntrada = { id: 'disp_entrada', nome: 'Avaliador 1', papel: 'avaliador' };
const avaliadorCatraca = { id: 'disp_catraca', nome: 'Avaliador 2', papel: 'avaliador' };
const observador = { id: 'disp_obs', nome: 'Visitante', papel: 'observador' };

// a) Avaliador da entrada tenta registrar na catraca -> PONTO_NAO_ATRIBUIDO
const rBloq = gsDeleg.processarComando({ acao: 'avanco', ponto: 'z1->z2', pessoaEsperada: 1 }, avaliadorEntrada);
assert(rBloq.sucesso === false && rBloq.codigo === 'PONTO_NAO_ATRIBUIDO', 'Comando em ponto não atribuído rejeitado com PONTO_NAO_ATRIBUIDO');

// b) Observador tenta registrar chegada -> PONTO_NAO_ATRIBUIDO
const rObs = gsDeleg.processarComando({ acao: 'chegada', ponto: 'origem->z1' }, observador);
assert(rObs.sucesso === false && rObs.codigo === 'PONTO_NAO_ATRIBUIDO', 'Observador impedido de registrar com PONTO_NAO_ATRIBUIDO');

// c) Avaliador da entrada registra no seu ponto atribuído -> Sucesso
const rPerm = gsDeleg.processarComando({ acao: 'chegada', ponto: 'origem->z1' }, avaliadorEntrada);
assert(rPerm.sucesso === true && rPerm.evento.pessoa === 1, 'Avaliador registra com sucesso no seu ponto atribuído');

// d) Reatribuição dinâmica durante a coleta: delega P0 e P1 para disp_catraca
gsDeleg.atualizarAtribuicoes({
  'disp_catraca': ['origem->z1', 'z1->z2']
});
const rReatrib = gsDeleg.processarComando({ acao: 'chegada', ponto: 'origem->z1' }, avaliadorCatraca);
assert(rReatrib.sucesso === true && rReatrib.evento.pessoa === 2, 'Após reatribuição durante a coleta, novo ponto é aceito imediatamente');

// e) Operador Único (supervisor opera todos os pontos)
const supervisor = { id: 'disp_sup', nome: 'Coordenador', papel: 'supervisor' };
const rSup = gsDeleg.processarComando({ acao: 'chegada', ponto: 'origem->z1' }, supervisor);
assert(rSup.sucesso === true && rSup.evento.pessoa === 3, 'Supervisor com operador único registra em qualquer ponto');

gsDeleg.encerrarSessao();

/* --------------------------------------------------------------------------
   15. Teste: Zona de Contagem (Mesas)
   -------------------------------------------------------------------------- */
console.log('\n--- 15. Zona de Contagem (Mesas) ---');

const evsContagem = [
  { seq: 1, t: t0, tipo: 'chegada', pessoa: 1, ponto: 'origem->z1' },
  { seq: 2, t: t0 + 2000, tipo: 'chegada', pessoa: 2, ponto: 'origem->z1' },
  { seq: 3, t: t0 + 4000, tipo: 'avanco', pessoa: 1, de: 'z1', para: 'z3', ponto: 'z1->z3' },
  { seq: 4, t: t0 + 6000, tipo: 'avanco', pessoa: 2, de: 'z1', para: 'z3', ponto: 'z1->z3' },
  // Saída de z3 (modo contagem): avança a pessoa mais antiga presente com identidade estimada
  { seq: 5, t: t0 + 20000, tipo: 'avanco', pessoa: 1, de: 'z3', para: 'saida', ponto: 'z3->saida', identidade: 'estimada' },
  { seq: 6, t: t0 + 26000, tipo: 'avanco', pessoa: 2, de: 'z3', para: 'saida', ponto: 'z3->saida', identidade: 'estimada' }
];

const zonasContagemConfig = [
  { id: 'z1', nome: 'Fila', modo: 'fifo', habilitada: true },
  { id: 'z3', nome: 'Mesas', modo: 'contagem', habilitada: true, capacidade: 50 }
];

const estCont = derivarEstado(evsContagem, t0 + 30000, { zonas: zonasContagemConfig });
const metCont = calcularMetricas(evsContagem, { zonas: zonasContagemConfig }, t0 + 30000);

assert(estCont.pessoas.find(p => p.pessoa === 1).identidadeSaida['z3'] === 'estimada', 'Identidade de saída em zona contagem deve ser "estimada"');
assert(metCont.zonas['z3'].statsTempo.rotuloPercentis.includes('estimado'), 'Percentis em zona contagem devem conter rótulo de estimado');
assert(metCont.zonas['z3'].tempoMedioConcluidosSeg === 18.0, 'Tempo médio da zona de contagem deve ser exato (18s)');

/* --------------------------------------------------------------------------
   16. Teste: Inversão Temporal (Jusante antes de Montante) e Expiração
   -------------------------------------------------------------------------- */
console.log('\n--- 16. Inversão Temporal e Expiração ---');

const gsInv = new GerenciadorSessoes();
if (gsInv.sessaoAtiva) gsInv.encerrarSessao();

gsInv.iniciarSessao({
  nome: 'Teste Inversão',
  zonas: obterZonasPadrao(),
  janelaInversaoS: 5, // Janela curta de 5 segundos para teste
  teste: true
});

const autorA = { id: 'autor_p0', nome: 'Entrada', papel: 'supervisor' };
const autorB = { id: 'autor_p1', nome: 'Catraca', papel: 'supervisor' };

// Cenário 1: Z1 está vazia. O operador da catraca (P1: z1->z2) clica antes da chegada em P0.
const tP1 = Date.now();
const rInvPendente = gsInv.processarComando({
  acao: 'avanco',
  ponto: 'z1->z2',
  clientEventId: 'inv_downstream_1'
}, autorB);

assert(rInvPendente.sucesso === true && rInvPendente.pendenteInversao === true, 'Comando a jusante com zona vazia fica pendente por inversão');
assert(gsInv.sessaoAtiva.pendentesInversao.size === 1, 'Deve haver 1 evento retido na fila de pendentes de inversão');

// Logo em seguida (100 ms depois), chega o registro a montante de P0 (chegada da Pessoa 1)
const rChegMontante = gsInv.processarComando({
  acao: 'chegada',
  ponto: 'origem->z1',
  clientEventId: 'inv_upstream_1'
}, autorA);

assert(rChegMontante.sucesso === true && rChegMontante.evento.inversaoCorrigida === true, 'Evento a montante associado e marcado como inversaoCorrigida: true');
assert(gsInv.sessaoAtiva.pendentesInversao.size === 0, 'Fila de inversão pendente deve ter sido esvaziada');

const evJusante = gsInv.sessaoAtiva.eventos.find(e => e.clientEventId === 'inv_downstream_1');
assert(evJusante && evJusante.inversaoCorrigida === true, 'Evento jusante gravado com inversaoCorrigida: true');
assert(rChegMontante.evento.tEfetivo <= evJusante.tEfetivo, 'tEfetivo do evento a montante corrigido para ser <= ao jusante');

// Cenário 2: Evento pendente que expira sem registro a montante
// z1 está vazia novamente (Pessoa 1 já avançou para z2)
const rInvExpira = gsInv.processarComando({
  acao: 'avanco',
  ponto: 'z1->z2',
  clientEventId: 'inv_expira_1'
}, autorB);
assert(rInvExpira.pendenteInversao === true, 'Segundo evento a jusante fica pendente');

// Força expiração simulando passagem do tempo além da janela (25s > janela de 20s)
const agoraSimulado = Date.now() + 25000;
let expiradoNotificado = null;
const expirados = gsInv.descartarPendentesExpirados(agoraSimulado, (pend) => {
  expiradoNotificado = pend;
});

assert(expirados.length === 1, 'Evento pendente deve ser descartado após expiração da janela');
assert(expiradoNotificado && expiradoNotificado.clientEventId === 'inv_expira_1', 'Dispositivo deve ser notificado sobre a expiração');

const rejeitados = gsInv.obterUltimosRejeitados(10);
const rejExp = rejeitados.find(r => r.codigo === 'EXPIRADO');
assert(rejExp !== undefined, 'Código de rejeição EXPIRADO registrado no log de auditoria');

gsInv.encerrarSessao();

/* --------------------------------------------------------------------------
   17. Teste: Reversão após Avanço e Bloqueio se Já Avançou
   -------------------------------------------------------------------------- */
console.log('\n--- 17. Reversão após Avanço e Bloqueio PESSOA_JA_AVANCOU ---');

const gsRev = new GerenciadorSessoes();
if (gsRev.sessaoAtiva) gsRev.encerrarSessao();

gsRev.iniciarSessao({ nome: 'Teste Reversão Avanço', zonas: obterZonasPadrao(), teste: true });
const sup = { id: 'op', nome: 'Operador', papel: 'supervisor' };

// Pessoa 1 entra em z1 e avança para z2
gsRev.processarComando({ acao: 'chegada', ponto: 'origem->z1', clientEventId: 'ch_1' }, sup);
gsRev.processarComando({ acao: 'avanco', ponto: 'z1->z2', pessoaEsperada: 1, clientEventId: 'av_1' }, sup);

assert(gsRev.sessaoAtiva.estadoAtual.zonas['z2'].fila.includes(1), 'Pessoa 1 deve estar em Z2');

// Reverte o avanço em z1->z2
const rRevP1 = gsRev.processarComando({ acao: 'reversao', ponto: 'z1->z2', clientEventId: 'rev_1' }, sup);
assert(rRevP1.sucesso === true, 'Reversão do avanço em z1->z2 aceita');
assert(gsRev.sessaoAtiva.estadoAtual.zonas['z1'].fila[0] === 1, 'Pessoa 1 deve ter retornado à cabeça de Z1');
assert(gsRev.sessaoAtiva.estadoAtual.zonas['z2'].fila.length === 0, 'Z2 deve ter ficado vazia após reversão');

// Agora avança Pessoa 1 para Z2, e depois de Z2 para Z3
gsRev.processarComando({ acao: 'avanco', ponto: 'z1->z2', pessoaEsperada: 1, clientEventId: 'av_1_novo' }, sup);
gsRev.processarComando({ acao: 'avanco', ponto: 'z2->z3', pessoaEsperada: 1, clientEventId: 'av_2' }, sup);

assert(gsRev.sessaoAtiva.estadoAtual.zonas['z3'].fila.includes(1), 'Pessoa 1 agora está em Z3');

// Tenta reverter o evento de P1 (z1->z2): deve ser REJEITADO com PESSOA_JA_AVANCOU
const rRevBloq = gsRev.processarComando({ acao: 'reversao', ponto: 'z1->z2', clientEventId: 'rev_invalida' }, sup);
assert(rRevBloq.sucesso === false && rRevBloq.codigo === 'PESSOA_JA_AVANCOU', 'Reversão de ponto anterior bloqueada com PESSOA_JA_AVANCOU');

gsRev.encerrarSessao();

/* --------------------------------------------------------------------------
   18. Teste: Anulação em Cada Zona (FIFO e Contagem)
   -------------------------------------------------------------------------- */
console.log('\n--- 18. Anulação em Cada Zona ---');

const gsAnul = new GerenciadorSessoes();
if (gsAnul.sessaoAtiva) gsAnul.encerrarSessao();

gsAnul.iniciarSessao({ nome: 'Teste Anulação Multi-Zona', zonas: obterZonasPadrao(), teste: true });

// Aluno 1 em Z1, Aluno 2 em Z2, Aluno 3 em Z3
gsAnul.processarComando({ acao: 'chegada', ponto: 'origem->z1', clientEventId: 'a_ch1' }, sup);
gsAnul.processarComando({ acao: 'chegada', ponto: 'origem->z1', clientEventId: 'a_ch2' }, sup);
gsAnul.processarComando({ acao: 'chegada', ponto: 'origem->z1', clientEventId: 'a_ch3' }, sup);

gsAnul.processarComando({ acao: 'avanco', ponto: 'z1->z2', pessoaEsperada: 1, clientEventId: 'a_av1' }, sup);
gsAnul.processarComando({ acao: 'avanco', ponto: 'z2->z3', pessoaEsperada: 1, clientEventId: 'a_av2' }, sup); // Pessoa 1 em Z3

gsAnul.processarComando({ acao: 'avanco', ponto: 'z1->z2', pessoaEsperada: 2, clientEventId: 'a_av3' }, sup); // Pessoa 2 em Z2
// Pessoa 3 em Z1

// a) Anula Pessoa 3 em Z1 (fila inicial)
const rAnulZ1 = gsAnul.processarComando({ acao: 'anulacao', pessoa: 3, zona: 'z1', clientEventId: 'an_z1' }, sup);
assert(rAnulZ1.sucesso === true && rAnulZ1.evento.zona === 'z1', 'Anulação da Pessoa 3 em Z1 aceita');
assert(!gsAnul.sessaoAtiva.estadoAtual.zonas['z1'].fila.includes(3), 'Pessoa 3 removida de Z1');

// b) Anula Pessoa 2 em Z2 (atendimento)
const rAnulZ2 = gsAnul.processarComando({ acao: 'anulacao', pessoa: 2, zona: 'z2', clientEventId: 'an_z2' }, sup);
assert(rAnulZ2.sucesso === true && rAnulZ2.evento.zona === 'z2', 'Anulação da Pessoa 2 em Z2 aceita');
assert(!gsAnul.sessaoAtiva.estadoAtual.zonas['z2'].fila.includes(2), 'Pessoa 2 removida de Z2');

// c) Anulação em Z3 (contagem) sem especificar ID (correção de contagem -1)
const rAnulZ3 = gsAnul.processarComando({ acao: 'anulacao', zona: 'z3', ponto: 'z3->saida', clientEventId: 'an_z3' }, sup);
assert(rAnulZ3.sucesso === true && rAnulZ3.evento.pessoa === 1, 'Anulação anônima na zona de contagem remove pessoa presente como correção');
assert(gsAnul.sessaoAtiva.estadoAtual.zonas['z3'].fila.length === 0, 'Z3 ficou vazia após correção');

gsAnul.encerrarSessao();

/* --------------------------------------------------------------------------
   19. Teste: Balanço Estrito de Consistência (Chegadas - Saídas - Anuladas = Presentes)
   -------------------------------------------------------------------------- */
console.log('\n--- 19. Balanço Estrito de Consistência ---');

const evsBalanco = [
  { seq: 1, t: t0, tipo: 'chegada', pessoa: 1 },
  { seq: 2, t: t0 + 1000, tipo: 'chegada', pessoa: 2 },
  { seq: 3, t: t0 + 2000, tipo: 'chegada', pessoa: 3 },
  { seq: 4, t: t0 + 3000, tipo: 'chegada', pessoa: 4 },
  { seq: 5, t: t0 + 4000, tipo: 'chegada', pessoa: 5 },
  // Pessoa 1 sai
  { seq: 6, t: t0 + 5000, tipo: 'avanco', pessoa: 1, de: 'z1', para: 'saida', ponto: 'z1->saida' },
  // Pessoa 2 sai
  { seq: 7, t: t0 + 6000, tipo: 'avanco', pessoa: 2, de: 'z1', para: 'saida', ponto: 'z1->saida' },
  // Pessoa 3 é anulada
  { seq: 8, t: t0 + 7000, tipo: 'anulacao', pessoa: 3, zona: 'z1' }
  // Pessoas 4 e 5 continuam presentes em z1
];

const metBalanco = calcularMetricas(evsBalanco, {}, t0 + 10000);
assert(metBalanco.balanco.chegadas === 5, 'Total de chegadas no balanço = 5');
assert(metBalanco.balanco.saidas === 2, 'Total de concluídos (saídas) no balanço = 2');
assert(metBalanco.balanco.anuladas === 1, 'Total de anuladas no balanço = 1');
assert(metBalanco.balanco.presentes === 2, 'Total de alunos presentes = 2');
assert(metBalanco.balanco.consistente === true, 'Balanço perfeitamente consistente: 5 - 2 - 1 = 2');

/* --------------------------------------------------------------------------
   20. Teste: Migração e Compatibilidade com Sessão Antiga Gravada em Disco
   -------------------------------------------------------------------------- */
console.log('\n--- 20. Migração de Sessão Antiga em Disco ---');

// Procura uma sessão antiga salva em dados/ (sem versão do esquema)
const entradasDados = fs.readdirSync(DIR_DADOS, { withFileTypes: true });
const sessaoAntigaDir = entradasDados.find(e => e.isDirectory() && e.name.startsWith('sessao_'));

if (sessaoAntigaDir) {
  const caminhoDir = path.join(DIR_DADOS, sessaoAntigaDir.name);
  const metaAntigo = JSON.parse(fs.readFileSync(path.join(caminhoDir, 'metadados.json'), 'utf-8'));
  const linhasEvs = fs.readFileSync(path.join(caminhoDir, 'eventos.jsonl'), 'utf-8').split('\n').filter(l => l.trim().length > 0);
  const evsAntigos = linhasEvs.map(l => JSON.parse(l));

  const estadoMigrado = derivarEstado(evsAntigos, metaAntigo.fimMs || Infinity, metaAntigo.config);
  assert(estadoMigrado.pessoas.length > 0, 'Sessão antiga abre e reconstrói pessoas sem erros');

  const metricasMigradas = calcularMetricas(evsAntigos, metaAntigo.config, metaAntigo.fimMs);
  assert(metricasMigradas.n_chegadas > 0, 'Métricas da sessão legada continuam calculando chegadas');
  assert(metricasMigradas.balanco.consistente === true, 'Balanço da sessão legada é consistente');
} else {
  console.log('  ℹ Nenhuma sessão antiga em disco encontrada para teste de arquivo.');
}

// Limpeza de pastas temporárias de teste criadas durante esta execução
const agoraFim = Date.now();
for (const ent of fs.readdirSync(DIR_DADOS, { withFileTypes: true })) {
  if (ent.isDirectory() && ent.name.startsWith('sessao_')) {
    const metaP = path.join(DIR_DADOS, ent.name, 'metadados.json');
    if (fs.existsSync(metaP)) {
      try {
        const m = JSON.parse(fs.readFileSync(metaP, 'utf-8'));
        if (m.teste === true && (agoraFim - (m.inicioMs || 0) < 300000) && (m.inicioMs || 0) > 1792588844181) {
          fs.rmSync(path.join(DIR_DADOS, ent.name), { recursive: true, force: true });
        }
      } catch (e) {}
    }
  }
}

console.log('\n================================================================');
console.log(`   RESULTADO DOS TESTES: ${passou} aprovados, ${falhou} falhas.`);
console.log('================================================================\n');

if (falhou > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
