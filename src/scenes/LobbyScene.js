import Phaser from 'phaser';

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
          <input id="code" maxlength="4" placeholder="ROOM CODE" autocomplete="off" autocapitalize="characters" />
          <input id="name" maxlength="12" placeholder="Your name" autocomplete="off" />
          <button class="big" id="connect">Connect</button>
          <button class="link" id="back">Back</button>
          <p id="err"></p>
        </div>
      </div>`;
    this.overlay = overlay;
    document.body.appendChild(overlay);
    injectStyles();

    const $ = (id) => overlay.querySelector(`#${id}`);
    const sfx = this.registry.get('sfx');

    $('host').addEventListener('click', () => {
      sfx.blip(740);
      this.client.send('host');
    });
    $('joinBtn').addEventListener('click', () => {
      sfx.blip(620);
      $('choice').hidden = true;
      $('joinForm').hidden = false;
      $('code').focus();
    });
    $('back').addEventListener('click', () => {
      $('joinForm').hidden = true;
      $('choice').hidden = false;
    });
    $('connect').addEventListener('click', () => {
      const code = $('code').value.trim().toUpperCase();
      const name = $('name').value.trim();
      if (code.length < 4) {
        $('err').textContent = 'Enter the 4-character room code';
        return;
      }
      this.pendingName = name;
      this.client.send('join', { code, name });
    });

    const codeParam = new URLSearchParams(window.location.search).get('code');
    const showJoin = () => {
      $('choice').hidden = true;
      $('joinForm').hidden = false;
      if (codeParam) $('code').value = codeParam.toUpperCase();
      $('name').focus();
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
        this.scene.start('Tv', { code: m.code, lanIp: m.lanIp, publicHost: m.publicHost }),
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
            isBiomeChooser: m.slot === 0,
          });
        }
      }),
    );
    this.track(
      this.client.on('error', (m) => {
        $('err').textContent = m.msg || 'Connection error';
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

// Shared styles for the overlay-based screens (lobby and controller).
export function injectStyles() {
  if (document.getElementById('tp-styles')) return;
  const style = document.createElement('style');
  style.id = 'tp-styles';
  style.textContent = `
    .tp-overlay{position:fixed;inset:0;z-index:10;display:flex;align-items:center;
      justify-content:center;padding:env(safe-area-inset-top) 20px;
      font-family:'Trebuchet MS','Segoe UI',system-ui,sans-serif;color:#fff;
      background:radial-gradient(circle at 50% 0%,#1b2a4a,#0b1020);box-sizing:border-box;}
    .tp-card{width:100%;max-width:440px;text-align:center;}
    .tp-logo{width:clamp(72px,18vw,108px);height:auto;display:block;margin:0 auto 14px;
      filter:drop-shadow(0 10px 26px rgba(0,0,0,.45));}
    .tp-card h1{font-size:clamp(36px,9vw,64px);margin:0 0 6vh;letter-spacing:2px;}
    .tp-overlay .big{display:flex;flex-direction:column;align-items:center;width:100%;
      margin:14px 0;padding:clamp(18px,3.4vh,26px);font-size:clamp(20px,5.4vw,28px);
      font-weight:bold;border:none;border-radius:16px;background:#3a6df0;color:#fff;cursor:pointer;}
    .tp-overlay .big span{font-size:.6em;opacity:.8;font-weight:normal;margin-top:4px;}
    .tp-overlay .big:active{background:#4f8fff;}
    .tp-overlay input{display:block;width:100%;box-sizing:border-box;margin:12px 0;
      padding:clamp(14px,2.6vh,20px);font-size:clamp(20px,5.4vw,28px);border-radius:12px;
      border:2px solid #4f8fff;background:#0e1730;color:#fff;text-align:center;}
    #code{text-transform:uppercase;letter-spacing:6px;}
    .tp-overlay .link{background:none;border:none;color:#9fb0c8;font-size:18px;
      cursor:pointer;margin-top:8px;}
    .tp-overlay #err{color:#ff8a7a;min-height:26px;margin:10px 0 0;}
  `;
  document.head.appendChild(style);
}
