import Phaser from 'phaser';

// Build stamp baked in by Vite (see vite.config.js). Shown discreetly so you can
// confirm a device is actually running the latest deploy (and not a stale PWA).
// eslint-disable-next-line no-undef
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

// Entry screen for the connected (remote) experience. One device hosts as the
// TV/spectator; phones and tablets join as player controllers with a room code.
// Rendered as a full-viewport responsive HTML overlay (not inside the scaled
// game canvas) so it lays out correctly on phones as well as large screens.
export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super('Lobby');
  }

  init(data) {
    this.auto = data?.auto || null; // 'host' (TV) | 'join' (phone) | null (choice)
  }

  create() {
    this.client = this.registry.get('client');
    this.unsubs = [];

    const overlay = document.createElement('div');
    overlay.className = 'tp-overlay';
    overlay.innerHTML = `
      <div class="tp-card">
        <img class="tp-logo" src="icon.svg" alt="" />
        <h1>TOWER DUEL</h1>
        <div id="choice">
          <button class="big" id="host">Host on this screen<span>TV / spectator</span></button>
          <button class="big" id="joinBtn">Join as player<span>phone / tablet</span></button>
        </div>
        <div id="joinForm" hidden>
          <input id="code" maxlength="4" placeholder="ROOM CODE" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" />
          <input id="name" maxlength="14" placeholder="Your name" autocomplete="off" />
          <button class="big" id="connect">Connect</button>
          <button class="link" id="back">Back</button>
          <p id="err"></p>
        </div>
      </div>
      <p class="tp-build">build ${BUILD_ID}</p>`;
    this.overlay = overlay;
    document.body.appendChild(overlay);
    injectStyles();

    const $ = (id) => overlay.querySelector(`#${id}`);
    const sfx = this.registry.get('sfx');

    $('host').addEventListener('click', () => {
      sfx.blip(740);
      this.client.send('host');
    });
    // Autofocus the room code: it is the one thing that must be typed, and a
    // soft keyboard popping straight onto it removes a tap. Guarded behind a
    // microtask so the field is unhidden first (focus on a hidden input no-ops).
    const focusCode = () => { const el = $('code'); requestAnimationFrame(() => { el.focus(); el.select?.(); }); };

    $('joinBtn').addEventListener('click', () => {
      sfx.blip(620);
      $('choice').hidden = true;
      $('joinForm').hidden = false;
      focusCode();
    });
    $('back').addEventListener('click', () => {
      $('joinForm').hidden = true;
      $('choice').hidden = false;
    });
    // Pre-fill the name with whatever this device used last time, else a fun
    // handle (never a real first name) — still editable.
    $('name').value = loadName() || randomHandle();

    const submit = () => {
      const code = $('code').value.trim().toUpperCase();
      const name = $('name').value.trim();
      if (code.length < 4) {
        $('err').textContent = 'Enter the 4-character room code';
        focusCode();
        return;
      }
      saveName(name);
      this.pendingName = name;
      // Always give feedback: if the socket isn't up yet the join is queued and
      // flushed on connect, so tell the player it's working instead of leaving
      // the button looking dead ("Connect does nothing"). 'joined'/'error' from
      // the server replaces this line.
      $('err').style.color = '#9fb0c8';
      $('err').textContent = this.client.connected ? 'Joining…' : 'Connecting to the server…';
      this.client.send('join', { code, name });
    };
    $('connect').addEventListener('click', submit);

    // Enter is the natural "go" on a phone keyboard. With both fields filled
    // (the name is pre-filled / autocompleted) it connects; with a field still
    // empty it behaves like Tab — jump to the first empty field — instead of
    // firing a doomed connect.
    const onEnter = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = $('code').value.trim();
      const name = $('name').value.trim();
      if (code.length >= 4 && name) submit();
      else if (code.length < 4) focusCode();
      else $('name').focus();
    };
    $('code').addEventListener('keydown', onEnter);
    $('name').addEventListener('keydown', onEnter);

    const codeParam = new URLSearchParams(window.location.search).get('code');
    const showJoin = () => {
      $('choice').hidden = true;
      $('joinForm').hidden = false;
      if (codeParam) $('code').value = codeParam.toUpperCase();
      focusCode();
    };

    if (this.auto === 'host') {
      // TV: host immediately, no choice screen.
      $('choice').hidden = true;
      this.client.send('host');
    } else if (this.auto === 'join' || codeParam) {
      // Phone, or a scanned QR link: go straight to the player join form and
      // hide the host option (no "Back" to a choice that does not exist).
      showJoin();
      $('back').hidden = true;
    }

    this.track(
      this.client.on('hosted', (m) =>
        this.scene.start('Tv', { code: m.code, token: m.token, lanIp: m.lanIp, publicHost: m.publicHost }),
      ),
    );
    this.track(
      this.client.on('joined', (m) => {
        if (m.role === 'spectator') {
          this.scene.start('Tv', { spectator: true, code: m.code, queue: m.queue });
        } else {
          this.scene.start('Controller', {
            player: m.slot,
            code: m.code,
            name: this.pendingName,
            token: m.token,
            isConfigOwner: !!m.isConfigOwner,
          });
        }
      }),
    );
    this.track(
      this.client.on('error', (m) => {
        $('err').style.color = ''; // back to the error red (CSS default)
        $('err').textContent = m.msg || 'Connection error';
        // A failed join (wrong/expired code) wipes the code and puts the cursor
        // back on it, ready for another try without manual clearing.
        $('code').value = '';
        focusCode();
      }),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((off) => off());
      overlay.remove();
    });
  }

  track(off) {
    this.unsubs.push(off);
  }
}

// Fun, anonymous default handles — never a real first name. Used as the editable
// default on the join form and as a fallback elsewhere.
const HANDLES = [
  'Lazy Cat', 'Panda Frileux', 'Grumpy Fox', 'Sleepy Otter', 'Chat Paresseux',
  'Renard Malin', 'Hibou Ronchon', 'Tortue Pressée', 'Crabe Costaud', 'Loutre Zen',
  'Koala Grognon', 'Pingouin Punk', 'Castor Malin', 'Yéti Frileux', 'Morse Cool',
];

export function randomHandle() {
  return HANDLES[Math.floor(Math.random() * HANDLES.length)];
}

// The player's name persists on the device between sessions: pre-filled on the
// join form and on the controller, always editable. localStorage may throw in
// private-mode browsers, so every access is guarded.
const NAME_KEY = 'towerduel.name';

export function loadName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function saveName(name) {
  try {
    const v = (name || '').trim();
    if (v) localStorage.setItem(NAME_KEY, v);
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

// Shared styles for the overlay-based screens (lobby and controller).
export function injectStyles() {
  if (document.getElementById('tp-styles')) return;
  const style = document.createElement('style');
  style.id = 'tp-styles';
  style.textContent = `
    /* Neutral, camp-agnostic connection screen: a slate night backdrop (no camp
       blue). The "two camps" are evoked only as a BALANCED accent — a blue left
       edge and a red right edge in equal measure — so neither side is favoured. */
    .tp-overlay{position:fixed;inset:0;z-index:10;display:flex;align-items:center;
      justify-content:center;padding:env(safe-area-inset-top) 20px;
      font-family:'Trebuchet MS','Segoe UI',system-ui,sans-serif;color:#fff;
      background:radial-gradient(circle at 50% 0%,#232a3a,#0b1020);box-sizing:border-box;}
    .tp-card{width:100%;max-width:440px;text-align:center;}
    .tp-logo{width:clamp(72px,18vw,108px);height:auto;display:block;margin:0 auto 14px;
      filter:drop-shadow(0 10px 26px rgba(0,0,0,.45));}
    .tp-card h1{font-size:clamp(36px,9vw,64px);margin:0 0 6vh;letter-spacing:2px;}
    .tp-overlay .big{display:flex;flex-direction:column;align-items:center;width:100%;
      margin:14px 0;padding:clamp(18px,3.4vh,26px);font-size:clamp(20px,5.4vw,28px);
      font-weight:bold;border:none;border-left:5px solid #4f8fff;border-right:5px solid #ff6b5e;
      border-radius:14px;background:#3a4660;color:#fff;cursor:pointer;}
    .tp-overlay .big span{font-size:.6em;opacity:.8;font-weight:normal;margin-top:4px;}
    .tp-overlay .big:active{background:#46557a;}
    .tp-overlay input{display:block;width:100%;box-sizing:border-box;margin:12px 0;
      padding:clamp(14px,2.6vh,20px);font-size:clamp(20px,5.4vw,28px);border-radius:12px;
      border:2px solid #5a6680;background:#0e1730;color:#fff;text-align:center;}
    .tp-overlay input:focus{outline:none;border-color:#8b97ad;}
    #code{text-transform:uppercase;letter-spacing:6px;}
    .tp-overlay .link{background:none;border:none;color:#9fb0c8;font-size:18px;
      cursor:pointer;margin-top:8px;}
    .tp-overlay #err{color:#ff8a7a;min-height:26px;margin:10px 0 0;}
    .tp-build{position:fixed;left:0;right:0;bottom:6px;text-align:center;margin:0;
      font-size:11px;letter-spacing:1px;color:#ffffff30;pointer-events:none;}
    /* Connect: the "stone tablet" treatment — softly chamfered, chunky 3D bevel
       and a hard base edge it presses into (not a flat rounded rectangle). */
    /* Connect: neutral stone tablet with balanced blue-left / red-right inner
       edges (inset shadows follow the chamfer; real borders would be clipped). */
    #connect{position:relative;border-radius:12px;
      -webkit-clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%,0 10px);
      clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%,0 10px);
      background:linear-gradient(180deg,rgba(255,255,255,.24),rgba(0,0,0,.24)),#4b5366;
      box-shadow:inset 5px 0 0 #4f8fff,inset -5px 0 0 #ff6b5e,inset 0 3px 0 rgba(255,255,255,.45),inset 0 -4px 10px rgba(0,0,0,.4),0 6px 0 rgba(0,0,0,.35),0 12px 22px -10px #000;
      transition:transform .08s ease,filter .2s ease;}
    #connect:active{transform:translateY(4px);filter:brightness(1.06);
      box-shadow:inset 5px 0 0 #4f8fff,inset -5px 0 0 #ff6b5e,inset 0 3px 0 rgba(255,255,255,.45),inset 0 -4px 10px rgba(0,0,0,.4),0 2px 0 rgba(0,0,0,.35);}
  `;
  document.head.appendChild(style);
}
