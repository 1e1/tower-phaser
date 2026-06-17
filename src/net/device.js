// Best-effort device classification for the landing page:
//   'tv'      -> host the match automatically (it is a display)
//   'phone'   -> always a player; go straight to the join form
//   'desktop' -> PC or tablet; keep the host / join choice
//
// Detection is heuristic (user-agent + capabilities) with explicit overrides for
// reliability and for forcing a device into a role during testing. Each override
// is accepted as a query flag (?tv), a role value (?role=tv) OR a bare hash
// (#tv) — the hash form is the no-'?' variant, served from / with no routing.
//   TV    : ?tv  | ?role=tv  | ?host  | #tv
//   pad   : ?pad | ?role=pad | ?role=player | ?code=… | #pad
//   local : ?local | ?role=local | #local   (two players on one screen, no server)

const TV_UA = /SmartTV|Smart-TV|SMART-TV|Tizen|Web0S|WebOS|webOS|NetCast|BRAVIA|HbbTV|HBBTV|Viera|AppleTV|GoogleTV|CrKey|Chromecast|AFT[A-Z]|DLNADOC|\bTV\b/i;
const PHONE_UA = /iPhone|iPod|Windows Phone|Android.*Mobile|Mobile.*Firefox|BlackBerry/i;

export function detectRole() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role');
  const hash = window.location.hash.replace(/^#/, '');
  // A token may arrive as ?token, ?role=token, or #token.
  const has = (k) => params.has(k) || role === k || hash === k;
  if (has('local')) return 'local';
  if (has('tv') || has('host')) return 'tv';
  if (has('pad') || has('player') || params.has('code')) return 'phone';

  const ua = navigator.userAgent || '';
  if (TV_UA.test(ua)) return 'tv';
  if (PHONE_UA.test(ua)) return 'phone';

  // Touch device with a small screen behaves like a phone; larger touch
  // devices (tablets) fall through to the desktop choice.
  const minDim = Math.min(window.screen?.width || 9999, window.screen?.height || 9999);
  const touch = (navigator.maxTouchPoints || 0) > 0 || window.matchMedia('(pointer: coarse)').matches;
  if (touch && minDim < 500) return 'phone';

  return 'desktop';
}
