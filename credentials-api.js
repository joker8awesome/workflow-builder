/**
 * credentials-api.js
 *
 * 에이전트 자격증명 발급/조회/폐기 API
 * 발급된 원문 키는 1회만 응답으로 반환됨. 서버에는 SHA-256 hash만 저장.
 *
 * 통합: server.js에서
 *   const createCredentialsRouter = require('./credentials-api');
 *   app.use('/', createCredentialsRouter(db));
 *
 * 엔드포인트:
 *   POST   /api/agents/:id/credentials          - 새 키 발급 (1회 표시)
 *   GET    /api/agents/:id/credentials          - 목록 조회 (prefix만)
 *   DELETE /api/agents/:id/credentials/:credId  - 폐기
 */

const express = require('express');
const crypto = require('crypto');

module.exports = function createCredentialsRouter(db) {
  const router = express.Router();
  router.use(express.json());

  /**
   * 새 자격증명 발급
   * body: { name?: string, scopes?: string[], expires_in_days?: number }
   * 응답의 `key` 필드는 이 응답에만 포함되며, 이후 다시 조회 불가.
   */
  router.post('/api/agents/:id/credentials', async (req, res) => {
    try {
      const { id: agent_id } = req.params;
      const {
        name = 'default',
        scopes = ['mcp:read', 'mcp:execute'],
        expires_in_days = null,
      } = req.body || {};

      // 에이전트 존재 확인
      const { rows: agentRows } = await db.query(
        `SELECT id FROM agents WHERE id = $1`,
        [agent_id]
      );
      if (!agentRows[0]) {
        return res.status(404).json({ error: 'agent_not_found', agent_id });
      }

      // 키 생성: wf_ak_<agent_id>_<192bit-base64url>
      const random = crypto.randomBytes(24).toString('base64url');
      const key = `wf_ak_${agent_id}_${random}`;
      const keyHash = crypto.createHash('sha256').update(key).digest('hex');
      const keyPrefix = key.slice(0, 20) + '...';

      const expiresAt = expires_in_days
        ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
        : null;

      const { rows } = await db.query(
        `INSERT INTO agent_credentials
           (agent_id, name, key_hash, key_prefix, scopes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at, expires_at`,
        [agent_id, name, keyHash, keyPrefix, scopes, expiresAt]
      );

      // 감사 로그
      await db.query(
        `INSERT INTO audit_logs (actor, action, resource, timestamp)
         VALUES ($1, 'credential.issue', $2, now())`,
        [
          agent_id,
          JSON.stringify({ credential_id: rows[0].id, scopes, expires_at: expiresAt }),
        ]
      ).catch((e) => console.warn('audit log failed:', e.message));

      res.status(201).json({
        id: rows[0].id,
        agent_id,
        name,
        key, // ★ 원문 키 - 이 응답에서만 반환됨
        key_prefix: keyPrefix,
        scopes,
        created_at: rows[0].created_at,
        expires_at: rows[0].expires_at,
        warning:
          '이 키는 다시 표시되지 않습니다. 지금 안전한 곳에 저장하세요.',
      });
    } catch (err) {
      console.error('POST credentials failed:', err);
      res.status(500).json({ error: 'internal_error', detail: err.message });
    }
  });

  /**
   * 에이전트의 자격증명 목록 (prefix만, 원문 키 없음)
   */
  router.get('/api/agents/:id/credentials', async (req, res) => {
    try {
      const { id: agent_id } = req.params;
      const { rows } = await db.query(
        `SELECT id, name, key_prefix, scopes,
                created_at, last_used_at, expires_at, revoked_at
         FROM agent_credentials
         WHERE agent_id = $1
         ORDER BY created_at DESC`,
        [agent_id]
      );
      res.json({ credentials: rows });
    } catch (err) {
      console.error('GET credentials failed:', err);
      res.status(500).json({ error: 'internal_error', detail: err.message });
    }
  });

  /**
   * 자격증명 폐기
   */
  router.delete('/api/agents/:id/credentials/:credId', async (req, res) => {
    try {
      const { id: agent_id, credId } = req.params;
      const { rowCount } = await db.query(
        `UPDATE agent_credentials
         SET revoked_at = now()
         WHERE id = $1 AND agent_id = $2 AND revoked_at IS NULL`,
        [credId, agent_id]
      );
      if (!rowCount) {
        return res.status(404).json({ error: 'credential_not_found' });
      }
      await db.query(
        `INSERT INTO audit_logs (actor, action, resource, timestamp)
         VALUES ($1, 'credential.revoke', $2, now())`,
        [agent_id, JSON.stringify({ credential_id: credId })]
      ).catch(() => {});
      res.json({ revoked: true, credential_id: credId });
    } catch (err) {
      console.error('DELETE credentials failed:', err);
      res.status(500).json({ error: 'internal_error', detail: err.message });
    }
  });

  return router;
};
