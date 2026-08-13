// 워크플로우 빌더 — 서버 연동 API (Express + PostgreSQL)
// 실행: node server.js  (기본 포트 3737)
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '10mb' }));

// PostgreSQL — 로컬 소켓 trust
const pool = new Pool({
  host: '/opt/data/pgdata',
  database: 'odds',
  user: 'hermes',
});

const PORT = process.env.PORT || 3737;

// CORS — 단일 HTML 파일(file://)에서 접근 허용
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 목록
app.get('/api/workflows', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, updated_at FROM wf_workflows ORDER BY updated_at DESC'
    );
    res.json({ success: true, workflows: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 상세 (전체 데이터)
app.get('/api/workflows/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, data FROM wf_workflows WHERE id = $1', [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, workflow: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 생성 (클라이언트가 id/name/data 제공)
app.post('/api/workflows', async (req, res) => {
  try {
    const { id, name, data } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    await pool.query(
      `INSERT INTO wf_workflows (id, name, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
      [id, name || '', JSON.stringify(data || {})]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 저장 (전체 덮어쓰기 upsert)
app.put('/api/workflows/:id', async (req, res) => {
  try {
    const { name, data } = req.body || {};
    await pool.query(
      `INSERT INTO wf_workflows (id, name, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
      [req.params.id, name || '', JSON.stringify(data || {})]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 삭제
app.delete('/api/workflows/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM wf_workflows WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 공유 보기 라우트 — /wf/:id (읽기 전용 뷰)
app.get('/wf/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, data FROM wf_workflows WHERE id = $1', [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).send('<h2 style="font-family:system-ui;background:#0a0d10;color:#e8eaed;height:100vh;display:flex;align-items:center;justify-content:center;margin:0">워크플로우를 찾을 수 없습니다</h2>');
    }
    const wf = rows[0];
    res.send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${wf.name} — 워크플로우 공유</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0a0d10;color:#e8eaed;height:100vh;display:flex;flex-direction:column;overflow:hidden}
  header{height:52px;background:#12161b;border-bottom:1px solid #232a33;display:flex;align-items:center;padding:0 16px;gap:12px}
  header strong{color:#00ff87}
  #canvas{flex:1;position:relative;overflow:auto}
  .node{position:absolute;min-width:160px;padding:10px 14px;background:#12161b;border:2px solid #232a33;border-radius:12px;display:flex;align-items:center;gap:8px;color:#e8eaed;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .node .nicon{width:26px;height:26px;border-radius:8px;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px}
  .node .nlabel{font-size:14px;font-weight:600}
</style></head><body>
<header><strong>🔗 공유 워크플로우</strong><span style="color:#9aa3ad;font-size:13px">${wf.name}</span></header>
<div id="canvas"></div>
<script>
  const WF = ${JSON.stringify(wf.data || { nodes: [], edges: [] })};
  const canvas = document.getElementById('canvas');
  (WF.nodes || []).forEach(n => {
    const el = document.createElement('div');
    el.className = 'node';
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    const icon = { start:'▶', process:'▢', decision:'◇', end:'●' }[n.type] || '▢';
    const color = { start:'#2ea043', process:'#1f6feb', decision:'#d29922', end:'#d1242f' }[n.type] || '#1f6feb';
    el.innerHTML = '<span class="nicon" style="background:' + color + '">' + icon + '</span><span class="nlabel">' + (n.label||'') + '</span>';
    canvas.appendChild(el);
  });
</script>
</body></html>`);
  } catch (e) {
    res.status(500).send('서버 오류');
  }
});

// 정적 파일 (index.html 서빙)
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`워크플로우 빌더 서버: http://localhost:${PORT}`);
});
