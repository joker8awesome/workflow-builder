/**
 * auth-credential.js
 *
 * 자격증명(wf_ak_) 기반 인증 — REST와 MCP가 함께 쓰는 단일 구현.
 *
 * 이전에는 인증 체계가 둘이었다:
 *   - REST : WF_ACCESS_TOKEN 단일 공유 문자열 (개별 폐기·만료·감사 불가)
 *   - MCP  : agent_credentials 사용자별 키 (SHA-256 hash, 스코프, 폐기, 만료)
 * 팀 도구로 가려면 사람마다 키를 주고 개별로 끊을 수 있어야 하므로 후자로 통합한다.
 *
 * WF_ACCESS_TOKEN 은 폐기하지 않고 "관리자 복구 경로"로 남긴다.
 * 키를 전부 잃었을 때 서버 접근 권한이 있는 사람만 쓸 수 있는 우회로다.
 */
const crypto = require('crypto');

/**
 * Postgres 배열 리터럴 / JS 배열 / JSON 배열을 모두 문자열 배열로 정규화한다.
 *
 * agent_credentials.scopes 는 실측 결과 배열이 아니라 문자열로 온다:
 *   '{"mcp:read","mcp:execute"}'
 * 이걸 그대로 .includes(scope) 하면 배열 멤버십이 아니라 부분 문자열 검사가 된다.
 * 현재 스코프 3종은 서로의 부분 문자열이 아니라 결과가 우연히 맞았을 뿐이고,
 * 스코프를 하나만 추가해도 조용히 깨진다.
 */
function parseScopes(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== 'string') return [];
  const s = v.trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(String) : []; } catch (e) { /* 아래로 */ }
  }
  return s.replace(/^\{|\}$/g, '')
    .split(',')
    .map(x => x.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function bearer(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/**
 * 자격증명을 조회·검증한다. 유효하면 { agent_id, scopes }, 아니면 { error }.
 */
async function verifyCredential(db, key) {
  const { rows } = await db.query(
    `SELECT agent_id, scopes, expires_at FROM agent_credentials
     WHERE key_hash = $1 AND revoked_at IS NULL`,
    [sha256(key)]
  );
  if (!rows.length) return { error: 'invalid_credentials' };
  if (rows[0].expires_at && new Date(rows[0].expires_at) < new Date()) {
    return { error: 'expired' };
  }
  return { agent_id: rows[0].agent_id, scopes: parseScopes(rows[0].scopes) };
}

/**
 * 지정 스코프를 요구하는 Express 미들웨어를 만든다.
 *
 * opts.allowAccessToken=true 이면 WF_ACCESS_TOKEN 과 일치하는 Bearer 도 통과시킨다
 * (관리자 복구 경로). 이때 req.agent_id 는 'ag_root' 로 표시된다.
 */
function requireScope(db, scope, opts = {}) {
  return async function (req, res, next) {
    const key = bearer(req);
    if (!key) {
      return res.status(401).json({ success: false, error: 'unauthorized', detail: 'Bearer 자격증명 필요' });
    }
    // 관리자 복구 경로 — 환경변수가 설정돼 있을 때만 유효
    const rootToken = process.env.WF_ACCESS_TOKEN || null;
    if (opts.allowAccessToken && rootToken && key === rootToken) {
      req.agent_id = 'ag_root';
      req.scopes = ['mcp:read', 'mcp:execute', 'mcp:admin'];
      return next();
    }
    try {
      const v = await verifyCredential(db, key);
      if (v.error) {
        return res.status(401).json({ success: false, error: v.error });
      }
      if (scope && !v.scopes.includes(scope)) {
        return res.status(403).json({
          success: false, error: 'insufficient_scope',
          required: scope, provided: v.scopes,
        });
      }
      req.agent_id = v.agent_id;
      req.scopes = v.scopes;
      // 사용 기록 — 실패해도 요청은 막지 않는다
      db.query('UPDATE agent_credentials SET last_used_at = now() WHERE key_hash = $1', [sha256(key)])
        .catch(e => console.warn('[auth] last_used_at 갱신 실패:', e.message));
      next();
    } catch (e) {
      console.warn('[auth] 검증 오류:', e.message);
      res.status(500).json({ success: false, error: 'auth_error' });
    }
  };
}

module.exports = { parseScopes, verifyCredential, requireScope, sha256 };
