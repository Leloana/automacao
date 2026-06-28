// painel.js
// Painel web local (sem framework) para:
//   1) ver o status da conexao do WhatsApp e escanear o QR code;
//   2) gerenciar a whitelist de numeros.
// Sobe junto com o bot e escuta apenas em 127.0.0.1 (nao exposto na rede).

const http = require('http');
const qrcode = require('qrcode');
const { lerConfig, salvarConfig } = require('./whitelist');
const { getPersonalidade, salvarPersonalidade, PERSONALIDADE_PADRAO } = require('./prompt');
const { getAdvogados, salvarAdvogados } = require('./advogados');
const { readMarkdown, escreverMarkdown } = require('./context');
const db = require('./db');

// Estado da conexao do WhatsApp, atualizado pelo index.js via setStatus/setQR.
// status: 'carregando' | 'qr' | 'conectado' | 'desconectado' | 'falha'
let estado = { status: 'carregando', qrDataUrl: null };

// Handler de "trocar WhatsApp", registrado pelo index.js (que detem o client).
let trocarHandler = null;
function setTrocarHandler(fn) { trocarHandler = fn; }

function setStatus(status) {
  estado.status = status;
  // Ao conectar/desconectar, o QR antigo nao serve mais.
  if (status === 'conectado' || status === 'desconectado' || status === 'falha') {
    estado.qrDataUrl = null;
  }
}

// Recebe a string do QR (vinda do whatsapp-web.js) e gera uma imagem (data URL).
async function setQR(qrString) {
  try {
    estado.qrDataUrl = await qrcode.toDataURL(qrString, { margin: 1, width: 280 });
    estado.status = 'qr';
  } catch (e) {
    console.error('Erro ao gerar imagem do QR:', e.message);
  }
}

// Pagina HTML (interface). Vanilla JS + fetch, sem dependencias no navegador.
const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Painel do Bot — Ferreira Ramos</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Segoe UI, Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
  .card { max-width: 560px; margin: 0 auto 20px; background: #1e293b; border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,.3); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 0 0 14px; }
  p.sub { color: #94a3b8; margin: 0 0 20px; font-size: 14px; }
  .banner { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-radius: 8px; font-weight: 600; font-size: 15px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
  .b-conectado { background: #052e16; color: #4ade80; } .b-conectado .dot { background: #22c55e; }
  .b-qr { background: #422006; color: #fbbf24; } .b-qr .dot { background: #f59e0b; }
  .b-carregando { background: #1e293b; color: #94a3b8; border: 1px solid #334155; } .b-carregando .dot { background: #64748b; }
  .b-desconectado, .b-falha { background: #450a0a; color: #f87171; } .b-desconectado .dot, .b-falha .dot { background: #ef4444; }
  .qrbox { text-align: center; margin-top: 16px; }
  .qrbox img { background: #fff; padding: 10px; border-radius: 10px; width: 280px; max-width: 100%; }
  .qrbox p { color: #94a3b8; font-size: 13px; margin-top: 10px; }
  .toggle { display: flex; align-items: center; gap: 10px; background: #0f172a; padding: 12px 14px; border-radius: 8px; margin-bottom: 16px; }
  .toggle input { width: 18px; height: 18px; }
  .toggle small { color: #94a3b8; display: block; }
  .add { display: flex; gap: 8px; margin-bottom: 16px; }
  input[type=text] { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 15px; }
  textarea { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 14px; line-height: 1.5; font-family: inherit; resize: vertical; }
  select { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 15px; }
  button { cursor: pointer; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; }
  .btn-add { background: #22c55e; color: #06210f; }
  .btn-save { background: #3b82f6; color: #fff; width: 100%; padding: 12px; margin-top: 8px; font-size: 15px; }
  .btn-reset { background: transparent; color: #94a3b8; border: 1px solid #334155; width: 100%; padding: 10px; margin-top: 8px; font-size: 14px; }
  .btn-trocar { background: #f59e0b; color: #422006; width: 100%; padding: 12px; margin-top: 16px; font-size: 15px; }
  .btn-trocar:disabled { opacity: .6; cursor: default; }
  .btn-rem { background: #ef4444; color: #fff; padding: 6px 12px; font-size: 13px; }
  .adv { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 14px; margin-bottom: 12px; }
  .adv .row { display: flex; gap: 8px; margin-bottom: 8px; }
  .adv label { font-size: 13px; color: #94a3b8; display: block; margin-bottom: 4px; }
  .adv .field { flex: 1; }
  .adv .checks { display: flex; gap: 16px; align-items: center; margin-top: 4px; }
  .adv .checks label { display: flex; align-items: center; gap: 6px; margin: 0; color: #e2e8f0; cursor: pointer; }
  .adv .adv-foot { display: flex; justify-content: flex-end; margin-top: 4px; }
  ul { list-style: none; padding: 0; margin: 0 0 8px; }
  li { display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 10px 14px; border-radius: 8px; margin-bottom: 8px; font-size: 15px; letter-spacing: .5px; }
  .vazio { color: #64748b; font-style: italic; padding: 12px 0; }
  .status { margin-top: 12px; font-size: 14px; min-height: 20px; }
  .ok { color: #22c55e; } .erro { color: #ef4444; }
  code { background:#0f172a; padding:2px 6px; border-radius:4px; }
</style>
</head>
<body>
  <!-- Conexao do WhatsApp -->
  <div class="card">
    <h1>Conexão do WhatsApp</h1>
    <p class="sub">Status da conexão do bot com o WhatsApp do escritório.</p>
    <div id="banner" class="banner b-carregando"><span class="dot"></span><span id="banner-txt">Carregando...</span></div>
    <div id="qrbox" class="qrbox" style="display:none">
      <img id="qrimg" alt="QR code" />
      <p>No WhatsApp: <b>Aparelhos conectados &gt; Conectar um aparelho</b> e aponte para este código.</p>
    </div>
    <button class="btn-trocar" onclick="trocarWhatsapp()">Trocar de WhatsApp</button>
    <p class="sub" style="margin:8px 0 0">Desconecta a conta atual, apaga a sessão e gera um novo QR code para outro número escanear.</p>
    <div class="status" id="status-trocar"></div>
  </div>

  <!-- Whitelist -->
  <div class="card">
    <h2>Whitelist de números</h2>
    <p class="sub">Quando habilitada, o bot responde <b>apenas</b> os números desta lista.</p>

    <label class="toggle">
      <input type="checkbox" id="habilitada" />
      <span>Whitelist habilitada<small>Desmarque para o bot responder qualquer número.</small></span>
    </label>

    <div class="add">
      <input type="text" id="novo" placeholder="Ex: 5514998689481" />
      <button class="btn-add" onclick="adicionar()">Adicionar</button>
    </div>

    <ul id="lista"></ul>
    <div id="vazio" class="vazio" style="display:none">Nenhum número na lista.</div>

    <button class="btn-save" onclick="salvar()">Salvar alterações</button>
    <div class="status" id="status"></div>
    <p class="sub" style="margin-top:16px">Formato: país + DDD + número, só dígitos. Ex: <code>5514998689481</code></p>
  </div>

  <!-- Personalidade do bot -->
  <div class="card">
    <h2>Personalidade do bot</h2>
    <p class="sub">Tom, estilo e papel do assistente. Use <code>{nomeInstituicao}</code> para inserir o nome do escritório. As alterações valem na hora, sem reiniciar.</p>
    <textarea id="personalidade" rows="14" placeholder="Descreva como o bot deve se comportar..."></textarea>
    <button class="btn-save" onclick="salvarPersonalidade()">Salvar personalidade</button>
    <button class="btn-reset" onclick="restaurarPersonalidade()">Restaurar padrão</button>
    <div class="status" id="status-pers"></div>
  </div>

  <!-- Advogados de redirecionamento -->
  <div class="card">
    <h2>Advogados de redirecionamento</h2>
    <p class="sub">Quando o bot escala um atendimento, escolhe o advogado pela <b>área</b>. Sem área correspondente, usa o marcado como <b>padrão</b>. As alterações valem na hora.</p>

    <div id="advs"></div>
    <div id="advs-vazio" class="vazio" style="display:none">Nenhum advogado cadastrado.</div>

    <button class="btn-add" onclick="adicionarAdv()" style="width:100%;padding:12px;margin-top:4px">+ Adicionar advogado</button>
    <button class="btn-save" onclick="salvarAdvs()">Salvar advogados</button>
    <div class="status" id="status-adv"></div>
    <p class="sub" style="margin-top:16px">Número no formato país + DDD + número, só dígitos. Áreas separadas por vírgula (ex: <code>trabalhista, familia</code>).</p>
  </div>

  <!-- Contexto dos clientes -->
  <div class="card">
    <h2>Contexto dos clientes</h2>
    <p class="sub">O que o bot sabe sobre cada cliente. Edite para corrigir algo que a IA tenha entendido errado. O bot usa este texto como contexto nas próximas mensagens.</p>

    <div class="add">
      <select id="cliente-sel" onchange="carregarCliente()"></select>
      <button class="btn-add" onclick="carregarClientes()" title="Atualizar lista">↻</button>
    </div>

    <textarea id="cliente-md" rows="14" placeholder="Selecione um cliente para ver e editar o contexto..."></textarea>
    <button class="btn-save" onclick="salvarCliente()">Salvar contexto</button>
    <div class="status" id="status-cli"></div>
    <p class="sub" style="margin-top:16px">Dica: o que estiver abaixo de <code>## Anotações do escritório</code> nunca é alterado pelo bot — bom lugar para suas notas.</p>
  </div>

<script>
  let numeros = [];
  function soDigitos(s){ return String(s||'').replace(/\\D/g,''); }

  // ---- Status da conexao (atualiza sozinho) ----
  const TEXTO = {
    carregando:   { cls: 'b-carregando',   txt: 'Iniciando o bot...' },
    qr:           { cls: 'b-qr',           txt: 'Aguardando leitura — escaneie o QR code abaixo' },
    conectado:    { cls: 'b-conectado',    txt: 'Conectado! O bot está atendendo.' },
    desconectado: { cls: 'b-desconectado', txt: 'Desconectado. Reinicie o bot se necessário.' },
    falha:        { cls: 'b-falha',        txt: 'Falha na autenticação. Reinicie o bot.' },
  };
  async function atualizarStatus(){
    try {
      const r = await fetch('/api/status');
      const s = await r.json();
      const info = TEXTO[s.status] || TEXTO.carregando;
      const banner = document.getElementById('banner');
      banner.className = 'banner ' + info.cls;
      document.getElementById('banner-txt').textContent = info.txt;
      const qrbox = document.getElementById('qrbox');
      if (s.status === 'qr' && s.qr) {
        document.getElementById('qrimg').src = s.qr;
        qrbox.style.display = 'block';
      } else {
        qrbox.style.display = 'none';
      }
    } catch (e) { /* ignora; tenta de novo no proximo ciclo */ }
  }

  // ---- Whitelist ----
  function render(){
    const ul = document.getElementById('lista');
    ul.innerHTML = '';
    document.getElementById('vazio').style.display = numeros.length ? 'none' : 'block';
    numeros.forEach((n, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span>' + n + '</span>';
      const b = document.createElement('button');
      b.className = 'btn-rem'; b.textContent = 'Remover';
      b.onclick = () => { numeros.splice(i,1); render(); };
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  function adicionar(){
    const inp = document.getElementById('novo');
    const n = soDigitos(inp.value);
    if (n.length < 12 || n.length > 13) { setStatus('Número inválido. Use país+DDD+número (12 ou 13 dígitos).', false); return; }
    if (numeros.includes(n)) { setStatus('Esse número já está na lista.', false); return; }
    numeros.push(n); inp.value = ''; render(); setStatus('', true);
  }
  function setStatus(msg, ok){
    const s = document.getElementById('status');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarWhitelist(){
    const r = await fetch('/api/whitelist');
    const cfg = await r.json();
    numeros = cfg.numeros || [];
    document.getElementById('habilitada').checked = cfg.habilitada !== false;
    render();
  }
  async function salvar(){
    const habilitada = document.getElementById('habilitada').checked;
    try {
      const r = await fetch('/api/whitelist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ habilitada, numeros }) });
      const cfg = await r.json();
      numeros = cfg.numeros || [];
      render();
      setStatus('Salvo! As alterações já valem (sem reiniciar o bot).', true);
    } catch (e) { setStatus('Erro ao salvar: ' + e.message, false); }
  }

  document.getElementById('novo').addEventListener('keydown', (e) => { if (e.key === 'Enter') adicionar(); });

  // ---- Trocar de WhatsApp ----
  async function trocarWhatsapp(){
    if (!confirm('Tem certeza? Isso vai DESCONECTAR o WhatsApp atual e apagar a sessão. Será preciso escanear um novo QR code para conectar outra conta.')) return;
    const btn = document.querySelector('.btn-trocar');
    const s = document.getElementById('status-trocar');
    btn.disabled = true; btn.textContent = 'Trocando...';
    s.textContent = 'Encerrando a sessão atual...'; s.className = 'status ok';
    try {
      const r = await fetch('/api/trocar', { method: 'POST' });
      const d = await r.json();
      if (d.erro) { s.textContent = 'Erro: ' + d.erro; s.className = 'status erro'; }
      else { s.textContent = 'Sessão apagada. Aguarde o novo QR code aparecer acima.'; s.className = 'status ok'; }
    } catch (e) {
      s.textContent = 'Erro ao trocar: ' + e.message; s.className = 'status erro';
    } finally {
      btn.disabled = false; btn.textContent = 'Trocar de WhatsApp';
    }
  }

  // ---- Personalidade do bot ----
  let personalidadePadrao = '';
  function setStatusPers(msg, ok){
    const s = document.getElementById('status-pers');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarPersonalidade(){
    try {
      const r = await fetch('/api/personalidade');
      const d = await r.json();
      personalidadePadrao = d.padrao || '';
      document.getElementById('personalidade').value = d.texto || '';
    } catch (e) { setStatusPers('Erro ao carregar: ' + e.message, false); }
  }
  async function salvarPersonalidade(){
    const texto = document.getElementById('personalidade').value;
    try {
      const r = await fetch('/api/personalidade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) });
      const d = await r.json();
      if (d.erro) return setStatusPers('Erro: ' + d.erro, false);
      document.getElementById('personalidade').value = d.texto || '';
      setStatusPers('Personalidade salva! Já vale para as próximas mensagens.', true);
    } catch (e) { setStatusPers('Erro ao salvar: ' + e.message, false); }
  }
  function restaurarPersonalidade(){
    document.getElementById('personalidade').value = personalidadePadrao;
    setStatusPers('Padrão carregado no editor. Clique em "Salvar personalidade" para aplicar.', true);
  }

  // ---- Advogados de redirecionamento ----
  let advogados = [];
  function setStatusAdv(msg, ok){
    const s = document.getElementById('status-adv');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  function renderAdvs(){
    const box = document.getElementById('advs');
    box.innerHTML = '';
    document.getElementById('advs-vazio').style.display = advogados.length ? 'none' : 'block';
    advogados.forEach((a, i) => {
      const div = document.createElement('div');
      div.className = 'adv';
      div.innerHTML =
        '<div class="row">' +
          '<div class="field"><label>Nome</label><input type="text" data-i="' + i + '" data-k="nome" value="' + esc(a.nome) + '" placeholder="Ex: Dra. Maria" /></div>' +
          '<div class="field"><label>Número (WhatsApp)</label><input type="text" data-i="' + i + '" data-k="numero" value="' + esc(a.numero) + '" placeholder="5514998689481" /></div>' +
        '</div>' +
        '<div class="field"><label>Áreas (separadas por vírgula)</label><input type="text" data-i="' + i + '" data-k="areas" value="' + esc((a.areas||[]).join(', ')) + '" placeholder="trabalhista, familia" /></div>' +
        '<div class="checks">' +
          '<label><input type="checkbox" data-i="' + i + '" data-k="padrao"' + (a.padrao ? ' checked' : '') + ' /> Padrão</label>' +
          '<label><input type="checkbox" data-i="' + i + '" data-k="ativo"' + (a.ativo !== false ? ' checked' : '') + ' /> Ativo</label>' +
          '<span style="flex:1"></span>' +
          '<button class="btn-rem" data-rem="' + i + '">Remover</button>' +
        '</div>';
      box.appendChild(div);
    });
    // Liga os eventos dos campos a model "advogados".
    box.querySelectorAll('input[data-k]').forEach((el) => {
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        const i = Number(el.getAttribute('data-i'));
        const k = el.getAttribute('data-k');
        if (k === 'padrao') {
          // "Padrão" e exclusivo: marcar um desmarca os outros.
          advogados.forEach((x, j) => { x.padrao = (j === i) ? el.checked : false; });
          renderAdvs();
        } else if (k === 'ativo') {
          advogados[i].ativo = el.checked;
        } else if (k === 'areas') {
          advogados[i].areas = el.value.split(',').map((s) => s.trim()).filter(Boolean);
        } else {
          advogados[i][k] = el.value;
        }
      });
    });
    box.querySelectorAll('button[data-rem]').forEach((b) => {
      b.addEventListener('click', () => { advogados.splice(Number(b.getAttribute('data-rem')), 1); renderAdvs(); });
    });
  }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function adicionarAdv(){
    advogados.push({ nome: '', numero: '', areas: [], padrao: false, ativo: true });
    renderAdvs();
  }
  async function carregarAdvs(){
    try {
      const r = await fetch('/api/advogados');
      const d = await r.json();
      advogados = (d.advogados || []).map((a) => ({ nome: a.nome||'', numero: a.numero||'', areas: a.areas||[], padrao: !!a.padrao, ativo: a.ativo !== false }));
      renderAdvs();
    } catch (e) { setStatusAdv('Erro ao carregar: ' + e.message, false); }
  }
  async function salvarAdvs(){
    try {
      const r = await fetch('/api/advogados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ advogados }) });
      const d = await r.json();
      if (d.erro) return setStatusAdv('Erro: ' + d.erro, false);
      advogados = (d.advogados || []).map((a) => ({ nome: a.nome||'', numero: a.numero||'', areas: a.areas||[], padrao: !!a.padrao, ativo: a.ativo !== false }));
      renderAdvs();
      setStatusAdv('Advogados salvos! Já valem para os próximos atendimentos.', true);
    } catch (e) { setStatusAdv('Erro ao salvar: ' + e.message, false); }
  }

  // ---- Contexto dos clientes ----
  let clienteAtual = null;
  function setStatusCli(msg, ok){
    const s = document.getElementById('status-cli');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarClientes(){
    try {
      const r = await fetch('/api/clientes');
      const d = await r.json();
      const sel = document.getElementById('cliente-sel');
      const selecionado = sel.value;
      sel.innerHTML = '<option value="">— selecione um cliente —</option>';
      (d.clientes || []).forEach((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = (c.nome || c.numero) + ' (' + c.numero + ')';
        sel.appendChild(o);
      });
      if (selecionado) sel.value = selecionado;
    } catch (e) { setStatusCli('Erro ao carregar a lista: ' + e.message, false); }
  }
  async function carregarCliente(){
    const id = document.getElementById('cliente-sel').value;
    const ta = document.getElementById('cliente-md');
    if (!id) { ta.value = ''; clienteAtual = null; setStatusCli('', true); return; }
    try {
      const r = await fetch('/api/cliente?id=' + encodeURIComponent(id));
      const d = await r.json();
      if (d.erro) return setStatusCli('Erro: ' + d.erro, false);
      clienteAtual = d.id;
      ta.value = d.conteudo || '';
      setStatusCli('', true);
    } catch (e) { setStatusCli('Erro ao carregar: ' + e.message, false); }
  }
  async function salvarCliente(){
    if (!clienteAtual) return setStatusCli('Selecione um cliente primeiro.', false);
    const conteudo = document.getElementById('cliente-md').value;
    try {
      const r = await fetch('/api/cliente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: clienteAtual, conteudo }) });
      const d = await r.json();
      if (d.erro) return setStatusCli('Erro: ' + d.erro, false);
      setStatusCli('Contexto salvo! Já vale para as próximas mensagens.', true);
    } catch (e) { setStatusCli('Erro ao salvar: ' + e.message, false); }
  }

  carregarWhitelist();
  carregarPersonalidade();
  carregarAdvs();
  carregarClientes();
  atualizarStatus();
  setInterval(atualizarStatus, 2500); // verifica a conexao a cada 2,5s
</script>
</body>
</html>`;

function enviarJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/**
 * Le o corpo (JSON) de uma requisicao POST, chama "manipular" com o objeto
 * recebido e responde com o retorno (status 200) ou com o erro (status 400).
 */
function lerCorpo(req, res, manipular) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    try {
      return enviarJson(res, 200, manipular(JSON.parse(body || '{}')));
    } catch (e) {
      return enviarJson(res, 400, { erro: e.message });
    }
  });
}

/**
 * Sobe o painel web na porta indicada (apenas localhost).
 */
function iniciarPainel(porta = 3000) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HTML);
    }

    // Status da conexao do WhatsApp (consultado em loop pela pagina).
    if (req.method === 'GET' && req.url === '/api/status') {
      return enviarJson(res, 200, { status: estado.status, qr: estado.qrDataUrl });
    }

    // Ler a whitelist.
    if (req.method === 'GET' && req.url === '/api/whitelist') {
      return enviarJson(res, 200, lerConfig());
    }

    // Salvar a whitelist.
    if (req.method === 'POST' && req.url === '/api/whitelist') {
      return lerCorpo(req, res, (corpo) => salvarConfig(corpo));
    }

    // Ler a personalidade do bot (texto atual + valor padrao de fabrica).
    if (req.method === 'GET' && req.url === '/api/personalidade') {
      return enviarJson(res, 200, { texto: getPersonalidade(), padrao: PERSONALIDADE_PADRAO });
    }

    // Salvar a personalidade do bot.
    if (req.method === 'POST' && req.url === '/api/personalidade') {
      return lerCorpo(req, res, (corpo) => salvarPersonalidade(corpo.texto));
    }

    // Ler os advogados de redirecionamento.
    if (req.method === 'GET' && req.url === '/api/advogados') {
      return enviarJson(res, 200, { advogados: getAdvogados() });
    }

    // Salvar os advogados de redirecionamento.
    if (req.method === 'POST' && req.url === '/api/advogados') {
      return lerCorpo(req, res, (corpo) => ({ advogados: salvarAdvogados(corpo.advogados || []) }));
    }

    // Lista de clientes (para o editor de contexto).
    if (req.method === 'GET' && req.url === '/api/clientes') {
      const clientes = db.listClientes().map((c) => ({
        id: c.id, numero: c.numero_telefone, nome: c.nome_display, arquivo_md: c.arquivo_md,
      }));
      return enviarJson(res, 200, { clientes });
    }

    // Ler o contexto (.md) de um cliente especifico.
    if (req.method === 'GET' && req.url.startsWith('/api/cliente?')) {
      const id = Number(new URL(req.url, 'http://localhost').searchParams.get('id'));
      const c = db.getCliente(id);
      if (!c) return enviarJson(res, 404, { erro: 'Cliente não encontrado.' });
      return enviarJson(res, 200, {
        id: c.id, nome: c.nome_display, numero: c.numero_telefone, arquivo_md: c.arquivo_md,
        conteudo: c.arquivo_md ? readMarkdown(c.arquivo_md) : '',
      });
    }

    // Salvar o contexto (.md) de um cliente. O caminho vem do banco (nao do
    // navegador), entao nao da para gravar fora da pasta de clientes.
    if (req.method === 'POST' && req.url === '/api/cliente') {
      return lerCorpo(req, res, (corpo) => {
        const c = db.getCliente(Number(corpo.id));
        if (!c) throw new Error('Cliente não encontrado.');
        if (!c.arquivo_md) throw new Error('Cliente sem arquivo de contexto.');
        escreverMarkdown(c.arquivo_md, corpo.conteudo || '');
        return { ok: true };
      });
    }

    // Trocar de WhatsApp: desconecta, apaga a sessao e gera um novo QR code.
    if (req.method === 'POST' && req.url === '/api/trocar') {
      if (!trocarHandler) {
        return enviarJson(res, 503, { erro: 'Troca de WhatsApp indisponível no momento.' });
      }
      // Dispara a troca em segundo plano e responde na hora; o painel acompanha
      // o resultado pelo status (que passa a "carregando" e depois a "qr").
      Promise.resolve()
        .then(() => trocarHandler())
        .catch((e) => console.error('Erro ao trocar de WhatsApp:', e.message));
      return enviarJson(res, 200, { ok: true });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nao encontrado');
  });

  server.on('error', (e) => console.error('Erro no painel web:', e.message));
  server.listen(porta, '127.0.0.1', () => {
    console.log(`Painel disponivel em http://localhost:${porta}`);
  });
  return server;
}

module.exports = { iniciarPainel, setStatus, setQR, setTrocarHandler };
