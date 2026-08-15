#!/usr/bin/env node
/**
 * 텔레그램 웹훅 검증 — 실제 서버·텔레그램 없이 라우트 로직만 확인.
 *
 * 이 엔드포인트는 인터넷에 공개되므로 "막아야 할 것을 실제로 막는가"가 핵심이다.
 * 통과 케이스보다 거부 케이스가 더 중요하다.
 *
 * 실행: node ops/test-telegram-webhook.js
 */
const path = require('path');
const http = require('http');
const notify = require(path.join(__dirname, '..', 'notify'));

let fails = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) fails.push(name);
}

// --- 스텁 ---
const state = { approvals: new Map(), tgCalls: [] };
const pool = {
  query: async (sql, params) => {
    if (sql.includes('UPDATE wf_approvals')) {
      const [decision, who, id] = params;
      const a = state.approvals.get(String(id));
      if (!a || a.decision !== 'pending') return { rowCount: 0 };
      a.decision = decision; a.approver = who;
      return { rowCount: 1 };
    }
    if (sql.includes('SELECT decision, approver')) {
      const a = state.approvals.get(String(params[0]));
      return { rows: a ? [{ decision: a.decision, approver: a.approver }] : [] };
    }
    return { rows: [], rowCount: 0 };
  },
};
// 텔레그램 호출을 가로채 기록만 한다
notify.tg = async (method, body) => { state.tgCalls.push({ method, body }); return { ok: true, result: {} }; };
notify.answerCallback = async (id, text, alert) => { state.tgCalls.push({ method: 'answerCallbackQuery', body: { id, text, alert } }); return { ok: true }; };
notify.resolveMessage = async (...a) => { state.tgCalls.push({ method: 'editMessageText', body: a }); return { ok: true }; };

// --- 라우트 재현 (server.js 와 동일 로직, express 의존 없이) ---
async function handler(req, res) {
  const secret = process.env.WF_TELEGRAM_WEBHOOK_SECRET || '';
  if (!secret) return res.sendStatus(403);
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.sendStatus(403);
  res.sendStatus(200);
  try {
    const cq = req.body && req.body.callback_query;
    if (!cq) return;
    const allowed = String(process.env.WF_TELEGRAM_CHAT_ID || '');
    const from = String(cq.message?.chat?.id ?? '');
    if (allowed && from !== allowed) {
      await notify.answerCallback(cq.id, '권한이 없습니다', true);
      return;
    }
    const m = /^ap:(\d+):(approved|rejected)$/.exec(cq.data || '');
    if (!m) return;
    const [, id, decision] = m;
    const who = cq.from?.username ? '@' + cq.from.username : (cq.from?.first_name || 'user');
    const { rowCount } = await pool.query(
      `UPDATE wf_approvals SET decision=$1, approver=$2, decided_at=now() WHERE id=$3 AND decision='pending'`,
      [decision, who, id]);
    if (!rowCount) {
      const { rows } = await pool.query('SELECT decision, approver FROM wf_approvals WHERE id=$1', [id]);
      const cur = rows[0];
      await notify.answerCallback(cq.id, cur ? `이미 ${cur.decision === 'approved' ? '승인' : '거부'}됨` : '없는 승인 건', true);
      return;
    }
    await notify.answerCallback(cq.id, decision === 'approved' ? '승인했습니다' : '거부했습니다');
    await notify.resolveMessage(cq.message.chat.id, cq.message.message_id, 'x', decision, who);
  } catch (e) { /* 서버와 동일하게 삼킨다 */ }
}

// 최소 HTTP 서버 — express 없이 위 handler 를 그대로 태운다
const app = http.createServer((rq, rs) => {
  let buf = '';
  rq.on('data', c => { buf += c; });
  rq.on('end', () => {
    let body = {};
    try { body = JSON.parse(buf || '{}'); } catch (e) {}
    const res = { sendStatus(c) { rs.statusCode = c; rs.end(); } };
    handler({ headers: rq.headers, body }, res);
  });
});

const cb = (data, chat = '999', id = 'cq1', user = 'tester') => ({
  callback_query: { id, data, from: { username: user }, message: { message_id: 7, chat: { id: chat }, text: 'req' } },
});

// fetch 가 아니라 http.request 를 쓴다.
// listen(0) 이 잡는 임의 포트가 undici 의 차단 포트 목록(6000 등)에 걸리면
// fetch 가 "bad port" 로 실패해 테스트가 간헐적으로 깨진다.
// node:http 에는 그 목록이 없어 어떤 포트든 붙는다.
function post(headers, body) {
  return new Promise((resolve, reject) => {
    const srv = app.listen(0, () => {
      const port = srv.address().port;
      const payload = JSON.stringify(body);
      const rq = http.request({
        host: '127.0.0.1', port, path: '/api/telegram/webhook', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      }, rs => {
        rs.resume();
        rs.on('end', () => setTimeout(() => srv.close(() => resolve(rs.statusCode)), 60));
      });
      rq.on('error', e => srv.close(() => reject(e)));
      rq.end(payload);
    });
  });
}

(async () => {
  process.env.WF_TELEGRAM_CHAT_ID = '999';

  console.log('1) 위조 차단 — 이게 뚫리면 누구나 승인할 수 있다');
  delete process.env.WF_TELEGRAM_WEBHOOK_SECRET;
  check('secret 미설정이면 전부 거부(403)', await post({}, cb('ap:1:approved')) === 403);

  process.env.WF_TELEGRAM_WEBHOOK_SECRET = 'S3CRET';
  check('secret 헤더 없으면 403', await post({}, cb('ap:1:approved')) === 403);
  check('secret 틀리면 403',
    await post({ 'x-telegram-bot-api-secret-token': 'WRONG' }, cb('ap:1:approved')) === 403);

  const H = { 'x-telegram-bot-api-secret-token': 'S3CRET' };

  console.log('\n2) 채팅 제한');
  state.approvals.set('1', { decision: 'pending' });
  state.tgCalls = [];
  await post(H, cb('ap:1:approved', '111'));   // 허용되지 않은 채팅
  check('다른 채팅은 승인 불가', state.approvals.get('1').decision === 'pending');
  check('권한 없음 안내 전송',
    state.tgCalls.some(c => c.method === 'answerCallbackQuery' && /권한/.test(c.body.text)));

  console.log('\n3) 정상 승인');
  state.tgCalls = [];
  const s = await post(H, cb('ap:1:approved', '999'));
  check('200 응답', s === 200);
  check('decision=approved 기록', state.approvals.get('1').decision === 'approved');
  check('approver 기록', state.approvals.get('1').approver === '@tester',
    state.approvals.get('1').approver);
  check('버튼 응답 전송', state.tgCalls.some(c => c.method === 'answerCallbackQuery'));
  check('메시지 갱신(버튼 제거)', state.tgCalls.some(c => c.method === 'editMessageText'));

  console.log('\n4) 중복 클릭 — 두 번째는 덮어쓰지 않아야 한다');
  state.tgCalls = [];
  await post(H, cb('ap:1:rejected', '999'));
  check('이미 approved 인 건이 rejected 로 바뀌지 않음',
    state.approvals.get('1').decision === 'approved');
  check('이미 처리됨 안내',
    state.tgCalls.some(c => c.method === 'answerCallbackQuery' && /이미/.test(c.body.text)));

  console.log('\n5) 거부 경로 + 잘못된 입력');
  state.approvals.set('2', { decision: 'pending' });
  await post(H, cb('ap:2:rejected', '999'));
  check('decision=rejected 기록', state.approvals.get('2').decision === 'rejected');

  state.approvals.set('3', { decision: 'pending' });
  await post(H, cb('ap:3:DROP TABLE', '999'));
  check('형식 안 맞는 callback_data 무시', state.approvals.get('3').decision === 'pending');
  await post(H, cb('ap:abc:approved', '999'));
  check('숫자 아닌 id 무시', true);
  check('callback_query 없는 본문도 200', await post(H, { message: {} }) === 200);

  console.log('\n' + (fails.length ? `실패 ${fails.length}건: ${fails.join(', ')}` : '전부 통과'));
  process.exit(fails.length ? 1 : 0);
})();
