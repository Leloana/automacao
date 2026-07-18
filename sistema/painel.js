// painel.js
// Painel web local (sem framework) para:
//   1) ver o status da conexao do WhatsApp e escanear o QR code;
//   2) gerenciar a whitelist de numeros.
// Sobe junto com o bot e escuta apenas em 127.0.0.1 (nao exposto na rede).

const http = require('http');
const qrcode = require('qrcode');
const { lerConfig, salvarConfig, setLiberarTodos, bloquearNumero, desbloquearNumero, soDigitos, variantes } = require('./whitelist');
const { getPersonalidade, salvarPersonalidade, PERSONALIDADE_PADRAO } = require('./prompt');
const { getMensagens, salvarMensagens, MSG_CLIENTE_PADRAO, MSG_ADVOGADO_PADRAO } = require('./mensagens');
const { getTriagem, salvarTriagem, ANOTAR_PADRAO, DESCOBRIR_PADRAO, MAX_DESCOBRIR } = require('./triagem');
const { getAdvogados, salvarAdvogados } = require('./advogados');
const { readMarkdown, escreverMarkdown, criarFichaCliente } = require('./context');
const escritorio = require('./escritorio');
const apikey = require('./apikey');
const db = require('./db');
const avisos = require('./avisos');

// Instituicao usada ao cadastrar um cliente pelo painel (mesma logica do bot).
const INSTITUICAO_PADRAO_ID = Number(process.env.INSTITUICAO_PADRAO_ID) || 1;

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
  body { font-family: Segoe UI, Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
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
  input[type=text], input[type=password] { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 15px; }
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
  /* Icone de ajuda (ⓘ) com tooltip no hover, ao lado do titulo de cada card. */
  h1, h2 { display: flex; align-items: center; }
  .info { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; margin-left: 8px; border-radius: 50%; border: 1px solid #475569; color: #94a3b8; font-size: 12px; font-style: italic; font-weight: 700; font-family: Georgia, 'Times New Roman', serif; cursor: help; user-select: none; flex: none; }
  .info:hover, .info:focus { background: #334155; color: #e2e8f0; outline: none; }
  .info .tip { position: absolute; top: 26px; left: 0; z-index: 20; width: 280px; max-width: 78vw; background: #0b1220; color: #cbd5e1; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; font-size: 13px; font-weight: 400; font-style: normal; line-height: 1.5; letter-spacing: normal; text-align: left; box-shadow: 0 10px 28px rgba(0,0,0,.5); opacity: 0; visibility: hidden; transform: translateY(-4px); transition: opacity .12s ease, transform .12s ease; pointer-events: none; }
  .info:hover .tip, .info:focus .tip { opacity: 1; visibility: visible; transform: translateY(0); }
  /* Layout com navegacao lateral: uma secao (card) por vez. */
  .layout { display: flex; align-items: flex-start; min-height: 100vh; }
  .sidebar { position: sticky; top: 0; align-self: flex-start; width: 240px; flex: none; height: 100vh; overflow-y: auto; background: #111c31; border-right: 1px solid #1f2b45; padding: 18px 12px; }
  .brand { font-size: 15px; font-weight: 700; line-height: 1.3; padding: 6px 12px 16px; }
  .brand small { display: block; color: #94a3b8; font-weight: 400; font-size: 12px; margin-top: 2px; }
  .nav-btn { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: transparent; color: #cbd5e1; padding: 11px 12px; border-radius: 8px; font-size: 14px; font-weight: 500; margin-bottom: 3px; }
  .nav-btn:hover { background: #1b2740; }
  .nav-btn.active { background: #1d4ed8; color: #fff; }
  .nav-btn .ic { font-size: 16px; width: 20px; text-align: center; flex: none; }
  .nav-btn .lbl { flex: 1; }
  .nav-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: #64748b; }
  .nav-badge { background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .aviso-erro { border-left: 3px solid #ef4444; }
  .aviso-aviso { border-left: 3px solid #f59e0b; }
  .nav-sep { height: 1px; background: #1f2b45; margin: 12px 6px; }
  .nav-perigo { color: #f87171; }
  .nav-perigo:hover { background: #2a1414; }
  .nav-perigo.active { background: #b91c1c; color: #fff; }
  .nav-perigo .nav-dot { background: #ef4444; box-shadow: 0 0 0 0 rgba(239,68,68,.7); animation: pulseDot 1.4s infinite; }
  @keyframes pulseDot { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,.7); } 70% { box-shadow: 0 0 0 7px rgba(239,68,68,0); } 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); } }
  /* Secao "Responder todo mundo" (perigosa). */
  .perigo-box { border: 1px solid #7f1d1d; background: #1a0e0e; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .perigo-box ul.avisos-lista { list-style: none; padding: 0; margin: 0; }
  .perigo-box ul.avisos-lista li { display: block; background: transparent; padding: 8px 0; margin: 0; border-bottom: 1px solid #3f1d1d; font-size: 14px; line-height: 1.5; letter-spacing: normal; color: #fecaca; }
  .perigo-box ul.avisos-lista li:last-child { border-bottom: none; }
  .btn-liberar { background: #dc2626; color: #fff; width: 100%; padding: 13px; font-size: 15px; }
  .btn-liberar:disabled { opacity: .45; cursor: not-allowed; }
  .btn-voltar-lista { background: #22c55e; color: #06210f; width: 100%; padding: 13px; font-size: 15px; }
  .ack { display: flex; align-items: flex-start; gap: 10px; background: #0f172a; padding: 12px 14px; border-radius: 8px; margin: 14px 0; cursor: pointer; }
  .ack input { width: 18px; height: 18px; margin-top: 1px; flex: none; }
  .ack span { font-size: 14px; line-height: 1.4; }
  .b-liberado { background: #450a0a; color: #fca5a5; border: 1px solid #7f1d1d; } .b-liberado .dot { background: #ef4444; }
  .content { flex: 1; min-width: 0; padding: 24px; }
  .card.hidden { display: none; }
  @media (max-width: 760px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; height: auto; position: static; display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 6px; padding: 10px; border-right: none; border-bottom: 1px solid #1f2b45; }
    .brand { display: none; }
    .nav-btn { width: auto; white-space: nowrap; margin-bottom: 0; }
    .content { padding: 16px; }
  }
</style>
</head>
<body>
  <div class="layout">
    <nav class="sidebar">
      <div class="brand">Painel do Bot<small>Ferreira Ramos</small></div>
      <button class="nav-btn" data-target="sec-conexao"><span class="ic">📱</span><span class="lbl">Conexão</span><span class="nav-dot" id="nav-dot"></span></button>
      <button class="nav-btn" data-target="sec-avisos"><span class="ic">🔔</span><span class="lbl">Avisos</span><span class="nav-badge" id="nav-badge-avisos" style="display:none">0</span></button>
      <button class="nav-btn" data-target="sec-apikey"><span class="ic">🔑</span><span class="lbl">Chave da API</span></button>
      <button class="nav-btn" data-target="sec-escritorio"><span class="ic">🏢</span><span class="lbl">Escritório</span></button>
      <button class="nav-btn" data-target="sec-clientes"><span class="ic">➕</span><span class="lbl">Criar cliente</span></button>
      <button class="nav-btn" data-target="sec-contexto"><span class="ic">👥</span><span class="lbl">Clientes</span></button>
      <button class="nav-btn" data-target="sec-atendimento"><span class="ic">⏯️</span><span class="lbl">Atendimento (pausar)</span></button>
      <button class="nav-btn" data-target="sec-personalidade"><span class="ic">🎭</span><span class="lbl">Personalidade</span></button>
      <button class="nav-btn" data-target="sec-triagem"><span class="ic">📋</span><span class="lbl">O que anotar e perguntar</span></button>
      <button class="nav-btn" data-target="sec-mensagens"><span class="ic">✉️</span><span class="lbl">Mensagens de encaminhamento</span></button>
      <button class="nav-btn" data-target="sec-advogados"><span class="ic">⚖️</span><span class="lbl">Advogados</span></button>
      <div class="nav-sep"></div>
      <button class="nav-btn nav-perigo" data-target="sec-liberar"><span class="ic">🚨</span><span class="lbl">Responder todo mundo</span><span class="nav-dot" id="nav-dot-liberar" style="display:none"></span></button>
    </nav>
    <main class="content">
  <!-- Avisos e problemas (erros amigaveis) -->
  <div class="card hidden" id="sec-avisos">
    <h2>Avisos e problemas<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Problemas recentes que podem precisar da sua atenção, explicados em linguagem simples (sem precisar olhar o terminal). Se estiver vazio, está tudo funcionando.</span></span></h2>
    <p class="sub">O que deu errado recentemente e o que fazer. Se estiver vazio, está tudo certo.</p>

    <div class="add" style="justify-content:flex-end">
      <button class="btn-add" onclick="carregarAvisos()" title="Atualizar">↻ Atualizar</button>
    </div>

    <div id="avisos"></div>
    <div id="avisos-vazio" class="vazio" style="display:none">Nenhum problema recente. Tudo certo! ✅</div>

    <button class="btn-reset" onclick="limparAvisos()">Limpar avisos</button>
    <div class="status" id="status-avisos"></div>
  </div>

  <!-- Chave da API (DeepSeek) -->
  <div class="card hidden" id="sec-apikey">
    <h2>Chave da API (DeepSeek)<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">A chave de acesso ao serviço de inteligência artificial (DeepSeek) que gera as respostas do bot. Sem ela, o bot conecta ao WhatsApp mas não consegue responder. A chave fica guardada só neste computador.</span></span></h2>
    <p class="sub">Sem esta chave o bot conecta ao WhatsApp, mas <b>não consegue responder</b>. Cole a chave fornecida pelo escritório e clique em Salvar.</p>
    <div id="apikey-estado" class="banner b-carregando" style="margin-bottom:16px"><span class="dot"></span><span id="apikey-estado-txt">Verificando...</span></div>
    <div class="add">
      <input type="password" id="apikey" placeholder="Cole aqui a chave (ex: sk-...)" autocomplete="off" />
      <button class="btn-add" onclick="mostrarChave()" title="Mostrar/ocultar" id="apikey-olho">👁</button>
    </div>
    <button class="btn-save" onclick="salvarApiKey()">Salvar chave</button>
    <div class="status" id="status-apikey"></div>

    <hr style="border:none;border-top:1px solid #334155;margin:24px 0" />

    <h2>Chave do Google — áudios e imagens<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Opcional. Com esta chave (Google Gemini) o bot passa a ouvir os áudios e ver as imagens que os clientes enviam, e responde normalmente. Sem ela, o bot avisa que uma pessoa vai responder, como antes.</span></span></h2>
    <p class="sub">Opcional. Com ela o bot <b>entende áudios e imagens</b> enviados pelos clientes. Sem ela, esses casos vão para atendimento humano (como antes). Crie a chave em <code>aistudio.google.com</code>.</p>
    <div id="gemini-estado" class="banner b-carregando" style="margin-bottom:16px"><span class="dot"></span><span id="gemini-estado-txt">Verificando...</span></div>
    <div class="add">
      <input type="password" id="gemini-key" placeholder="Cole aqui a chave do Google (ex: AIza...)" autocomplete="off" />
      <button class="btn-add" onclick="mostrarChaveGemini()" title="Mostrar/ocultar">👁</button>
    </div>
    <button class="btn-save" onclick="salvarGeminiKey()">Salvar chave do Google</button>
    <div class="status" id="status-gemini"></div>

    <p class="sub" style="margin-top:16px">As chaves ficam guardadas só neste computador (arquivo <code>.env</code>) e nunca vão para a internet nem para o repositório.</p>
  </div>

  <!-- Conexao do WhatsApp -->
  <div class="card" id="sec-conexao">
    <h1>Conexão do WhatsApp<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Mostra se o bot está conectado ao WhatsApp do escritório. Se aparecer um QR code, escaneie com o celular para conectar. Use "Trocar de WhatsApp" para conectar outro número.</span></span></h1>
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

  <!-- Escritorio (areas atendidas + informacoes gerais) -->
  <div class="card hidden" id="sec-escritorio">
    <h2>Escritório<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">O que o bot sabe sobre o escritório: as áreas que vocês atendem e as informações gerais (horário, endereço, orientações). É daqui que ele responde se o escritório atende ou não um assunto — mantenha as áreas completas.</span></span></h2>
    <p class="sub">O que o bot sabe sobre o escritório. É daqui que ele responde <b>quais áreas vocês atendem</b> — se uma área estiver faltando, o bot pode dizer ao cliente que o escritório não atende. As alterações valem na hora, sem reiniciar.</p>

    <div style="margin-bottom:6px;font-size:13px;color:#94a3b8">Áreas que o escritório atende (separadas por vírgula)</div>
    <div class="add">
      <input type="text" id="esc-areas" placeholder="Ex: trabalhista, família, previdenciário" />
    </div>

    <div style="margin-bottom:6px;font-size:13px;color:#94a3b8">Informações do escritório (horário, endereço, perguntas frequentes, orientações ao bot)</div>
    <textarea id="esc-descricao" rows="12" placeholder="Ex:
Horário de atendimento: Segunda a Sexta, 9h às 18h
Localização: Londrina, PR

## Perguntas frequentes
- Divórcio consensual: pode ser feito em cartório se não houver filhos menores"></textarea>

    <button class="btn-save" onclick="salvarEscritorio()">Salvar escritório</button>
    <div class="status" id="status-esc"></div>
    <p class="sub" style="margin-top:16px">Dica: cadastre também um advogado com cada área na aba <b>Advogados</b>, para o bot saber a quem encaminhar os casos.</p>
  </div>

  <!-- Whitelist / cadastro de clientes -->
  <div class="card hidden" id="sec-clientes">
    <h2>Criar cliente<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">A lista de números que o bot atende — ele responde apenas quem está aqui. Ao adicionar um cliente, você já preenche a ficha dele, para o bot saber com quem está falando desde a primeira mensagem.</span></span></h2>
    <p class="sub">Autoriza o número (o bot só responde quem foi cadastrado) e já cria a ficha do cliente — assim o bot sabe com quem está falando desde a primeira mensagem.</p>

    <div class="adv">
      <div class="row">
        <div class="field"><label>Número (WhatsApp)</label><input type="text" id="novo" placeholder="Ex: 5514998689481" /></div>
        <div class="field"><label>Nome</label><input type="text" id="novo-nome" placeholder="Ex: João Silva" /></div>
      </div>
      <div class="field"><label>Área de interesse (opcional)</label><input type="text" id="novo-area" placeholder="Ex: trabalhista" /></div>
      <div class="field" style="margin-top:8px"><label>Observações (opcional)</label><textarea id="novo-obs" rows="3" placeholder="Resumo do caso, o que já se sabe sobre o cliente..."></textarea></div>
      <div class="adv-foot"><button class="btn-add" onclick="adicionar()">+ Adicionar cliente</button></div>
    </div>

    <div class="status" id="status"></div>
    <p class="sub" style="margin-top:16px">Número: país + DDD + número, só dígitos (ex: <code>5514998689481</code>). O que você escrever aqui vai para as anotações do escritório na ficha e <b>nunca é alterado pelo bot</b>. Os clientes cadastrados aparecem nas abas <b>Clientes</b> e <b>Atendimento</b>.</p>
  </div>

  <!-- Personalidade do bot -->
  <div class="card hidden" id="sec-personalidade">
    <h2>Personalidade do bot<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Define o tom, o estilo e o jeito de falar do bot com os clientes. Edite para deixar as respostas mais formais, mais calorosas, etc. As mudanças valem na hora, sem reiniciar.</span></span></h2>
    <p class="sub">Tom, estilo e papel do assistente. Use <code>{nomeInstituicao}</code> para inserir o nome do escritório. As alterações valem na hora, sem reiniciar.</p>
    <textarea id="personalidade" rows="14" placeholder="Descreva como o bot deve se comportar..."></textarea>
    <button class="btn-save" onclick="salvarPersonalidade()">Salvar personalidade</button>
    <button class="btn-reset" onclick="restaurarPersonalidade()">Restaurar padrão</button>
    <div class="status" id="status-pers"></div>
  </div>

  <!-- O que o bot anota sobre os clientes / o que a triagem tenta descobrir -->
  <div class="card hidden" id="sec-triagem">
    <h2>O que anotar e perguntar<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Define o que o bot registra na ficha de cada cliente e o que ele tenta descobrir antes de encaminhar o caso. Um item por linha. As mudanças valem na hora, sem reiniciar.</span></span></h2>
    <p class="sub">O que o bot guarda sobre cada cliente e o que ele procura saber na triagem. Escreva <b>um item por linha</b>. As alterações valem na hora, sem reiniciar.</p>

    <div style="margin-bottom:6px;font-size:13px;color:#94a3b8">Anotar na ficha (quando o cliente mencionar)</div>
    <textarea id="triagem-anotar" rows="11" placeholder="Um item por linha. Ex.: Cidade onde mora"></textarea>
    <p class="sub" style="margin:6px 0 14px">O bot <b>não pergunta</b> por estes itens: ele apenas registra os que aparecerem na conversa. Pode ser uma lista longa, sem prejuízo para o atendimento — e ele continua anotando o que for relevante mesmo que não esteja aqui.</p>

    <div style="margin-bottom:6px;font-size:13px;color:#94a3b8">Tentar descobrir antes de encaminhar (no máximo ${MAX_DESCOBRIR} itens)</div>
    <textarea id="triagem-descobrir" rows="6" placeholder="Um item por linha. Ex.: Desde quando (datas)"></textarea>
    <p class="sub" style="margin:6px 0 8px">⚠️ Aqui o bot <b>pergunta</b>. Vá com calma: quanto mais itens, mais o atendimento vira formulário e mais gente desiste no meio. São prioridades, não obrigações — o bot continua encaminhando na hora se o cliente pedir para falar com alguém, ficar impaciente ou o caso for urgente, mesmo faltando itens. Por isso o limite de ${MAX_DESCOBRIR}.</p>

    <button class="btn-save" onclick="salvarTriagem()">Salvar</button>
    <button class="btn-reset" onclick="restaurarTriagem()">Restaurar padrão</button>
    <div class="status" id="status-triagem"></div>
  </div>

  <!-- Mensagens de encaminhamento -->
  <div class="card hidden" id="sec-mensagens">
    <h2>Mensagens de encaminhamento<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Os textos enviados quando o bot passa o atendimento para um advogado: a mensagem ao cliente e o alerta ao advogado. Use os campos entre chaves (ex.: {nome}) para inserir dados automaticamente.</span></span></h2>
    <p class="sub">Textos enviados quando o bot encaminha o atendimento a um advogado. As alterações valem na hora, sem reiniciar.</p>

    <div style="margin-bottom:6px;font-size:13px;color:#94a3b8">Mensagem ao cliente</div>
    <textarea id="msg-cliente" rows="5" placeholder="Mensagem enviada ao cliente quando o caso é encaminhado..."></textarea>
    <p class="sub" style="margin:6px 0 14px">Campos disponíveis: <code>{nome}</code> (primeiro nome do cliente), <code>{instituicao}</code>.</p>

    <div style="margin-bottom:6px;font-size:13px;color:#94a3b8">Mensagem ao advogado</div>
    <textarea id="msg-advogado" rows="8" placeholder="Alerta enviado ao advogado com o resumo do atendimento..."></textarea>
    <p class="sub" style="margin:6px 0 8px">Campos disponíveis: <code>{nome}</code>, <code>{numero}</code>, <code>{area}</code>, <code>{motivo}</code>, <code>{ultimaMensagem}</code>, <code>{nomeAdvogado}</code>, <code>{instituicao}</code>.</p>

    <button class="btn-save" onclick="salvarMensagens()">Salvar mensagens</button>
    <button class="btn-reset" onclick="restaurarMensagens()">Restaurar padrão</button>
    <div class="status" id="status-msg"></div>
  </div>

  <!-- Advogados de redirecionamento -->
  <div class="card hidden" id="sec-advogados">
    <h2>Advogados de redirecionamento<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Quem recebe os atendimentos encaminhados, por área do direito. Quando o bot escala um caso, escolhe o advogado pela área; sem área correspondente, usa o marcado como padrão.</span></span></h2>
    <p class="sub">Quando o bot escala um atendimento, escolhe o advogado pela <b>área</b>. Sem área correspondente, usa o marcado como <b>padrão</b>. As alterações valem na hora.</p>

    <div class="adv">
      <div class="row">
        <div class="field"><label>Nome</label><input type="text" id="adv-nome" placeholder="Ex: Dra. Maria" /></div>
        <div class="field"><label>Número (WhatsApp)</label><input type="text" id="adv-numero" placeholder="5514998689481" /></div>
      </div>
      <div class="field"><label>Áreas (separadas por vírgula)</label><input type="text" id="adv-areas" placeholder="trabalhista, familia" /></div>
      <div class="checks">
        <label><input type="checkbox" id="adv-padrao" /> Padrão</label>
        <label><input type="checkbox" id="adv-ativo" checked /> Ativo</label>
      </div>
      <div class="adv-foot"><button class="btn-add" onclick="adicionarAdv()">+ Adicionar advogado</button></div>
    </div>

    <div id="advs"></div>
    <div id="advs-vazio" class="vazio" style="display:none">Nenhum advogado cadastrado.</div>

    <div class="status" id="status-adv"></div>
    <p class="sub" style="margin-top:16px">Número no formato país + DDD + número, só dígitos. Áreas separadas por vírgula (ex: <code>trabalhista, familia</code>). Você pode editar os advogados na lista abaixo — <b>as mudanças são salvas automaticamente</b>.</p>
  </div>

  <!-- Atendimento por cliente (pausar/reativar o bot) -->
  <div class="card hidden" id="sec-atendimento">
    <h2>Atendimento por cliente<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Liga ou desliga o bot para cada cliente. Ao encaminhar para um advogado, o bot pausa sozinho e uma pessoa assume a conversa pelo WhatsApp; reative quando quiser que o bot volte a atender.</span></span></h2>
    <p class="sub">Ligue ou desligue o bot para cada cliente. Ao encaminhar para um advogado, o bot <b>pausa sozinho</b> — reative quando quiser que ele volte a atender. Enquanto pausado, uma pessoa responde pelo WhatsApp e o bot fica em silêncio.</p>

    <div class="add" style="justify-content:flex-end">
      <button class="btn-add" onclick="carregarAtendimentos()" title="Atualizar lista">↻ Atualizar</button>
    </div>

    <div id="atendimentos"></div>
    <div id="atendimentos-vazio" class="vazio" style="display:none">Nenhum cliente cadastrado ainda.</div>
    <div class="status" id="status-atend"></div>
  </div>

  <!-- Contexto dos clientes -->
  <div class="card hidden" id="sec-contexto">
    <h2>Clientes<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">O que o bot sabe sobre cada cliente (assunto, histórico do caso). Edite para corrigir algo que a IA tenha entendido errado — o bot usa este texto como contexto nas próximas mensagens.</span></span></h2>
    <p class="sub">O que o bot sabe sobre cada cliente. Edite para corrigir algo que a IA tenha entendido errado. O bot usa este texto como contexto nas próximas mensagens.</p>

    <div class="add">
      <select id="cliente-sel" onchange="carregarCliente()"></select>
      <button class="btn-add" onclick="carregarClientes()" title="Atualizar lista">↻</button>
    </div>

    <textarea id="cliente-md" rows="14" placeholder="Selecione um cliente para ver e editar o contexto..."></textarea>
    <button class="btn-save" onclick="salvarCliente()">Salvar contexto</button>
    <button class="btn-reset" onclick="removerAutorizacao()">Remover autorização deste cliente</button>
    <div class="status" id="status-cli"></div>
    <p class="sub" style="margin-top:16px">Dica: o que estiver abaixo de <code>## Anotações do escritório</code> nunca é alterado pelo bot — bom lugar para suas notas. "Remover autorização" faz o bot parar de responder este número (o histórico é mantido).</p>
  </div>

  <!-- Responder todo mundo (desliga a whitelist) — SECAO PERIGOSA -->
  <div class="card hidden" id="sec-liberar">
    <h2>Responder todo mundo<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Desliga a lista de autorização. Com isso o bot responde QUALQUER número que mandar mensagem, e não só os clientes cadastrados. Use com muito cuidado — o normal é deixar DESLIGADO.</span></span></h2>
    <p class="sub">Normalmente o bot só responde os números que você cadastrou. Aqui você pode <b>desligar essa proteção</b> e fazer o bot responder <b>qualquer pessoa</b> que mandar mensagem.</p>

    <div id="liberar-estado" class="banner b-carregando" style="margin-bottom:16px"><span class="dot"></span><span id="liberar-estado-txt">Verificando...</span></div>

    <!-- Quando DESLIGADO: avisos + travamento por confirmacao -->
    <div id="liberar-off">
      <div class="perigo-box">
        <div style="font-weight:700;color:#fca5a5;margin-bottom:8px">⚠️ Leia antes de ligar. Ao ligar, o bot passa a:</div>
        <ul class="avisos-lista">
          <li>📢 <b>Responder QUALQUER número</b> que mandar mensagem — inclusive desconhecidos, spam, propaganda e trotes.</li>
          <li>🔓 <b>Ignorar a lista de clientes autorizados</b> — a aba "Criar cliente" deixa de ter efeito enquanto isso estiver ligado.</li>
          <li>💸 <b>Gastar créditos da API</b> (DeepSeek/Google) com cada mensagem recebida, de qualquer pessoa. Isso pode custar dinheiro rápido.</li>
          <li>🤖 <b>Atender e triar automaticamente</b> pessoas que não são clientes, podendo passar informações e até encaminhar para advogados.</li>
          <li>🔒 <b>Riscos de privacidade/LGPD</b>: o bot conversará com pessoas com quem o escritório não tem relação.</li>
        </ul>
      </div>
      <p class="sub">O uso recomendado é <b>deixar isto desligado</b> e autorizar cliente por cliente na aba "Criar cliente". Só ligue se você tem certeza absoluta do que está fazendo.</p>
      <label class="ack"><input type="checkbox" id="liberar-ack" onchange="atualizarBotaoLiberar()" /><span>Eu entendi que o bot vai <b>responder todo mundo</b>, ignorando a lista de clientes, e que isso pode gastar créditos e ter riscos de privacidade.</span></label>
      <button class="btn-liberar" id="btn-liberar" disabled onclick="ligarLiberar()">Ligar "responder todo mundo"</button>
    </div>

    <!-- Quando LIGADO: alerta forte + botao facil para voltar ao normal -->
    <div id="liberar-on" style="display:none">
      <div class="perigo-box" style="border-color:#dc2626;background:#2a0e0e">
        <div style="font-weight:700;color:#fecaca;font-size:15px;margin-bottom:6px">🚨 O bot está respondendo TODO MUNDO agora.</div>
        <p class="sub" style="color:#fca5a5;margin:0">A lista de clientes autorizados está sendo <b>ignorada</b>. Qualquer número que mandar mensagem recebe resposta do bot e consome créditos. Volte ao modo normal assim que possível.</p>
      </div>
      <button class="btn-voltar-lista" onclick="desligarLiberar()">Desligar e voltar a responder só a lista de clientes</button>
    </div>

    <div class="status" id="status-liberar"></div>

    <!-- Blacklist: numeros que nunca sao respondidos, nem no modo liberado -->
    <hr style="border:0;border-top:1px solid #2a2a2a;margin:24px 0" />
    <h2 style="font-size:16px">Números bloqueados<span class="info" tabindex="0" role="img" aria-label="Ajuda">i<span class="tip">Quem está aqui nunca recebe resposta do bot, nem com "responder todo mundo" ligado. Um número entra nesta lista quando você usa "Remover autorização deste cliente" na aba Clientes.</span></span></h2>
    <p class="sub">Estes números <b>nunca</b> são respondidos pelo bot — nem quando o "responder todo mundo" está ligado. Um número entra aqui quando você clica em <b>"Remover autorização deste cliente"</b> na aba <b>Clientes</b>.</p>
    <div id="bloq-lista"><p class="sub">Carregando...</p></div>
    <div class="status" id="status-bloq"></div>
  </div>
    </main>
  </div>

<script>
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
      // Reflete o status no "dot" do botao Conexão da barra lateral.
      const dot = document.getElementById('nav-dot');
      if (dot) {
        const cores = { conectado: '#22c55e', qr: '#f59e0b', carregando: '#64748b', desconectado: '#ef4444', falha: '#ef4444' };
        dot.style.background = cores[s.status] || '#64748b';
      }
      const qrbox = document.getElementById('qrbox');
      if (s.status === 'qr' && s.qr) {
        document.getElementById('qrimg').src = s.qr;
        qrbox.style.display = 'block';
      } else {
        qrbox.style.display = 'none';
      }
    } catch (e) { /* ignora; tenta de novo no proximo ciclo */ }
  }

  // ---- Criar cliente ----
  function setStatus(msg, ok){
    const s = document.getElementById('status');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function adicionar(){
    const inp = document.getElementById('novo');
    const nome = document.getElementById('novo-nome').value.trim();
    const n = soDigitos(inp.value);
    if (n.length < 12 || n.length > 13) { setStatus('Número inválido. Use país+DDD+número (12 ou 13 dígitos).', false); return; }
    if (!nome) { setStatus('Informe o nome do cliente.', false); return; }
    const area = document.getElementById('novo-area').value.trim();
    const observacoes = document.getElementById('novo-obs').value.trim();
    try {
      const r = await fetch('/api/whitelist/cliente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numero: n, nome, area, observacoes }) });
      const cfg = await r.json();
      if (cfg.erro) return setStatus('Erro: ' + cfg.erro, false);
      inp.value = '';
      document.getElementById('novo-nome').value = '';
      document.getElementById('novo-area').value = '';
      document.getElementById('novo-obs').value = '';
      setStatus('Cliente adicionado! Ficha criada e já vale (sem reiniciar). Veja nas abas Clientes e Atendimento.', true);
      carregarClientes();
      carregarAtendimentos();
    } catch (e) { setStatus('Erro ao adicionar: ' + e.message, false); }
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
    // Liga os eventos dos campos a model "advogados". Tudo salva automaticamente.
    box.querySelectorAll('input[data-k]').forEach((el) => {
      const k = el.getAttribute('data-k');
      if (el.type === 'checkbox') {
        el.addEventListener('change', () => {
          const i = Number(el.getAttribute('data-i'));
          if (k === 'padrao') {
            // "Padrão" e exclusivo: marcar um desmarca os outros.
            advogados.forEach((x, j) => { x.padrao = (j === i) ? el.checked : false; });
          } else {
            advogados[i].ativo = el.checked;
          }
          persistirAdvs(true); // re-renderiza (estado dos checkboxes)
        });
      } else {
        // Texto: atualiza a memoria enquanto digita e SALVA ao sair do campo.
        el.addEventListener('input', () => {
          const i = Number(el.getAttribute('data-i'));
          if (k === 'areas') advogados[i].areas = el.value.split(',').map((s) => s.trim()).filter(Boolean);
          else advogados[i][k] = el.value;
        });
        el.addEventListener('change', () => persistirAdvs(false));
      }
    });
    box.querySelectorAll('button[data-rem]').forEach((b) => {
      b.addEventListener('click', () => {
        advogados.splice(Number(b.getAttribute('data-rem')), 1);
        persistirAdvs(true, 'Advogado removido.');
      });
    });
  }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function adicionarAdv(){
    const nome = document.getElementById('adv-nome').value.trim();
    const numero = soDigitos(document.getElementById('adv-numero').value);
    if (!nome) return setStatusAdv('Informe o nome do advogado.', false);
    if (numero.length < 12 || numero.length > 13) return setStatusAdv('Número inválido. Use país+DDD+número (12 ou 13 dígitos).', false);
    const areas = document.getElementById('adv-areas').value.split(',').map((s) => s.trim()).filter(Boolean);
    const padrao = document.getElementById('adv-padrao').checked;
    const ativo = document.getElementById('adv-ativo').checked;
    if (padrao) advogados.forEach((a) => { a.padrao = false; }); // "padrão" é exclusivo
    advogados.push({ nome, numero, areas, padrao, ativo });
    // Limpa o formulário de criar.
    document.getElementById('adv-nome').value = '';
    document.getElementById('adv-numero').value = '';
    document.getElementById('adv-areas').value = '';
    document.getElementById('adv-padrao').checked = false;
    document.getElementById('adv-ativo').checked = true;
    persistirAdvs(true, 'Advogado adicionado e salvo.');
  }
  async function carregarAdvs(){
    try {
      const r = await fetch('/api/advogados');
      const d = await r.json();
      advogados = (d.advogados || []).map((a) => ({ nome: a.nome||'', numero: a.numero||'', areas: a.areas||[], padrao: !!a.padrao, ativo: a.ativo !== false }));
      renderAdvs();
    } catch (e) { setStatusAdv('Erro ao carregar: ' + e.message, false); }
  }
  // Salva a lista atual no servidor. rerender: re-sincroniza a partir da resposta
  // (usado em adicionar/remover/checkbox); em edicoes de texto salvamos sem
  // re-renderizar para nao atrapalhar quem ainda esta digitando.
  async function persistirAdvs(rerender, msg){
    try {
      const r = await fetch('/api/advogados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ advogados }) });
      const d = await r.json();
      if (d.erro) return setStatusAdv('Erro ao salvar: ' + d.erro, false);
      if (rerender) {
        advogados = (d.advogados || []).map((a) => ({ nome: a.nome||'', numero: a.numero||'', areas: a.areas||[], padrao: !!a.padrao, ativo: a.ativo !== false }));
        renderAdvs();
      }
      setStatusAdv(msg || 'Alterações salvas.', true);
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
        o.textContent = (c.pausado ? '⏸ ' : '') + (c.nome || c.numero) + ' (' + c.numero + ')';
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
  async function removerAutorizacao(){
    if (!clienteAtual) return setStatusCli('Selecione um cliente primeiro.', false);
    if (!confirm('Remover a autorização deste cliente? O bot vai parar de responder este número — inclusive se o "responder todo mundo" estiver ligado (o número entra na lista de bloqueados). O histórico e o contexto são mantidos.')) return;
    try {
      const r = await fetch('/api/whitelist/remover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: clienteAtual }) });
      const d = await r.json();
      if (d.erro) return setStatusCli('Erro: ' + d.erro, false);
      setStatusCli('Autorização removida e número bloqueado. O bot não responde mais este número' +
        (d.liberarTodos ? ', mesmo com o "responder todo mundo" ligado.' : '.') +
        ' Para desfazer, veja "Números bloqueados" na aba "Responder todo mundo".', true);
      carregarClientes();
      carregarAtendimentos();
      carregarBloqueados();
    } catch (e) { setStatusCli('Erro ao remover: ' + e.message, false); }
  }

  // ---- Chave da API (DeepSeek) ----
  function setStatusApiKey(msg, ok){
    const s = document.getElementById('status-apikey');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  function mostrarChave(){
    const inp = document.getElementById('apikey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }
  async function carregarApiKey(){
    try {
      const r = await fetch('/api/apikey');
      const d = await r.json();
      const est = document.getElementById('apikey-estado');
      const txt = document.getElementById('apikey-estado-txt');
      if (d.configurada) {
        est.className = 'banner b-conectado';
        txt.textContent = 'Chave configurada (' + d.mascara + ')';
      } else {
        est.className = 'banner b-falha';
        txt.textContent = 'Nenhuma chave configurada — o bot não vai responder.';
      }
    } catch (e) { /* ignora */ }
  }
  async function salvarApiKey(){
    const chave = document.getElementById('apikey').value.trim();
    if (!chave) return setStatusApiKey('Cole a chave antes de salvar.', false);
    try {
      const r = await fetch('/api/apikey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave }) });
      const d = await r.json();
      if (d.erro) return setStatusApiKey('Erro: ' + d.erro, false);
      document.getElementById('apikey').value = '';
      setStatusApiKey('Chave salva! Já vale para as próximas mensagens (sem reiniciar).', true);
      carregarApiKey();
    } catch (e) { setStatusApiKey('Erro ao salvar: ' + e.message, false); }
  }

  // ---- Chave do Google/Gemini (audios e imagens) ----
  function setStatusGemini(msg, ok){
    const s = document.getElementById('status-gemini');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  function mostrarChaveGemini(){
    const inp = document.getElementById('gemini-key');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }
  async function carregarGeminiKey(){
    try {
      const r = await fetch('/api/apikey-gemini');
      const d = await r.json();
      const est = document.getElementById('gemini-estado');
      const txt = document.getElementById('gemini-estado-txt');
      if (d.configurada) {
        est.className = 'banner b-conectado';
        txt.textContent = 'Chave configurada (' + d.mascara + ') — o bot entende áudios e imagens.';
      } else {
        // Amarelo (nao vermelho): a chave e opcional, o bot funciona sem ela.
        est.className = 'banner b-qr';
        txt.textContent = 'Sem chave — áudios e imagens vão para atendimento humano.';
      }
    } catch (e) { /* ignora */ }
  }
  async function salvarGeminiKey(){
    const chave = document.getElementById('gemini-key').value.trim();
    if (!chave) return setStatusGemini('Cole a chave antes de salvar.', false);
    try {
      const r = await fetch('/api/apikey-gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave }) });
      const d = await r.json();
      if (d.erro) return setStatusGemini('Erro: ' + d.erro, false);
      document.getElementById('gemini-key').value = '';
      setStatusGemini('Chave salva! Os próximos áudios e imagens já serão entendidos (sem reiniciar).', true);
      carregarGeminiKey();
    } catch (e) { setStatusGemini('Erro ao salvar: ' + e.message, false); }
  }

  // ---- Escritorio (areas atendidas + informacoes gerais) ----
  function setStatusEsc(msg, ok){
    const s = document.getElementById('status-esc');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarEscritorio(){
    try {
      const r = await fetch('/api/escritorio');
      const d = await r.json();
      if (d.erro) return setStatusEsc('Erro ao carregar: ' + d.erro, false);
      document.getElementById('esc-areas').value = d.areas || '';
      document.getElementById('esc-descricao').value = d.descricao || '';
    } catch (e) { setStatusEsc('Erro ao carregar: ' + e.message, false); }
  }
  async function salvarEscritorio(){
    const areas = document.getElementById('esc-areas').value;
    const descricao = document.getElementById('esc-descricao').value;
    try {
      const r = await fetch('/api/escritorio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ areas, descricao }) });
      const d = await r.json();
      if (d.erro) return setStatusEsc('Erro: ' + d.erro, false);
      document.getElementById('esc-areas').value = d.areas || '';
      document.getElementById('esc-descricao').value = d.descricao || '';
      setStatusEsc('Escritório salvo! Já vale para as próximas mensagens.', true);
    } catch (e) { setStatusEsc('Erro ao salvar: ' + e.message, false); }
  }

  // ---- Mensagens de encaminhamento ----
  let msgPadrao = { cliente: '', advogado: '' };
  function setStatusMsg(msg, ok){
    const s = document.getElementById('status-msg');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarMensagens(){
    try {
      const r = await fetch('/api/mensagens');
      const d = await r.json();
      msgPadrao = { cliente: d.padraoCliente || '', advogado: d.padraoAdvogado || '' };
      document.getElementById('msg-cliente').value = d.cliente || '';
      document.getElementById('msg-advogado').value = d.advogado || '';
    } catch (e) { setStatusMsg('Erro ao carregar: ' + e.message, false); }
  }
  async function salvarMensagens(){
    const cliente = document.getElementById('msg-cliente').value;
    const advogado = document.getElementById('msg-advogado').value;
    try {
      const r = await fetch('/api/mensagens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente, advogado }) });
      const d = await r.json();
      if (d.erro) return setStatusMsg('Erro: ' + d.erro, false);
      document.getElementById('msg-cliente').value = d.cliente || '';
      document.getElementById('msg-advogado').value = d.advogado || '';
      setStatusMsg('Mensagens salvas! Já valem para os próximos encaminhamentos.', true);
    } catch (e) { setStatusMsg('Erro ao salvar: ' + e.message, false); }
  }
  function restaurarMensagens(){
    document.getElementById('msg-cliente').value = msgPadrao.cliente;
    document.getElementById('msg-advogado').value = msgPadrao.advogado;
    setStatusMsg('Padrão carregado no editor. Clique em "Salvar mensagens" para aplicar.', true);
  }

  // ---- O que anotar e perguntar ----
  let triagemPadrao = { anotar: '', descobrir: '' };
  function setStatusTriagem(msg, ok){
    const s = document.getElementById('status-triagem');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarTriagem(){
    try {
      const r = await fetch('/api/triagem');
      const d = await r.json();
      triagemPadrao = { anotar: d.padraoAnotar || '', descobrir: d.padraoDescobrir || '' };
      document.getElementById('triagem-anotar').value = d.anotar || '';
      document.getElementById('triagem-descobrir').value = d.descobrir || '';
    } catch (e) { setStatusTriagem('Erro ao carregar: ' + e.message, false); }
  }
  async function salvarTriagem(){
    const anotar = document.getElementById('triagem-anotar').value;
    const descobrir = document.getElementById('triagem-descobrir').value;
    try {
      const r = await fetch('/api/triagem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anotar, descobrir }) });
      const d = await r.json();
      if (d.erro) return setStatusTriagem('Erro: ' + d.erro, false);
      // Recarrega os campos: a lista de perguntas pode ter sido cortada no limite.
      document.getElementById('triagem-anotar').value = d.anotar || '';
      document.getElementById('triagem-descobrir').value = d.descobrir || '';
      if (d.cortados > 0) {
        return setStatusTriagem('Salvo, mas ' + d.cortados + ' item(ns) de "tentar descobrir" foram descartados: o limite é ${MAX_DESCOBRIR}. O que sobrou já vale para os próximos atendimentos.', false);
      }
      setStatusTriagem('Salvo! Já vale para as próximas mensagens.', true);
    } catch (e) { setStatusTriagem('Erro ao salvar: ' + e.message, false); }
  }
  function restaurarTriagem(){
    document.getElementById('triagem-anotar').value = triagemPadrao.anotar;
    document.getElementById('triagem-descobrir').value = triagemPadrao.descobrir;
    setStatusTriagem('Padrão carregado no editor. Clique em "Salvar" para aplicar.', true);
  }

  // ---- Atendimento por cliente (pausar/reativar) ----
  function setStatusAtend(msg, ok){
    const s = document.getElementById('status-atend');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarAtendimentos(){
    try {
      const r = await fetch('/api/clientes');
      const d = await r.json();
      renderAtendimentos(d.clientes || []);
    } catch (e) { setStatusAtend('Erro ao carregar: ' + e.message, false); }
  }
  function renderAtendimentos(clientes){
    const box = document.getElementById('atendimentos');
    box.innerHTML = '';
    document.getElementById('atendimentos-vazio').style.display = clientes.length ? 'none' : 'block';
    clientes.forEach((c) => {
      const pausado = !!c.pausado;
      const div = document.createElement('div');
      div.className = 'adv';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.gap = '10px';
      div.innerHTML =
        '<div style="flex:1">' +
          '<div style="font-weight:600">' + esc(c.nome || c.numero) + '</div>' +
          '<div class="sub" style="margin:2px 0 0">' + esc(c.numero) + ' · ' +
            (pausado ? '⏸ Atendimento humano' : '🤖 Bot ativo') +
          '</div>' +
        '</div>';
      const b = document.createElement('button');
      b.className = pausado ? 'btn-add' : 'btn-rem';
      b.textContent = pausado ? '▶ Reativar' : '⏸ Pausar';
      b.onclick = () => togglePausa(c.id, !pausado);
      div.appendChild(b);
      box.appendChild(div);
    });
  }
  async function togglePausa(id, pausado){
    try {
      const r = await fetch('/api/cliente/pausa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pausado }) });
      const d = await r.json();
      if (d.erro) return setStatusAtend('Erro: ' + d.erro, false);
      await carregarAtendimentos();
      carregarClientes(); // atualiza os marcadores no dropdown de contexto
      if (!pausado) {
        // Reativou o bot: orienta a atualizar o contexto e abre o editor no cliente.
        setStatusAtend('Bot reativado. Atualize o contexto deste cliente (logo abaixo) com o que foi conversado durante o atendimento humano.', true);
        const sel = document.getElementById('cliente-sel');
        sel.value = String(id);
        carregarCliente();
        document.getElementById('cliente-md').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        setStatusAtend('Cliente pausado. O bot não vai responder até você reativar.', true);
      }
    } catch (e) { setStatusAtend('Erro ao alterar: ' + e.message, false); }
  }

  // ---- Avisos e problemas (erros amigaveis) ----
  function setStatusAvisos(msg, ok){
    const s = document.getElementById('status-avisos');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarAvisos(){
    try {
      const r = await fetch('/api/avisos');
      const d = await r.json();
      renderAvisos(d.avisos || []);
    } catch (e) { /* silencioso: nao poluir a tela por causa do proprio painel */ }
  }
  function renderAvisos(av){
    const box = document.getElementById('avisos');
    box.innerHTML = '';
    document.getElementById('avisos-vazio').style.display = av.length ? 'none' : 'block';
    const badge = document.getElementById('nav-badge-avisos');
    if (av.length) { badge.textContent = av.length > 9 ? '9+' : String(av.length); badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
    av.forEach((a) => {
      const div = document.createElement('div');
      div.className = 'adv aviso-' + (a.nivel === 'erro' ? 'erro' : 'aviso');
      const rep = a.repeticoes && a.repeticoes > 1 ? ' (x' + a.repeticoes + ')' : '';
      div.innerHTML =
        '<div style="display:flex;gap:8px;align-items:baseline">' +
          '<span style="flex:none">' + (a.nivel === 'erro' ? '⛔' : '⚠️') + '</span>' +
          '<div style="flex:1">' +
            '<div style="font-weight:600">' + esc(a.titulo) + rep + '</div>' +
            (a.detalhe ? '<div class="sub" style="margin:2px 0 0">' + esc(a.detalhe) + '</div>' : '') +
            '<div class="sub" style="margin:4px 0 0;font-size:12px">' + esc(a.hora) + '</div>' +
          '</div>' +
        '</div>';
      box.appendChild(div);
    });
  }
  async function limparAvisos(){
    try {
      await fetch('/api/avisos/limpar', { method: 'POST' });
      carregarAvisos();
      setStatusAvisos('Avisos limpos.', true);
    } catch (e) { setStatusAvisos('Erro ao limpar: ' + e.message, false); }
  }

  // ---- Responder todo mundo (desliga a whitelist) — SECAO PERIGOSA ----
  function setStatusLiberar(msg, ok){
    const s = document.getElementById('status-liberar');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  function atualizarBotaoLiberar(){
    // O botao de ligar so destrava depois de marcar a caixa de ciencia.
    const ack = document.getElementById('liberar-ack');
    document.getElementById('btn-liberar').disabled = !ack.checked;
  }
  function renderLiberar(ligado){
    const est = document.getElementById('liberar-estado');
    const txt = document.getElementById('liberar-estado-txt');
    const off = document.getElementById('liberar-off');
    const on = document.getElementById('liberar-on');
    const dot = document.getElementById('nav-dot-liberar');
    if (ligado) {
      est.className = 'banner b-liberado';
      txt.textContent = '🚨 LIGADO — o bot está respondendo TODO MUNDO.';
      off.style.display = 'none';
      on.style.display = 'block';
      if (dot) dot.style.display = 'inline-block';
    } else {
      est.className = 'banner b-conectado';
      txt.textContent = 'Desligado — o bot só responde os clientes cadastrados (recomendado).';
      off.style.display = 'block';
      on.style.display = 'none';
      // Reseta a trava para a proxima vez.
      document.getElementById('liberar-ack').checked = false;
      atualizarBotaoLiberar();
      if (dot) dot.style.display = 'none';
    }
  }
  async function carregarLiberar(){
    try {
      const r = await fetch('/api/liberar');
      const d = await r.json();
      renderLiberar(!!d.liberarTodos);
    } catch (e) { /* ignora; tenta de novo depois */ }
  }
  async function ligarLiberar(){
    // Camada extra de avisos: confirmacao dupla, sendo a ultima com digitacao.
    if (!document.getElementById('liberar-ack').checked) return;
    if (!confirm('ATENÇÃO: o bot vai responder QUALQUER número que mandar mensagem, ignorando a lista de clientes. Isso pode gastar créditos e conversar com desconhecidos.\\n\\nTem certeza que quer LIGAR isso?')) return;
    const conf = prompt('Última confirmação. Para ligar o modo "responder todo mundo", digite LIBERAR (em maiúsculas) abaixo:');
    if (conf === null) return; // cancelou
    if (String(conf).trim().toUpperCase() !== 'LIBERAR') { setStatusLiberar('Cancelado: a palavra de confirmação não confere.', false); return; }
    try {
      const r = await fetch('/api/liberar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ liberarTodos: true }) });
      const d = await r.json();
      if (d.erro) return setStatusLiberar('Erro: ' + d.erro, false);
      renderLiberar(!!d.liberarTodos);
      setStatusLiberar('Modo "responder todo mundo" LIGADO. O bot agora responde qualquer número.', true);
    } catch (e) { setStatusLiberar('Erro ao ligar: ' + e.message, false); }
  }
  async function desligarLiberar(){
    try {
      const r = await fetch('/api/liberar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ liberarTodos: false }) });
      const d = await r.json();
      if (d.erro) return setStatusLiberar('Erro: ' + d.erro, false);
      renderLiberar(!!d.liberarTodos);
      setStatusLiberar('Pronto! Voltou ao normal: o bot só responde os clientes cadastrados.', true);
    } catch (e) { setStatusLiberar('Erro ao desligar: ' + e.message, false); }
  }

  // ---- Números bloqueados (blacklist) ----
  function setStatusBloq(msg, ok){
    const s = document.getElementById('status-bloq');
    s.textContent = msg; s.className = 'status ' + (ok ? 'ok' : 'erro');
  }
  async function carregarBloqueados(){
    try {
      const r = await fetch('/api/bloqueados');
      const d = await r.json();
      renderBloqueados(d.bloqueados || []);
    } catch (e) { /* ignora; tenta de novo depois */ }
  }
  function renderBloqueados(lista){
    const box = document.getElementById('bloq-lista');
    box.innerHTML = '';
    if (!lista.length) {
      box.innerHTML = '<p class="sub">Nenhum número bloqueado.</p>';
      return;
    }
    lista.forEach((b) => {
      const div = document.createElement('div');
      div.className = 'adv';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.gap = '10px';
      div.innerHTML =
        '<div style="flex:1">' +
          '<div style="font-weight:600">' + esc(b.nome || b.numero) + '</div>' +
          '<div class="sub" style="margin:2px 0 0">' + esc(b.numero) + ' · 🚫 bloqueado</div>' +
        '</div>';
      const btn = document.createElement('button');
      btn.className = 'btn-add';
      btn.textContent = 'Desbloquear';
      btn.onclick = () => desbloquear(b.numero, b.nome);
      div.appendChild(btn);
      box.appendChild(div);
    });
  }
  async function desbloquear(numero, nome){
    if (!confirm('Desbloquear ' + (nome || numero) + '?\\n\\nEle NÃO volta a ser cliente autorizado: passa a valer a regra normal (só é respondido se estiver na lista de clientes, ou se o "responder todo mundo" estiver ligado).')) return;
    try {
      const r = await fetch('/api/bloqueados/remover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numero }) });
      const d = await r.json();
      if (d.erro) return setStatusBloq('Erro: ' + d.erro, false);
      setStatusBloq('Número desbloqueado.', true);
      carregarBloqueados();
    } catch (e) { setStatusBloq('Erro ao desbloquear: ' + e.message, false); }
  }

  // ---- Navegacao lateral: mostra uma secao (card) por vez ----
  function mostrarSecao(id){
    document.querySelectorAll('.content > .card').forEach((s) => s.classList.toggle('hidden', s.id !== id));
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-target') === id));
  }
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => mostrarSecao(b.getAttribute('data-target')));
  });
  mostrarSecao('sec-conexao'); // secao inicial

  carregarApiKey();
  carregarGeminiKey();
  carregarEscritorio();
  carregarPersonalidade();
  carregarTriagem();
  carregarMensagens();
  carregarAdvs();
  carregarClientes();
  carregarAtendimentos();
  carregarAvisos();
  carregarLiberar();
  carregarBloqueados();
  atualizarStatus();
  setInterval(atualizarStatus, 2500); // verifica a conexao a cada 2,5s
  setInterval(carregarAvisos, 5000); // atualiza o contador de avisos
  setInterval(carregarLiberar, 8000); // reflete o modo "responder todo mundo" (dot na barra)
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

    // Estado da chave da API (nunca devolve a chave inteira, so mascara).
    if (req.method === 'GET' && req.url === '/api/apikey') {
      return enviarJson(res, 200, apikey.status());
    }

    // Salvar a chave da API. Aplica na hora, sem reiniciar o bot.
    if (req.method === 'POST' && req.url === '/api/apikey') {
      return lerCorpo(req, res, (corpo) => apikey.salvarChave(corpo.chave));
    }

    // Estado da chave do Google/Gemini (audios e imagens).
    if (req.method === 'GET' && req.url === '/api/apikey-gemini') {
      return enviarJson(res, 200, apikey.statusGemini());
    }

    // Salvar a chave do Google/Gemini. Aplica na hora, sem reiniciar o bot.
    if (req.method === 'POST' && req.url === '/api/apikey-gemini') {
      return lerCorpo(req, res, (corpo) => apikey.salvarChaveGemini(corpo.chave));
    }

    // Ler a whitelist.
    if (req.method === 'GET' && req.url === '/api/whitelist') {
      return enviarJson(res, 200, lerConfig());
    }

    // Salvar a whitelist.
    if (req.method === 'POST' && req.url === '/api/whitelist') {
      return lerCorpo(req, res, (corpo) => salvarConfig(corpo));
    }

    // Ler o estado do modo "responder todo mundo" (whitelist ligada/desligada).
    if (req.method === 'GET' && req.url === '/api/liberar') {
      return enviarJson(res, 200, { liberarTodos: lerConfig().liberarTodos });
    }

    // Ligar/desligar o modo "responder todo mundo". Ao ligar, o bot passa a
    // responder QUALQUER numero (a whitelist e ignorada). Vale na hora.
    if (req.method === 'POST' && req.url === '/api/liberar') {
      return lerCorpo(req, res, (corpo) => {
        const cfg = setLiberarTodos(corpo.liberarTodos === true);
        // Ecoa no console/log e nos avisos, para ficar rastreavel.
        if (cfg.liberarTodos) {
          avisos.registrar('aviso', 'Modo "responder todo mundo" LIGADO',
            'A whitelist foi desligada pelo painel: o bot está respondendo qualquer número. Desligue quando não precisar mais.');
        } else {
          console.log('Modo "responder todo mundo" desligado pelo painel.');
        }
        return { liberarTodos: cfg.liberarTodos };
      });
    }

    // Cadastrar um cliente: autoriza o numero na whitelist E ja cria a ficha
    // (.md) preenchida pela secretaria, para o bot conhece-lo desde a 1a mensagem.
    if (req.method === 'POST' && req.url === '/api/whitelist/cliente') {
      return lerCorpo(req, res, (corpo) => {
        const numero = soDigitos(corpo.numero);
        if (numero.length < 12 || numero.length > 13) {
          throw new Error('Número inválido. Use país + DDD + número (12 ou 13 dígitos).');
        }
        const nome = String(corpo.nome || '').trim();
        if (!nome) throw new Error('Informe o nome do cliente.');

        // 1) Autoriza o numero (salvarConfig normaliza e remove duplicados) e
        //    tira da blacklist, senao o cadastro nao teria efeito.
        const cfg = lerConfig();
        const vars = variantes(numero);
        salvarConfig({
          numeros: [...cfg.numeros, numero],
          bloqueados: cfg.bloqueados.filter((n) => !vars.includes(n)),
        });

        // 2) Cria/recupera o cadastro e grava o nome informado.
        const cliente = db.getOrCreateCliente(numero, nome, INSTITUICAO_PADRAO_ID);
        db.setClienteNome(cliente.id, nome);

        // 3) Cria a ficha .md com o briefing da secretaria (abaixo do marcador,
        //    imutavel pelo bot) e vincula ao cadastro.
        const ficha = criarFichaCliente(numero, nome, { area: corpo.area, observacoes: corpo.observacoes });
        db.setClienteArquivoMd(cliente.id, ficha);

        // Devolve a whitelist atualizada para o painel recarregar a lista.
        return lerConfig();
      });
    }

    // Remover a autorizacao (whitelist) de um cliente pelo id. O cadastro e o
    // historico sao mantidos; o bot apenas para de responder esse numero.
    // Alem de tirar da lista de autorizados, o numero entra na BLACKLIST: sem
    // isso, com o modo "responder todo mundo" ligado o bot continuaria
    // respondendo (a whitelist e ignorada nesse modo).
    if (req.method === 'POST' && req.url === '/api/whitelist/remover') {
      return lerCorpo(req, res, (corpo) => {
        const c = db.getCliente(Number(corpo.id));
        if (!c) throw new Error('Cliente não encontrado.');
        const cfg = bloquearNumero(c.numero_telefone);
        return { ok: true, liberarTodos: cfg.liberarTodos };
      });
    }

    // Lista os numeros bloqueados (blacklist), com o nome do cliente quando
    // houver cadastro. Mostrada na aba "Responder todo mundo".
    if (req.method === 'GET' && req.url === '/api/bloqueados') {
      const clientes = db.listClientes();
      const lista = lerConfig().bloqueados.map((numero) => {
        const vars = variantes(numero);
        const c = clientes.find((x) => vars.includes(soDigitos(x.numero_telefone)));
        return { numero, nome: c ? c.nome_display : '' };
      });
      return enviarJson(res, 200, { liberarTodos: lerConfig().liberarTodos, bloqueados: lista });
    }

    // Tira um numero da blacklist. Ele NAO volta a ser autorizado: volta a
    // valer a regra normal (whitelist, ou "responder todo mundo" se ligado).
    if (req.method === 'POST' && req.url === '/api/bloqueados/remover') {
      return lerCorpo(req, res, (corpo) => {
        const numero = soDigitos(corpo.numero);
        if (!numero) throw new Error('Informe o número.');
        desbloquearNumero(numero);
        return { ok: true };
      });
    }

    // Ler os dados do escritorio (areas atendidas + descricao) do .md da instituicao.
    if (req.method === 'GET' && req.url === '/api/escritorio') {
      try {
        return enviarJson(res, 200, escritorio.getEscritorio());
      } catch (e) {
        return enviarJson(res, 500, { erro: e.message });
      }
    }

    // Salvar os dados do escritorio. Regrava o .md; vale na hora, sem reiniciar.
    if (req.method === 'POST' && req.url === '/api/escritorio') {
      return lerCorpo(req, res, (corpo) => escritorio.salvarEscritorio(corpo));
    }

    // Ler a personalidade do bot (texto atual + valor padrao de fabrica).
    if (req.method === 'GET' && req.url === '/api/personalidade') {
      return enviarJson(res, 200, { texto: getPersonalidade(), padrao: PERSONALIDADE_PADRAO });
    }

    // Salvar a personalidade do bot.
    if (req.method === 'POST' && req.url === '/api/personalidade') {
      return lerCorpo(req, res, (corpo) => salvarPersonalidade(corpo.texto));
    }

    // Ler o que anotar/perguntar (listas atuais + defaults de fabrica).
    if (req.method === 'GET' && req.url === '/api/triagem') {
      const t = getTriagem();
      return enviarJson(res, 200, {
        anotar: t.anotar,
        descobrir: t.descobrir,
        padraoAnotar: ANOTAR_PADRAO,
        padraoDescobrir: DESCOBRIR_PADRAO,
        maxDescobrir: MAX_DESCOBRIR,
      });
    }

    // Salvar o que anotar/perguntar. A resposta traz "cortados" quando a lista
    // de perguntas passou do limite (o painel avisa em vez de fingir que salvou).
    if (req.method === 'POST' && req.url === '/api/triagem') {
      return lerCorpo(req, res, (corpo) => salvarTriagem(corpo));
    }

    // Ler as mensagens de encaminhamento (texto atual + defaults de fabrica).
    if (req.method === 'GET' && req.url === '/api/mensagens') {
      const m = getMensagens();
      return enviarJson(res, 200, {
        cliente: m.cliente, advogado: m.advogado,
        padraoCliente: MSG_CLIENTE_PADRAO, padraoAdvogado: MSG_ADVOGADO_PADRAO,
      });
    }

    // Salvar as mensagens de encaminhamento.
    if (req.method === 'POST' && req.url === '/api/mensagens') {
      return lerCorpo(req, res, (corpo) => salvarMensagens(corpo));
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
        pausado: c.pausado ? 1 : 0,
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

    // Lista de avisos/problemas amigaveis para o usuario.
    if (req.method === 'GET' && req.url === '/api/avisos') {
      return enviarJson(res, 200, { avisos: avisos.listar() });
    }

    // Limpa os avisos.
    if (req.method === 'POST' && req.url === '/api/avisos/limpar') {
      avisos.limpar();
      return enviarJson(res, 200, { ok: true });
    }

    // Pausar/reativar o atendimento automatico de um cliente.
    if (req.method === 'POST' && req.url === '/api/cliente/pausa') {
      return lerCorpo(req, res, (corpo) => {
        const c = db.getCliente(Number(corpo.id));
        if (!c) throw new Error('Cliente não encontrado.');
        const pausado = corpo.pausado ? 1 : 0;
        db.setPausado(c.id, pausado);
        return { ok: true, pausado };
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

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      // Porta ocupada = o bot ja esta aberto em outra janela. Encerra com uma
      // mensagem clara em vez de deixar o erro estourar em cascata (o iniciar.bat
      // ja tenta encerrar a instancia anterior automaticamente antes de subir).
      console.error(`A porta ${porta} ja esta em uso: o bot provavelmente ja esta aberto em outra janela. ` +
        'Feche a outra janela do bot (ou reinicie o computador) e abra novamente.');
      process.exit(1);
    }
    console.error('Erro no painel web:', e.message);
  });
  server.listen(porta, '127.0.0.1', () => {
    console.log(`Painel disponivel em http://localhost:${porta}`);
  });
  return server;
}

module.exports = { iniciarPainel, setStatus, setQR, setTrocarHandler };
