<?php
/**
 * sync.php — caixa-postal da sincronizacao entre os PCs do escritorio.
 *
 * Sobe junto de clientes.php / processos.php (mesma pasta /api do site).
 * Ver servidor/LEIA-ME.txt para as instrucoes de instalacao.
 *
 * NAO conhece nada do dominio do bot: so guarda um pacote JSON por maquina e
 * devolve quando pedirem. Cada PC ENVIA o seu e BUSCA o do outro quando quiser
 * — por isso os dois nunca precisam estar ligados ao mesmo tempo.
 *
 * Acoes (query string ?acao=):
 *   enviar  (POST) — corpo = o pacote JSON. Grava/substitui o da maquina.
 *   buscar  (GET)  — ?de=<id>. Devolve o pacote daquela maquina, ou {vazio:true}.
 *   listar  (GET)  — devolve [{id, rotulo, gravado_em, bytes}].
 *
 * Autenticacao: header X-Sync-Token, comparado com hash_equals (tempo constante).
 */

// Resposta SEMPRE em JSON, inclusive nos erros: o lado Node nao deve nunca ter
// que adivinhar se recebeu uma pagina de erro em HTML do Apache.
header('Content-Type: application/json; charset=utf-8');

function responder($status, $dados) {
    http_response_code($status);
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---------------------------------------------------------------- token
$cfg = __DIR__ . '/sync_config.php';
if (!file_exists($cfg)) {
    responder(500, ['erro' => 'nao_configurado']);
}
require $cfg; // define SYNC_TOKEN

if (!defined('SYNC_TOKEN') || SYNC_TOKEN === '') {
    responder(500, ['erro' => 'nao_configurado']);
}

$enviado = isset($_SERVER['HTTP_X_SYNC_TOKEN']) ? $_SERVER['HTTP_X_SYNC_TOKEN'] : '';
// hash_equals: comparacao em tempo constante (nao vaza o token por timing).
// Nunca ecoamos o token recebido nem o esperado em nenhuma resposta.
if (!is_string($enviado) || !hash_equals(SYNC_TOKEN, $enviado)) {
    responder(401, ['erro' => 'senha_invalida']);
}

// ---------------------------------------------------------------- pasta
$dir = __DIR__ . '/sync';
if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
    responder(500, ['erro' => 'sem_pasta']);
}

// A pasta guarda FICHAS DE CLIENTE e nao pode ser acessivel pelo navegador.
// Criamos a protecao aqui, junto com a pasta, em vez de depender de alguem
// lembrar de subir o .htaccess: a pasta so passa a existir na primeira
// sincronizacao, entao qualquer protecao manual chegaria DEPOIS dos dados.
// Isto e defesa em profundidade, nao substituto da conferencia manual
// (ver PASSO 5 do LEIA-ME.txt) — em servidor com AllowOverride desligado o
// .htaccess e ignorado, e so o teste no navegador revela isso.
$ht = $dir . '/.htaccess';
if (!file_exists($ht)) {
    @file_put_contents($ht, "Require all denied\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
}
// Cinto e suspensorio: se o .htaccess for ignorado, ao menos a listagem da
// pasta nao expoe os nomes dos arquivos.
$idx = $dir . '/index.php';
if (!file_exists($idx)) {
    @file_put_contents($idx, "<?php http_response_code(403);\n");
}

/** O id vira NOME DE ARQUIVO: sem esta validacao seria path traversal direto. */
function id_valido($id) {
    return is_string($id) && preg_match('/^[a-z0-9_-]{1,32}$/', $id) === 1;
}

$acao = isset($_GET['acao']) ? $_GET['acao'] : '';

// ---------------------------------------------------------------- enviar
if ($acao === 'enviar') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        responder(405, ['erro' => 'metodo_invalido']);
    }

    $bruto = file_get_contents('php://input');
    if ($bruto === false) {
        responder(400, ['erro' => 'sem_corpo']);
    }
    if (strlen($bruto) > 5 * 1024 * 1024) {
        responder(413, ['erro' => 'pacote_muito_grande']);
    }

    // Valida o JSON ANTES de gravar: nunca guardamos lixo na caixa-postal.
    $pacote = json_decode($bruto, true);
    if (!is_array($pacote)) {
        responder(400, ['erro' => 'json_invalido']);
    }

    $id = isset($pacote['origem']['id']) ? $pacote['origem']['id'] : '';
    if (!id_valido($id)) {
        responder(400, ['erro' => 'id_invalido']);
    }

    // Grava em .tmp e renomeia: rename() e atomico, entao o outro PC nunca le
    // um arquivo pela metade se buscar no exato instante de um envio.
    $destino = $dir . '/' . $id . '.json';
    $tmp = $destino . '.tmp';
    if (@file_put_contents($tmp, $bruto, LOCK_EX) === false || !@rename($tmp, $destino)) {
        @unlink($tmp);
        responder(500, ['erro' => 'falha_ao_gravar']);
    }
    @chmod($destino, 0600);

    responder(200, [
        'ok' => true,
        'bytes' => strlen($bruto),
        'gravado_em' => gmdate('c'),
    ]);
}

// ---------------------------------------------------------------- buscar
if ($acao === 'buscar') {
    $de = isset($_GET['de']) ? $_GET['de'] : '';
    if (!id_valido($de)) {
        responder(400, ['erro' => 'id_invalido']);
    }

    $arquivo = $dir . '/' . $de . '.json';
    if (!file_exists($arquivo)) {
        // Nao e erro: o outro PC simplesmente ainda nao enviou nada.
        responder(200, ['vazio' => true]);
    }

    $conteudo = @file_get_contents($arquivo);
    if ($conteudo === false) {
        responder(500, ['erro' => 'falha_ao_ler']);
    }

    // Repassa o pacote como esta (ja e JSON valido: validamos ao gravar).
    echo $conteudo;
    exit;
}

// ---------------------------------------------------------------- listar
if ($acao === 'listar') {
    $itens = [];
    // glob() devolve false em erro; foreach(false) emitiria um warning que
    // sujaria a resposta e quebraria o JSON do lado do Node.
    $arquivos = glob($dir . '/*.json');
    if ($arquivos === false) {
        $arquivos = [];
    }
    foreach ($arquivos as $arquivo) {
        $id = basename($arquivo, '.json');
        if (!id_valido($id)) {
            continue;
        }
        $rotulo = $id;
        // O rotulo vem de dentro do proprio pacote (nao guardamos indice a parte).
        $dados = json_decode((string) @file_get_contents($arquivo), true);
        if (isset($dados['origem']['rotulo']) && is_string($dados['origem']['rotulo'])) {
            $rotulo = $dados['origem']['rotulo'];
        }
        $itens[] = [
            'id' => $id,
            'rotulo' => $rotulo,
            'gravado_em' => gmdate('c', (int) filemtime($arquivo)),
            'bytes' => (int) filesize($arquivo),
        ];
    }
    responder(200, $itens);
}

responder(400, ['erro' => 'acao_desconhecida']);
