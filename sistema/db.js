// db.js
// Camada de acesso ao SQLite usando better-sqlite3 (API sincrona, sem ORM).
// Todas as funcoes sao sincronas — better-sqlite3 nao usa async/await.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Garante que a pasta db/ exista antes de abrir o banco.
const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Abre (ou cria) o arquivo do banco.
const DB_PATH = path.join(DB_DIR, 'bot.db');
const db = new Database(DB_PATH);

// Quantas mensagens recentes do cliente enviamos ao modelo (e mantemos no banco)
// como "janela" de contexto imediato. Configuravel por env; padrao 30 (~15 trocas).
// O contexto de longo prazo alem dessa janela e mantido no resumo .md do cliente.
const HISTORICO_LIMIT = Number(process.env.HISTORICO_LIMIT) || 30;

// Recomendado para better-sqlite3: melhora concorrencia de leitura/escrita.
db.pragma('journal_mode = WAL');
// Garante que as chaves estrangeiras sejam respeitadas.
db.pragma('foreign_keys = ON');

/**
 * Cria as tabelas (se ainda nao existirem) e faz o seed da instituicao padrao.
 * Deve ser chamada uma vez no boot da aplicacao.
 */
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instituicoes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT UNIQUE NOT NULL,
      nome          TEXT NOT NULL,
      arquivo_md    TEXT NOT NULL,
      numero_humano TEXT NOT NULL,
      ativo         BOOLEAN DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_telefone TEXT UNIQUE NOT NULL,
      nome_display    TEXT,
      arquivo_md      TEXT,
      instituicao_id  INTEGER REFERENCES instituicoes(id),
      criado_em       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS historico (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER REFERENCES clientes(id),
      role       TEXT NOT NULL,
      conteudo   TEXT NOT NULL,
      criado_em  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed idempotente da instituicao padrao (id = 1).
  // Assim o fluxo ja funciona no primeiro contato, sem cadastro manual.
  // INSERT OR IGNORE nao sobrescreve dados ja existentes (UNIQUE em slug).
  db.prepare(`
    INSERT OR IGNORE INTO instituicoes (id, slug, nome, arquivo_md, numero_humano, ativo)
    VALUES (1, 'ferreira_ramos', 'Ferreira Ramos Advocacia',
            'instituicoes/exemplo_instituicao.md', '5514998689481', 1)
  `).run();
}

/**
 * Busca um cliente pelo numero. Se nao existir, cria um novo registro
 * (sem arquivo_md) vinculado a instituicao informada.
 * Retorna sempre o registro completo do cliente.
 */
function getOrCreateCliente(numero, nomeDisplay, instituicaoId) {
  const selectStmt = db.prepare('SELECT * FROM clientes WHERE numero_telefone = ?');
  let cliente = selectStmt.get(numero);

  if (!cliente) {
    // Cria o cliente novo sem arquivo_md (sera preenchido manualmente depois).
    db.prepare(`
      INSERT INTO clientes (numero_telefone, nome_display, instituicao_id)
      VALUES (?, ?, ?)
    `).run(numero, nomeDisplay, instituicaoId);
    cliente = selectStmt.get(numero);
  }

  return cliente;
}

/**
 * Vincula um arquivo .md ao cliente (ex: "clientes/joao_5514998689481.md").
 */
function setClienteArquivoMd(clienteId, arquivoMd) {
  db.prepare('UPDATE clientes SET arquivo_md = ? WHERE id = ?').run(arquivoMd, clienteId);
}

/**
 * Retorna a instituicao pelo id (ou undefined se nao existir).
 */
function getInstituicao(id) {
  return db.prepare('SELECT * FROM instituicoes WHERE id = ?').get(id);
}

/**
 * Lista os clientes (id, numero, nome e arquivo_md), em ordem alfabetica.
 * Usado pelo painel para editar o contexto de cada cliente.
 */
function listClientes() {
  return db.prepare(`
    SELECT id, numero_telefone, nome_display, arquivo_md
    FROM clientes
    ORDER BY nome_display COLLATE NOCASE, numero_telefone
  `).all();
}

/**
 * Retorna um cliente pelo id (ou undefined se nao existir).
 */
function getCliente(id) {
  return db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
}

/**
 * Retorna as ultimas HISTORICO_LIMIT mensagens do cliente em ordem cronologica
 * (mais antiga primeiro), no formato [{ role, conteudo }].
 */
function getHistorico(clienteId) {
  // Pega as mais recentes (DESC) e depois inverte para ordem cronologica.
  const linhas = db.prepare(`
    SELECT role, conteudo
    FROM historico
    WHERE cliente_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(clienteId, HISTORICO_LIMIT);

  return linhas.reverse();
}

/**
 * Salva uma mensagem no historico e em seguida poda para manter so as 10 ultimas.
 * role deve ser 'user' ou 'assistant'.
 */
function saveMessage(clienteId, role, conteudo) {
  db.prepare(`
    INSERT INTO historico (cliente_id, role, conteudo)
    VALUES (?, ?, ?)
  `).run(clienteId, role, conteudo);

  pruneHistorico(clienteId);
}

/**
 * Mantem apenas as HISTORICO_LIMIT mensagens mais recentes do cliente,
 * deletando as demais.
 */
function pruneHistorico(clienteId) {
  db.prepare(`
    DELETE FROM historico
    WHERE cliente_id = ?
      AND id NOT IN (
        SELECT id FROM historico
        WHERE cliente_id = ?
        ORDER BY id DESC
        LIMIT ?
      )
  `).run(clienteId, clienteId, HISTORICO_LIMIT);
}

module.exports = {
  initDb,
  getOrCreateCliente,
  setClienteArquivoMd,
  getInstituicao,
  listClientes,
  getCliente,
  getHistorico,
  saveMessage,
  pruneHistorico,
};
