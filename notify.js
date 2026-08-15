/**
 * notify.js — 사용자에게 도달하는 유일한 알림 경로.
 *
 * 이전에는 알림이 "선언만" 돼 있었다:
 *   - agent_orchestrator.py:237 은 문자열만 만들고 전송하지 않았다
 *   - server.js:977 은 향후 확장 주석이었다
 *   - ag_communicator 의 tools:["telegram"] 은 선언뿐이었다
 * 그래서 /api/approvals 에 승인 요청이 쌓여도 사용자는 알 수 없었다.
 *
 * 텔레그램 로직은 이 파일에만 둔다. Python(scheduler) 은 직접 구현하지 말고
 * 서버 API 를 호출할 것 — 두 언어에 같은 로직이 갈라지면 반드시 어긋난다.
 *
 * 환경 변수:
 *   WF_TELEGRAM_TOKEN    봇 토큰 (기존 Hermes 봇 토큰 공유 가능)
 *   WF_TELEGRAM_CHAT_ID  수신 채팅 id
 * 둘 중 하나라도 없으면 전송을 건너뛰고 경고만 남긴다 (서버는 계속 동작).
 */

const TOKEN = () => process.env.WF_TELEGRAM_TOKEN || '';
const CHAT_ID = () => process.env.WF_TELEGRAM_CHAT_ID || '';

function enabled() {
  return Boolean(TOKEN() && CHAT_ID());
}

/** 텔레그램 MarkdownV2 예약문자 이스케이프 */
function esc(s) {
  return String(s == null ? '' : s).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * 메시지 전송. 실패해도 예외를 던지지 않는다 —
 * 알림 실패가 본래 작업을 막으면 안 된다.
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function send(text, opts = {}) {
  if (!enabled()) {
    console.warn('[notify] WF_TELEGRAM_TOKEN/CHAT_ID 미설정 — 전송 건너뜀');
    return { sent: false, reason: 'not_configured' };
  }
  const body = {
    chat_id: CHAT_ID(),
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
  };
  if (opts.buttons) body.reply_markup = { inline_keyboard: opts.buttons };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn('[notify] 전송 실패', r.status, t.slice(0, 200));
      return { sent: false, reason: `http_${r.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.warn('[notify] 전송 오류:', e.message);
    return { sent: false, reason: e.message };
  }
}

/** 승인 요청 — 인라인 버튼으로 승인/거부를 한 번에 받는다 */
async function approvalRequest({ id, action, detail, requester, wf_id }) {
  const text =
    `🔐 *승인 요청*\n\n` +
    `*작업* ${esc(action)}\n` +
    `*요청* ${esc(requester || '-')}\n` +
    (wf_id ? `*대상* ${esc(wf_id)}\n` : '') +
    (detail ? `\n${esc(String(detail).slice(0, 600))}\n` : '') +
    `\n승인 id: \`${esc(id)}\``;
  return send(text, {
    buttons: [[
      { text: '✅ 승인', callback_data: `ap:${id}:approved` },
      { text: '❌ 거부', callback_data: `ap:${id}:rejected` },
    ]],
  });
}

/** 작업 완료/실패 보고 */
async function report({ agent, action, status, detail }) {
  const icon = status === 'failed' ? '❌' : '✅';
  const text =
    `${icon} *${esc(status === 'failed' ? '실패' : '완료')}*\n\n` +
    `*에이전트* ${esc(agent || '-')}\n` +
    `*작업* ${esc(action || '-')}\n` +
    (detail ? `\n${esc(String(detail).slice(0, 600))}` : '');
  return send(text);
}

/** 텔레그램 API 호출 공통부 */
async function tg(method, body) {
  if (!TOKEN()) return { ok: false, reason: 'not_configured' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn(`[notify] ${method} 실패`, r.status, t.slice(0, 200));
      return { ok: false, reason: `http_${r.status}` };
    }
    return { ok: true, result: (await r.json().catch(() => ({}))).result };
  } catch (e) {
    console.warn(`[notify] ${method} 오류:`, e.message);
    return { ok: false, reason: e.message };
  }
}

/**
 * 버튼 눌림에 응답한다. 이걸 보내지 않으면 사용자 화면에서 버튼이 계속 로딩 상태로 남는다.
 * 텔레그램은 약 10초 안의 응답을 기대한다.
 */
function answerCallback(callbackQueryId, text, alert = false) {
  return tg('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text || '',
    show_alert: Boolean(alert),
  });
}

/**
 * 결정이 끝난 메시지를 갱신하고 버튼을 없앤다.
 * 버튼이 남아 있으면 같은 건을 다시 누를 수 있어 혼란스럽다.
 */
function resolveMessage(chatId, messageId, originalText, verdict, who) {
  const mark = verdict === 'approved' ? '✅ 승인됨' : '❌ 거부됨';
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `${originalText}\n\n━━━━━━\n${esc(mark)}${who ? ` · ${esc(who)}` : ''}`,
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: [] },
  });
}

/**
 * 웹훅 등록. 텔레그램이 보내는 요청임을 확인할 secret_token 을 함께 심는다.
 * 이 토큰이 없으면 웹훅 URL 을 아는 누구나 승인을 위조할 수 있다.
 */
function setWebhook(url, secret) {
  return tg('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['callback_query'],
    drop_pending_updates: true,
  });
}

module.exports = {
  send, approvalRequest, report, enabled, esc,
  tg, answerCallback, resolveMessage, setWebhook,
};
