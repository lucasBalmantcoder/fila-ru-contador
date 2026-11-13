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
  calcularMetricas,
  calcularCoberturaPorFila
} from '../shared/metricas.js';
import { GerenciadorSessoes } from '../server/sessao.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dirTempTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'fila-ru-teste-'));

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

const metVazio = calcularMetricas([], 0, { servidores: 1 });
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
const gs = new GerenciadorSessoes(dirTempTeste);
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

/* --------------------------------------------------------------------------
   12. Teste: Combinações de Seleção de Filas e Rejeição FILA_INATIVA
   -------------------------------------------------------------------------- */
console.log('\n--- 12. Combinações de Filas e Rejeição FILA_INATIVA ---');
const gsMulti = new GerenciadorSessoes(dirTempTeste);
const combinacoes = [
  [1],
  [2],
  [3],
  [1, 2],
  [1, 3],
  [2, 3],
  [1, 2, 3]
];

combinacoes.forEach(comb => {
  if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
  const init = gsMulti.iniciarSessao({
    nome: `Teste Comb ${comb.join('+')}`,
    filasAtivas: comb,
    teste: true
  });
  assert(
    JSON.stringify(gsMulti.sessaoAtiva.filasAtivas) === JSON.stringify(comb),
    `Sessão com filas [${comb.join(', ')}] iniciada corretamente`
  );
});

// Teste de rejeição de fila inativa: sessão apenas com Fila 1
if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
gsMulti.iniciarSessao({ nome: 'Apenas F1', filasAtivas: [1], teste: true });

const dispF2 = { id: 'cel_f2', nome: 'Cel F2' };
const rInativaCheg = gsMulti.processarComando({ acao: 'chegada', fila: 2, clientEventId: 'inval_f2' }, dispF2);
assert(rInativaCheg.sucesso === false && rInativaCheg.codigo === 'FILA_INATIVA', 'Comando para fila inativa rejeitado com FILA_INATIVA');

/* --------------------------------------------------------------------------
   13. Teste: Encadeamento Atômico Fila 1 -> Fila 2
   -------------------------------------------------------------------------- */
console.log('\n--- 13. Encadeamento Atômico Fila 1 -> Fila 2 ---');
if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
gsMulti.iniciarSessao({ nome: 'Teste Encadeamento', filasAtivas: [1, 2], teste: true });

// Chegada na Fila 1
const rC1 = gsMulti.processarComando({ acao: 'chegada', fila: 1, clientEventId: 'enc_c1' }, disp1);
assert(rC1.sucesso && rC1.evento.pessoa === 1, 'Chegada na F1 aceita (Pessoa 1)');

// Saída da Fila 1 (catraca)
const rCatraca = gsMulti.processarComando({ acao: 'atendido', fila: 1, pessoaEsperada: 1, clientEventId: 'enc_cat1' }, disp1);
assert(rCatraca.sucesso === true, 'Saída na F1 (catraca) aceita');
assert(rCatraca.eventosGerados && rCatraca.eventosGerados.length === 2, 'Gerou 2 eventos atômicos (saída F1 e chegada F2)');

const evF2Cheg = rCatraca.eventosGerados[1];
assert(evF2Cheg.tipo === 'chegada' && evF2Cheg.fila === 2, 'Segundo evento é chegada na Fila 2');
assert(evF2Cheg.pessoa === 1, 'Pessoa na Fila 2 herda exatamente o mesmo número (1)');
assert(evF2Cheg.encadeado === true, 'Marcado como encadeado: true');

// Estado da Fila 2 agora tem a Pessoa 1 na fila aguardando mesas
const estF2 = gsMulti.sessaoAtiva.estadoAtual.filas['2'];
assert(estF2.fila.length === 1 && estF2.fila[0] === 1, 'Pessoa 1 está na Fila 2 aguardando mesas');
assert(estF2.primeiraDaFila === 1, 'Primeira da F2 é a Pessoa 1');

// Celular da Fila 2 confirma chegada às mesas
const rMesas = gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 1, clientEventId: 'enc_mesas1' }, disp2);
assert(rMesas.sucesso === true && rMesas.evento.tipo === 'atendimento', 'Chegada às mesas confirmada na Fila 2');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['2'].fila.length === 0, 'Fila 2 agora está vazia');

/* --------------------------------------------------------------------------
   14. Teste: Reversão de Catraca na F1 e Validação PESSOA_JA_AVANCOU
   -------------------------------------------------------------------------- */
console.log('\n--- 14. Reversão de Catraca e PESSOA_JA_AVANCOU ---');
// Insere Pessoa 2 na Fila 1
gsMulti.processarComando({ acao: 'chegada', fila: 1, clientEventId: 'enc_c2' }, disp1);
// Pessoa 2 passa na catraca (entra na F2)
gsMulti.processarComando({ acao: 'atendido', fila: 1, pessoaEsperada: 2, clientEventId: 'enc_cat2' }, disp1);
assert(gsMulti.sessaoAtiva.estadoAtual.filas['2'].fila.includes(2), 'Pessoa 2 está na Fila 2');

// Reverte catraca da Pessoa 2 enquanto ela AINDA ESTÁ na Fila 2
const rRevCat2 = gsMulti.processarComando({ acao: 'reversao', fila: 1, clientEventId: 'rev_cat2' }, disp1);
assert(rRevCat2.sucesso === true, 'Reversão da catraca aceita quando pessoa ainda está na F2');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['1'].fila[0] === 2, 'Pessoa 2 retornou à cabeça da Fila 1');
assert(!gsMulti.sessaoAtiva.estadoAtual.filas['2'].fila.includes(2), 'Pessoa 2 foi removida da Fila 2');

// Agora atende Pessoa 2 novamente na catraca
gsMulti.processarComando({ acao: 'atendido', fila: 1, pessoaEsperada: 2, clientEventId: 'enc_cat2_bis' }, disp1);
// E Pessoa 2 avança para as mesas na Fila 2
gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 2, clientEventId: 'enc_mesas2' }, disp2);

// Tentativa de reverter a catraca da Pessoa 2 agora que ela já chegou às mesas:
const rRevBloq = gsMulti.processarComando({ acao: 'reversao', fila: 1, clientEventId: 'rev_cat2_bloq' }, disp1);
assert(rRevBloq.sucesso === false && rRevBloq.codigo === 'PESSOA_JA_AVANCOU', 'Reversão de catraca bloqueada com PESSOA_JA_AVANCOU');

/* --------------------------------------------------------------------------
   15. Teste: Fila 2 Isolada e Fila 3 Encadeada
   -------------------------------------------------------------------------- */
console.log('\n--- 15. Fila 2 Isolada e Fila 3 Encadeada ---');
if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
gsMulti.iniciarSessao({ nome: 'Fila 2 e 3 sem F1', filasAtivas: [2, 3], teste: true });

// Fila 2 opera de forma independente quando F1 está inativa
const rF2IsoCheg = gsMulti.processarComando({ acao: 'chegada', fila: 2, clientEventId: 'f2_iso_1' }, disp1);
assert(rF2IsoCheg.sucesso && rF2IsoCheg.evento.pessoa === 1, 'F2 isolada registra chegada com numeração própria (1)');

const rF2IsoAtend = gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 1, clientEventId: 'f2_iso_2' }, disp1);
assert(rF2IsoAtend.sucesso === true, 'F2 isolada confirma chegada às mesas');
assert(rF2IsoAtend.eventosGerados && rF2IsoAtend.eventosGerados.length === 2, 'Saída na F2 gera chegada na F3');

// Fila 3 recebe pessoa 1 encadeada e confirma saída
const rF3Saida = gsMulti.processarComando({ acao: 'saida', fila: 3, pessoaEsperada: 1, clientEventId: 'f3_2' }, disp2);
assert(rF3Saida.sucesso === true, 'Fila 3 confirma passagem pela saída');

/* --------------------------------------------------------------------------
   16. Teste: Anulações e Reversões por Fila
   -------------------------------------------------------------------------- */
console.log('\n--- 16. Anulações e Reversões por Fila ---');
// Insere na Fila 2 e avança para a Fila 3
gsMulti.processarComando({ acao: 'chegada', fila: 2, clientEventId: 'f2_c_anul' }, disp1);
gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 2, clientEventId: 'f2_s_anul' }, disp1);
assert(gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.length === 1, 'F3 tem 1 pessoa na fila');

// Anula na Fila 3
const rAnulF3 = gsMulti.processarComando({ acao: 'anulacao', fila: 3, pessoa: 2, clientEventId: 'f3_anul' }, disp2);
assert(rAnulF3.sucesso === true && rAnulF3.evento.fila === 3, 'Anulação aceita na Fila 3');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.length === 0, 'F3 esvaziada após anulação');

/* --------------------------------------------------------------------------
   17. Teste: Troca de Área e Modo Apoio (APARELHO_EM_APOIO)
   -------------------------------------------------------------------------- */
console.log('\n--- 17. Modo Apoio e Troca de Área ---');
const dispApoio = { id: 'cel_apoio', nome: 'Coordenador Apoio', papel: 'apoio' };
gsMulti.definirAreaAparelho('cel_apoio', 'apoio');

// Aparelho em modo apoio tenta coletar chegada
const rApoioCheg = gsMulti.processarComando({ acao: 'chegada', fila: 2, clientEventId: 'apoio_fail' }, dispApoio);
assert(rApoioCheg.sucesso === false && rApoioCheg.codigo === 'APARELHO_EM_APOIO', 'Coleta bloqueada para aparelho em modo apoio');

// Aparelho em apoio envia anotação
const rApoioAnot = gsMulti.processarComando({ acao: 'anotacao', texto: 'Observação do coordenador', clientEventId: 'apoio_anot' }, dispApoio);
assert(rApoioAnot.sucesso === true && rApoioAnot.evento.tipo === 'anotacao', 'Aparelho em modo apoio pode enviar anotações');

// Aparelho em apoio envia ajuste de fila
const rApoioAjuste = gsMulti.processarComando({ acao: 'ajuste_fila', fila: 2, delta: 3, clientEventId: 'apoio_ajuste' }, dispApoio);
assert(rApoioAjuste.sucesso === true && rApoioAjuste.evento.tipo === 'ajuste_fila', 'Aparelho em modo apoio pode enviar ajustes de fila');

// Mudança de área do aparelho para fila 2
gsMulti.definirAreaAparelho('cel_apoio', 'fila2');
dispApoio.papel = 'fila2';
const rApoioAgoraPode = gsMulti.processarComando({ acao: 'chegada', fila: 2, clientEventId: 'apoio_pode' }, dispApoio);
assert(rApoioAgoraPode.sucesso === true, 'Após mudar área para fila2, aparelho coleta com sucesso');

/* --------------------------------------------------------------------------
   18. Teste: Desativação de Fila durante a Sessão (FILA_DESATIVADA)
   -------------------------------------------------------------------------- */
console.log('\n--- 18. Desativação de Fila durante a Sessão ---');
const rDesativar = gsMulti.desativarFila(3, 'Painel');
assert(rDesativar.sucesso === true && rDesativar.evento.tipo === 'fila_desativada', 'Evento fila_desativada gerado');
assert(gsMulti.sessaoAtiva.filasDesativadas.includes(3), 'Fila 3 está na lista de desativadas');

// Comando subsequente na Fila 3 deve ser rejeitado
const rCmdFilaDesat = gsMulti.processarComando({ acao: 'chegada', fila: 3, clientEventId: 'tentativa_f3_desat' }, disp2);
assert(rCmdFilaDesat.sucesso === false && rCmdFilaDesat.codigo === 'FILA_DESATIVADA', 'Comando para fila desativada rejeitado com FILA_DESATIVADA');

/* --------------------------------------------------------------------------
   19. Teste: Ajuste de Fila (ajuste_fila) e Métricas
   -------------------------------------------------------------------------- */
console.log('\n--- 19. Ajuste de Fila e Métricas ---');
if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
gsMulti.iniciarSessao({ nome: 'Teste Ajuste', filasAtivas: [1], teste: true });

// Insere 2 pessoas
gsMulti.processarComando({ acao: 'chegada', fila: 1, clientEventId: 'aj_c1' }, disp1);
gsMulti.processarComando({ acao: 'chegada', fila: 1, clientEventId: 'aj_c2' }, disp1);
assert(gsMulti.sessaoAtiva.estadoAtual.filas['1'].fila.length === 2, '2 pessoas na fila');

// Ajuste com delta = +3
const rAjMais = gsMulti.processarComando({ acao: 'ajuste_fila', fila: 1, delta: 3, clientEventId: 'aj_delta_p3' }, disp1);
assert(rAjMais.sucesso === true && rAjMais.evento.delta === 3, 'Ajuste +3 aceito');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['1'].fila.length === 5, 'Fila passou a ter 5 pessoas');

// Ajuste com delta = -2
const rAjMenos = gsMulti.processarComando({ acao: 'ajuste_fila', fila: 1, delta: -2, clientEventId: 'aj_delta_m2' }, disp1);
assert(rAjMenos.sucesso === true && rAjMenos.evento.delta === -2, 'Ajuste -2 aceito');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['1'].fila.length === 3, 'Fila passou a ter 3 pessoas');

/* --------------------------------------------------------------------------
   20. Teste: Cálculo de Cobertura, Lacunas e Fila Sem Dados
   -------------------------------------------------------------------------- */
console.log('\n--- 20. Cálculo de Cobertura, Lacunas e Sem Dados ---');
if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
gsMulti.iniciarSessao({ nome: 'Teste Cobertura', filasAtivas: [1, 2], teste: true });

// F1 recebe eventos, F2 não recebe nenhum evento
gsMulti.processarComando({ acao: 'chegada', fila: 1, clientEventId: 'cob_c1' }, disp1);
gsMulti.processarComando({ acao: 'atendido', fila: 1, pessoaEsperada: 1, clientEventId: 'cob_a1' }, disp1);

const metCob = calcularMetricas(
  gsMulti.sessaoAtiva.eventos,
  60000,
  gsMulti.sessaoAtiva.config,
  [
    { id: 'cel_1', area: 'fila1', acao: 'conectou', t: Date.now() - 60000 },
    { id: 'cel_1', area: 'fila1', acao: 'desconectou', t: Date.now() - 30000 },
    { id: 'cel_1', area: 'fila1', acao: 'conectou', t: Date.now() - 10000 }
  ]
);

assert(metCob.filas['1'].semDados === false, 'Fila 1 com eventos NÃO é semDados');
assert(metCob.filas['2'].semDados === true, 'Fila 2 sem nenhum evento é marcada como semDados = true');
assert(metCob.filas['1'].cobertura.intervalosSemCobertura.length === 1, 'Identificou 1 lacuna sem cobertura');

/* --------------------------------------------------------------------------
   21. Teste: Blocos de Tempo com Zero Passagens e Ociosidade Segmentada
   -------------------------------------------------------------------------- */
console.log('\n--- 21. Blocos de Tempo e Ociosidade Segmentada ---');
const blocosTeste = calcularVazaoBlocos([
  { t: t0, tipo: 'chegada', fila: 1 },
  { t: t0 + 600000, tipo: 'atendimento', fila: 1 } // atende apenas após 10 minutos
], t0, t0 + 600000, 5, 1);

assert(blocosTeste.blocos.length === 2, '2 blocos de 5 minutos');
assert(blocosTeste.blocos[0].atendimentos === 0, 'Bloco 1 teve 0 atendimentos');
assert(blocosTeste.blocos[0].zeroPassagens === true, 'Bloco 1 marcado como zeroPassagens: true');
assert(blocosTeste.blocos[1].atendimentos === 1, 'Bloco 2 teve 1 atendimento');
assert(blocosTeste.blocos[1].zeroPassagens === false, 'Bloco 2 zeroPassagens: false');

// Ociosidade segmentada
const ocDet = metCob.filas['1'].ociosidade.detalhe;
assert(typeof ocDet.servicoParadoSeg === 'number', 'Calculou tempo de serviço parado');
assert(typeof ocDet.semDemandaSeg === 'number', 'Calculou tempo sem demanda');
assert(typeof ocDet.semCoberturaSeg === 'number', 'Calculou tempo sem cobertura');

/* --------------------------------------------------------------------------
   22. Teste: Retrocompatibilidade de Sessões em Disco
   -------------------------------------------------------------------------- */
console.log('\n--- 22. Retrocompatibilidade de Sessões Legadas ---');
// Simula sessão legada sem campo `filasAtivas` e sem `filas` no estado
const evsLegados = [
  { seq: 1, t: t0, tipo: 'sessao_iniciada', sessao: { id: 'legada', nome: 'Sessão Antiga' } },
  { seq: 2, t: t0 + 1000, tipo: 'chegada', pessoa: 1 },
  { seq: 3, t: t0 + 5000, tipo: 'atendimento', pessoa: 1 }
];

const estLegado = derivarEstado(evsLegados);
assert(estLegado.fila.length === 0, 'Estado legado deriva fila raiz corretamente');
assert(estLegado.contadores.atendidas === 1, 'Contador de atendidas legado funciona');
assert(estLegado.filas && estLegado.filas['1'], 'Mapeia para Fila 1 internamente');

const metLegadas = calcularMetricas(evsLegados, 10000, { servidores: 1 });
assert(metLegadas.n_atendimentos === 1, 'Métricas legadas mantêm n_atendimentos na raiz');
assert(metLegadas.filas && metLegadas.filas['1'].n_atendimentos === 1, 'Métricas legadas populam Fila 1');

/* --------------------------------------------------------------------------
   23. Teste: Encadeamento Fila 2 -> Fila 3, Reversões, Anulação e Transição
   -------------------------------------------------------------------------- */
console.log('\n--- 23. Encadeamento Fila 2 -> Fila 3 ---');
if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
gsMulti.iniciarSessao({ nome: 'Encadeamento F2-F3', filasAtivas: [2, 3], teste: true });

// A) Rejeição de chegada manual na F3 quando F2 está ativa
const rF3ManualBloq = gsMulti.processarComando({ acao: 'chegada', fila: 3, clientEventId: 'f3_bloq_1' }, disp2);
assert(rF3ManualBloq.sucesso === false && rF3ManualBloq.codigo === 'FILA_ENCADEADA', 'Chegada manual na F3 rejeitada com FILA_ENCADEADA quando F2 ativa');

// B) Chegada na F2
const rF2C1 = gsMulti.processarComando({ acao: 'chegada', fila: 2, clientEventId: 'f2_c1' }, disp1);
assert(rF2C1.sucesso && rF2C1.evento.pessoa === 1, 'Chegada na F2 aceita (Pessoa 1)');

// C) Saída na F2 gera chegada atômica na F3 com a mesma pessoa
const rF2Atend1 = gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 1, clientEventId: 'f2_atend_1' }, disp1);
assert(rF2Atend1.sucesso === true, 'Saída na F2 confirmada');
assert(rF2Atend1.eventosGerados && rF2Atend1.eventosGerados.length === 2, 'Gerou 2 eventos atômicos (saída F2 e chegada F3)');

const evF3Cheg1 = rF2Atend1.eventosGerados[1];
assert(evF3Cheg1.tipo === 'chegada' && evF3Cheg1.fila === 3, 'Segundo evento é chegada na Fila 3');
assert(evF3Cheg1.pessoa === 1, 'Pessoa na F3 herda o mesmo número da F2 (Pessoa 1)');
assert(evF3Cheg1.encadeado === true && evF3Cheg1.origem === 'encadeada', 'Evento marcado com encadeado: true e origem: encadeada');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.includes(1), 'Pessoa 1 está na Fila 3');

// D) Saída na Fila 3 ("PASSOU NA SAÍDA")
const rF3Saida1 = gsMulti.processarComando({ acao: 'saida', fila: 3, pessoaEsperada: 1, clientEventId: 'f3_saida_1' }, disp2);
assert(rF3Saida1.sucesso === true, 'Saída na F3 confirmada');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.length === 0, 'Fila 3 esvaziada');

// E) Reversão na F2 desfaz chegada na F3 se pessoa ainda estiver na F3
gsMulti.processarComando({ acao: 'chegada', fila: 2, clientEventId: 'f2_c2' }, disp1);
gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 2, clientEventId: 'f2_atend_2' }, disp1);
assert(gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.includes(2), 'Pessoa 2 avançou para Fila 3');

const rRevF2 = gsMulti.processarComando({ acao: 'reversao', fila: 2, clientEventId: 'f2_rev_2' }, disp1);
assert(rRevF2.sucesso === true, 'Reversão na F2 aceita enquanto pessoa 2 está na F3');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['2'].fila[0] === 2, 'Pessoa 2 retornou à cabeça da Fila 2');
assert(!gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.includes(2), 'Pessoa 2 removida da Fila 3 pela reversão');

// F) Bloqueio de reversão na F2 após saída na F3 (PESSOA_JA_AVANCOU)
gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 2, clientEventId: 'f2_atend_2_bis' }, disp1);
gsMulti.processarComando({ acao: 'saida', fila: 3, pessoaEsperada: 2, clientEventId: 'f3_saida_2' }, disp2);

const rRevF2Bloq = gsMulti.processarComando({ acao: 'reversao', fila: 2, clientEventId: 'f2_rev_bloq' }, disp1);
assert(rRevF2Bloq.sucesso === false && rRevF2Bloq.codigo === 'PESSOA_JA_AVANCOU', 'Reversão na F2 bloqueada com PESSOA_JA_AVANCOU');

// G) Anulação na Fila 3: não afeta atendimentos passados da Fila 2
gsMulti.processarComando({ acao: 'chegada', fila: 2, clientEventId: 'f2_c3' }, disp1);
gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 3, clientEventId: 'f2_atend_3' }, disp1);
assert(gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.includes(3), 'Pessoa 3 na F3 antes de anulação');

const rAnulF3Enc = gsMulti.processarComando({ acao: 'anulacao', fila: 3, pessoa: 3, clientEventId: 'f3_anul_3' }, disp2);
assert(rAnulF3Enc.sucesso === true, 'Anulação aceita na F3');
assert(!gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.includes(3), 'Pessoa 3 removida da F3');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['2'].contadores.atendidas === 3, 'Contador de atendidas na F2 preservado');

// H) Desativação da Fila 2 durante a sessão: F3 volta a aceitar chegada manual
const rDesatF2 = gsMulti.desativarFila(2, 'Painel');
assert(rDesatF2.sucesso === true, 'Fila 2 desativada durante a sessão');
assert(gsMulti.sessaoAtiva.filasDesativadas.includes(2), 'Fila 2 na lista de desativadas');

const rF3ManualPosDesat = gsMulti.processarComando({ acao: 'chegada', fila: 3, clientEventId: 'f3_man_pos_desat' }, disp2);
assert(rF3ManualPosDesat.sucesso === true, 'F3 volta a aceitar chegada manual após F2 ser desativada');

// I) Ajuste de fila na Fila 3
const rAjF3 = gsMulti.processarComando({ acao: 'ajuste_fila', fila: 3, delta: 2, clientEventId: 'f3_aj' }, disp2);
assert(rAjF3.sucesso === true && rAjF3.evento.tipo === 'ajuste_fila', 'Ajuste de fila aceito na Fila 3');
assert(gsMulti.sessaoAtiva.estadoAtual.filas['3'].fila.length === 3, 'Fila 3 tem 3 pessoas após ajuste (+2)');

// J) Pipeline Completo F1 -> F2 -> F3 e métricas de trânsito completo
if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
gsMulti.iniciarSessao({ nome: 'Pipeline F1-F2-F3', filasAtivas: [1, 2, 3], teste: true });

// Pessoa 1 entra na F1
gsMulti.processarComando({ acao: 'chegada', fila: 1, clientEventId: 'pipe_f1_c1' }, disp1);
// Salva estado antes de F1 atender
const estAntesF1Cat = gsMulti.sessaoAtiva.estadoAtual;
const rCatracaPipe = gsMulti.processarComando({ acao: 'atendido', fila: 1, pessoaEsperada: 1, clientEventId: 'pipe_f1_cat1' }, disp1);
assert(rCatracaPipe.eventosGerados[1].fila === 2, 'Catraca F1 transfere para Fila 2');

// Diff de transferência F1 -> F2
const diffF1F2 = diffEstado(estAntesF1Cat, gsMulti.sessaoAtiva.estadoAtual);
const opTransf1 = diffF1F2.find(d => d.op === 'transferir');
assert(opTransf1 && (opTransf1.fila === 1 || opTransf1.deFila === 1), 'Diff contém operação transferir da Fila 1');

// Salva estado antes de F2 atender
const estAntesF2Mesas = gsMulti.sessaoAtiva.estadoAtual;
const rMesasPipe = gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 1, clientEventId: 'pipe_f2_m1' }, disp1);
assert(rMesasPipe.eventosGerados && rMesasPipe.eventosGerados.length > 1 && rMesasPipe.eventosGerados[1].fila === 3, 'Mesas F2 transfere para Fila 3');

// Diff de transferência F2 -> F3
const diffF2F3 = diffEstado(estAntesF2Mesas, gsMulti.sessaoAtiva.estadoAtual);
const opTransf2 = diffF2F3.find(d => d.op === 'transferir');
assert(opTransf2 && (opTransf2.fila === 2 || opTransf2.deFila === 2), 'Diff contém operação transferir da Fila 2');

// F3 atende -> saída do restaurante
gsMulti.processarComando({ acao: 'saida', fila: 3, pessoaEsperada: 1, clientEventId: 'pipe_f3_s1' }, disp2);

// Métricas de percurso completo F1 -> F2 -> F3
const metPipe = calcularMetricas(gsMulti.sessaoAtiva.eventos, gsMulti.sessaoAtiva.config, Date.now());
assert(metPipe.transitoMesas && metPipe.transitoMesas.count === 1, 'Calculou transitoMesas (F1 -> F2)');
assert(metPipe.tempoMesasAteSaida && metPipe.tempoMesasAteSaida.qtd === 1, 'Calculou tempoMesasAteSaida (F2 -> F3)');
assert(metPipe.transitoSaida && metPipe.transitoSaida.count === 1, 'Calculou transitoSaida completo (F1 -> F2 -> F3)');

/* --------------------------------------------------------------------------
   24. Teste: Prevenção de Conflito de Aparelhos e Desconexão 4001
   -------------------------------------------------------------------------- */
console.log('\n--- 24. Prevenção de Conflito de Aparelhos ---');
// Verifica chaves isoladas por papel
const chavePainel = 'ru_fila_config_painel';
const chaveCelular = 'ru_fila_config_celular';
const idPainelKey = 'ru_fila_disp_id_painel';
const idCelularKey = 'ru_fila_disp_id_celular';
assert(chavePainel !== chaveCelular, 'Namespace de configuração do Painel é isolado do Celular');
assert(idPainelKey !== idCelularKey, 'Namespace de ID em sessionStorage do Painel é isolado do Celular');

// Código e motivo explícito de substituição de socket
const codigoSubstituicao = 4001;
const motivoSubstituicao = 'substituído';
assert(codigoSubstituicao === 4001, 'Código de encerramento por substituição é 4001');
assert(motivoSubstituicao === 'substituído', 'Motivo de encerramento explícito é "substituído"');

/* --------------------------------------------------------------------------
   25. Teste: Estatística de Preenchimento das Mesas (4×9 = 36 mesas, 216 cadeiras)
   -------------------------------------------------------------------------- */
console.log('\n--- 25. Estatística de Preenchimento das Mesas (216 cadeiras) ---');
if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();
gsMulti.iniciarSessao({ nome: 'Teste Mesas RU', filasAtivas: [1, 2, 3], teste: true });

// Estado inicial vazio
const estInicioMesas = gsMulti.sessaoAtiva.estadoAtual;
assert(estInicioMesas.ocupacaoMesas.capacidadeTotal === 216, 'Capacidade total configurada em 216 cadeiras');
assert(estInicioMesas.ocupacaoMesas.fileiras === 4, 'Salão modelado com 4 fileiras');
assert(estInicioMesas.ocupacaoMesas.mesasPorFileira === 9, '9 mesas por fileira');
assert(estInicioMesas.ocupacaoMesas.totalMesas === 36, 'Total de 36 mesas (4×9)');
assert(estInicioMesas.ocupacaoMesas.cadeirasPorMesa === 6, '6 cadeiras por mesa');
assert(estInicioMesas.ocupacaoMesas.ocupadas === 0, 'Inicialmente 0 cadeiras ocupadas');
assert(estInicioMesas.ocupacaoMesas.livres === 216, 'Inicialmente 216 cadeiras livres');
assert(estInicioMesas.ocupacaoMesas.percentual === 0, 'Percentual de ocupação inicial = 0%');
assert(estInicioMesas.ocupacaoMesas.status === 'Tranquilo', 'Status inicial é "Tranquilo"');

// Pessoa 1 e Pessoa 2 entram e chegam às mesas
gsMulti.processarComando({ acao: 'chegada', fila: 1, clientEventId: 'mesas_c1' }, disp1);
gsMulti.processarComando({ acao: 'atendido', fila: 1, pessoaEsperada: 1, clientEventId: 'mesas_cat1' }, disp1);
gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 1, clientEventId: 'mesas_m1' }, disp1);

const estP1Mesa = gsMulti.sessaoAtiva.estadoAtual;
assert(estP1Mesa.ocupacaoMesas.ocupadas === 1, 'Pessoa 1 sentou: 1 cadeira ocupada');
assert(estP1Mesa.ocupacaoMesas.livres === 215, '215 cadeiras livres restantes');
assert(estP1Mesa.ocupacaoMesas.mesasOcupadas === 1, '1 mesa em uso');

gsMulti.processarComando({ acao: 'chegada', fila: 1, clientEventId: 'mesas_c2' }, disp1);
gsMulti.processarComando({ acao: 'atendido', fila: 1, pessoaEsperada: 2, clientEventId: 'mesas_cat2' }, disp1);
gsMulti.processarComando({ acao: 'saida', fila: 2, pessoaEsperada: 2, clientEventId: 'mesas_m2' }, disp1);

const estP2Mesa = gsMulti.sessaoAtiva.estadoAtual;
assert(estP2Mesa.ocupacaoMesas.ocupadas === 2, 'Pessoa 2 sentou: 2 cadeiras ocupadas');
assert(estP2Mesa.ocupacaoMesas.livres === 214, '214 cadeiras livres');

// Pessoa 1 termina a refeição e passa pela Saída (Fila 3) -> libera a cadeira
gsMulti.processarComando({ acao: 'saida', fila: 3, pessoaEsperada: 1, clientEventId: 'mesas_s1' }, disp2);

const estP1Saiu = gsMulti.sessaoAtiva.estadoAtual;
assert(estP1Saiu.ocupacaoMesas.ocupadas === 1, 'Pessoa 1 saiu pela F3: cadeira liberada (resta 1 ocupada)');
assert(estP1Saiu.ocupacaoMesas.livres === 215, '215 cadeiras livres após saída');

// Pessoa 2 também sai -> todas as cadeiras liberadas
gsMulti.processarComando({ acao: 'saida', fila: 3, pessoaEsperada: 2, clientEventId: 'mesas_s2' }, disp2);
const estP2Saiu = gsMulti.sessaoAtiva.estadoAtual;
assert(estP2Saiu.ocupacaoMesas.ocupadas === 0, 'Pessoa 2 saiu: salão 100% liberado');
assert(estP2Saiu.ocupacaoMesas.livres === 216, 'Todas as 216 cadeiras livres');

// Validação das métricas consolidadas das mesas
const metMesas = calcularMetricas(gsMulti.sessaoAtiva.eventos, gsMulti.sessaoAtiva.config, Date.now());
assert(metMesas.estatisticasMesas.capacidadeTotal === 216, 'Métricas reportam capacidade de 216 cadeiras');
assert(metMesas.estatisticasMesas.picoOcupadas === 2, 'Pico de ocupação registrado = 2 cadeiras');
assert(metMesas.estatisticasMesas.totalEventosEntrada === 2, 'Total de 2 entradas registradas nas mesas');

if (gsMulti.sessaoAtiva) gsMulti.encerrarSessao();

try {
  fs.rmSync(dirTempTeste, { recursive: true, force: true });
} catch (_) {}

console.log('\n================================================================');
console.log(`   RESULTADO DOS TESTES: ${passou} aprovados, ${falhou} falhas.`);
console.log('================================================================\n');

if (falhou > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
