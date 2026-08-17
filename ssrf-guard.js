/**
 * ssrf-guard.js — 웹 리서치 워커의 SSRF 방어 (지시서 #46).
 *
 * LLM 이 시키는 대로 서버가 URL 을 가져오는 구조에서는, 사설망·클라우드 메타데이터
 * 엔드포인트(169.254.169.254 등)를 못 때리게 막아야 내부 자원이 새지 않는다.
 *
 * 순수 판정(IP/호스트 분류)은 네트워크 없이 테스트 가능하고,
 * DNS 해석 검증은 validateWebUrl 에서만 수행한다.
 */
const dns = require('dns').promises;

// --- IPv4 분류 ---
function isPrivateIPv4(a, b, c, d) {
  if (a === 0) return true;                         // 0.0.0.0/8
  if (a === 10) return true;                        // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true;                       // 127.0.0.0/8 루프백
  if (a === 169 && b === 254) return true;          // 169.254.0.0/16 링크로컬 (169.254.169.254 포함)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 벤치마크
  return false;
}

// --- IPv6 분류 ---
function isPrivateIPv6(ip) {
  const h = ip.toLowerCase();
  if (h === '::' || h === '::1') return true;       // 미지정 / 루프백
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 유니크로컬
  if (/^fe[89ab]/.test(h)) return true;             // fe80::/10 링크로컬
  if (h.startsWith('::ffff:')) {                    // IPv4-매핑 IPv6 (::ffff:a.b.c.d)
    const m = h.slice(7).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) return isPrivateIPv4(+m[1], +m[2], +m[3], +m[4]);
  }
  return false;
}

// --- IP 문자열 분류 (IPv4/IPv6 자동 판별) ---
function isPrivateIP(ip) {
  if (typeof ip !== 'string' || !ip) return false;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return isPrivateIPv4(+v4[1], +v4[2], +v4[3], +v4[4]);
  if (ip.includes(':')) return isPrivateIPv6(ip);
  return false;
}

// --- 호스트명 리터럴 분류 ---
function isInternalHostname(hostname) {
  const h = String(hostname || '').toLowerCase().trim();
  if (!h) return true;                              // 빈 호스트는 거부
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  return isPrivateIP(h);                            // IP 리터럴이면 분류 (호스트명은 DNS 단계에서)
}

/**
 * URL 을 SSRF 관점에서 검증한다.
 * 성공 시 { ok:true, url }(정규화된 URL), 실패 시 { error }.
 */
async function validateWebUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch (e) { return { error: 'URL 형식 오류' }; }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { error: 'http/https 스킴만 허용 (SSRF 방지)' };
  }

  let host = u.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1); // IPv6 리터럴 대괄호 제거

  if (host === '169.254.169.254') return { error: '클라우드 메타데이터 차단 (SSRF 방지)' };
  if (isInternalHostname(host)) return { error: '내부 호스트 차단 (SSRF 방지): ' + host };

  // IP 리터럴이면 DNS 해석 불필요. 호스트명이면 사설 IP 로 돌리는 DNS 리바인딩을 막는다.
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (!isIpLiteral) {
    let addrs;
    try { addrs = await dns.lookup(host, { all: true }); }
    catch (e) { return { error: 'DNS 해석 실패: ' + host }; }
    for (const a of addrs) {
      if (isPrivateIP(a.address)) {
        return { error: 'DNS 가 사설 IP 로 해석 (SSRF 방지): ' + host + ' → ' + a.address };
      }
    }
  }

  return { ok: true, url: u.toString() };
}

module.exports = { isPrivateIPv4, isPrivateIPv6, isPrivateIP, isInternalHostname, validateWebUrl };
