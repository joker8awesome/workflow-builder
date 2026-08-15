#!/usr/bin/env node
/**
 * setup-telegram-webhook.js — 승인 버튼이 동작하도록 웹훅을 등록한다.
 *
 * 버튼을 눌렀을 때 텔레그램이 우리 서버로 callback_query 를 보내게 만드는 작업이다.
 * 이걸 하지 않으면 알림에 버튼은 보이지만 눌러도 아무 일이 일어나지 않는다.
 *
 * 사용법 (VPS 에서):
 *   node ops/setup-telegram-webhook.js            # 현재 상태 조회만
 *   node ops/setup-telegram-webhook.js --apply    # 등록
 *   node ops/setup-telegram-webhook.js --delete   # 해제
 *
 * 필요한 환경 변수:
 *   WF_TELEGRAM_TOKEN            봇 토큰
 *   WF_TELEGRAM_WEBHOOK_SECRET   위조 방지용 비밀값 (없으면 서버가 웹훅을 전부 거부한다)
 *   WF_PUBLIC_URL                공개 https 주소 (기본 https://187.127.124.16.sslip.io)
 */
const path = require('path');
const notify = require(path.join(__dirname, '..', 'notify'));

const PUBLIC_URL = (process.env.WF_PUBLIC_URL || 'https://187.127.124.16.sslip.io').replace(/\/+$/, '');
const SECRET = process.env.WF_TELEGRAM_WEBHOOK_SECRET || '';
const HOOK_URL = `${PUBLIC_URL}/api/telegram/webhook`;

async function main() {
  if (!process.env.WF_TELEGRAM_TOKEN) {
    console.error('❌ WF_TELEGRAM_TOKEN 이 필요하다.');
    process.exit(1);
  }

  if (process.argv.includes('--delete')) {
    const r = await notify.tg('deleteWebhook', { drop_pending_updates: true });
    console.log(r.ok ? '✅ 웹훅 해제됨' : `❌ 실패: ${r.reason}`);
    return;
  }

  if (process.argv.includes('--apply')) {
    if (!SECRET) {
      console.error('❌ WF_TELEGRAM_WEBHOOK_SECRET 이 필요하다.');
      console.error('   이 값이 없으면 서버가 모든 웹훅을 거부하므로 버튼이 동작하지 않는다.');
      console.error('   생성: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"');
      process.exit(1);
    }
    if (!HOOK_URL.startsWith('https://')) {
      console.error('❌ 텔레그램은 https 주소만 받는다:', HOOK_URL);
      process.exit(1);
    }
    const r = await notify.setWebhook(HOOK_URL, SECRET);
    if (!r.ok) { console.error('❌ 등록 실패:', r.reason); process.exit(1); }
    console.log('✅ 웹훅 등록됨:', HOOK_URL);
  }

  // 조회 — 등록 여부와 마지막 오류를 확인한다
  const info = await notify.tg('getWebhookInfo', {});
  if (!info.ok) { console.error('❌ 조회 실패:', info.reason); process.exit(1); }
  const w = info.result || {};
  console.log('\n현재 웹훅 상태');
  console.log('  url                  :', w.url || '(미등록)');
  console.log('  secret 설정됨        :', w.has_custom_certificate !== undefined ? (SECRET ? 'yes(로컬 env 기준)' : 'no') : '-');
  console.log('  대기 중 업데이트     :', w.pending_update_count ?? '-');
  console.log('  허용 업데이트        :', (w.allowed_updates || []).join(', ') || '(전체)');
  if (w.last_error_message) {
    console.log('  ⚠ 마지막 오류        :', w.last_error_message);
    console.log('    (인증서·방화벽·경로를 확인할 것)');
  }
  if (w.url && w.url !== HOOK_URL) {
    console.log(`\n  ⚠ 등록된 주소가 기대값과 다르다.\n    기대: ${HOOK_URL}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
