export interface CarrierReportRow {
  verifiedNetwork: string;
  carrier: string;
  selfReportedCarrier: string;
  mismatchedSelfReportCount: number;
  asns: readonly number[];
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  under1sRatePct: number;
  retries: number;
  timeouts: number;
  colos: readonly string[];
}

export interface DemoReportPayload {
  generatedAtIso: string;
  totalSamples: number;
  mismatchedSelfReportCount: number;
  carriers: readonly CarrierReportRow[];
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatVerifiedLabel(c: CarrierReportRow): string {
  if (c.asns.length === 0 || c.verifiedNetwork.includes('(AS')) {
    return c.verifiedNetwork;
  }
  return `${c.verifiedNetwork} (${c.asns.map((a) => `AS${a}`).join(', ')})`;
}

export function renderDemoReportHtml(report: DemoReportPayload): string {
  const rowsHtml =
    report.carriers.length === 0
      ? '<tr><td colspan="10">No telemetry samples recorded yet.</td></tr>'
      : report.carriers
          .map(
            (c) =>
              `<tr><td>${escapeHtml(formatVerifiedLabel(c))}</td><td>${escapeHtml(c.selfReportedCarrier)}</td><td>${c.mismatchedSelfReportCount}</td><td>${c.count}</td><td>${c.p50Ms.toFixed(1)}</td><td>${c.p95Ms.toFixed(1)}</td><td>${c.p99Ms.toFixed(1)}</td><td>${c.under1sRatePct.toFixed(1)}%</td><td>${c.retries} / ${c.timeouts}</td><td>${escapeHtml(c.colos.join(', '))}</td></tr>`
          )
          .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Baci Quiz Edge Carrier Report</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 16px; background: #0f172a; color: #f8fafc; }
  h1 { font-size: 1.25rem; margin-bottom: 4px; }
  p { color: #94a3b8; font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.85rem; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #334155; text-align: left; }
  th { color: #38bdf8; }
</style>
</head>
<body>
  <h1>Baci Quiz Edge — Verified ISP / Carrier Telemetry Report</h1>
  <p>Generated ${escapeHtml(report.generatedAtIso)} · Samples: ${report.totalSamples} · Mismatched self-reports: ${report.mismatchedSelfReportCount}</p>
  <table>
    <thead>
      <tr><th>Verified Network (ASN)</th><th>Self-Reported</th><th>Mismatches</th><th>Samples</th><th>p50 (ms)</th><th>p95 (ms)</th><th>p99 (ms)</th><th>&le;1s Rate</th><th>Retries / Timeouts</th><th>CF Colos</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
}

export function renderDemoPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<title>Baci Quiz — Nigerian Carrier Probe</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; background: #090d16; color: #f8fafc; }
  .card { max-width: 480px; margin: 0 auto; background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 18px; }
  h1 { font-size: 1.2rem; margin: 0 0 8px; }
  .muted { color: #9ca3af; font-size: 0.85rem; margin: 0 0 14px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
  button { font-size: 0.95rem; font-weight: 600; padding: 12px 10px; border-radius: 10px; border: 1px solid #374151; background: #1f2937; color: #f9fafb; cursor: pointer; }
  button.active { background: #2563eb; border-color: #60a5fa; }
  button.primary { width: 100%; background: #16a34a; border-color: #22c55e; margin-top: 8px; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button.opt { width: 100%; text-align: left; margin-bottom: 8px; }
  input { width: 100%; padding: 11px; border-radius: 10px; border: 1px solid #374151; background: #030712; color: #fff; font-size: 1rem; margin-bottom: 10px; }
  .stat { font-family: ui-monospace, monospace; font-size: 0.82rem; color: #34d399; margin-top: 8px; }
  .warn { color: #fbbf24; }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="card">
  <h1>Baci Quiz — Live Edge Probe</h1>
  <p class="muted" id="sub">Tap your active network and enter a nickname to join.</p>
  <div id="checkin-view">
    <div class="grid" id="carriers">
      <button type="button" data-c="MTN">MTN</button>
      <button type="button" data-c="Airtel">Airtel</button>
      <button type="button" data-c="Glo">Glo</button>
      <button type="button" data-c="9mobile">9mobile</button>
      <button type="button" data-c="Wi-Fi">Wi-Fi</button>
    </div>
    <input id="nick" maxlength="24" placeholder="Nickname (e.g. LagosRunner)" />
    <input id="invite-code" maxlength="64" placeholder="Invite code (or open link with ?code=...)" />
    <button type="button" class="primary" id="join-btn" disabled>Select Network to Check In</button>
  </div>
  <div id="lobby-view" class="hidden">
    <p id="lobby-msg">Waiting for round start...</p>
    <div class="stat" id="lobby-net"></div>
    <button type="button" class="primary hidden" id="start-btn">Start Quiz Now</button>
  </div>
  <div id="play-view" class="hidden">
    <div class="muted" id="q-meta"></div>
    <h2 id="q-prompt" style="font-size:1.05rem;margin:6px 0 12px;"></h2>
    <div id="q-options"></div>
    <div class="stat" id="ack-stat"></div>
  </div>
  <div id="result-view" class="hidden">
    <h2 id="res-title" style="font-size:1.1rem;">Submitted — Waiting for Close</h2>
    <div class="stat" id="res-body"></div>
  </div>
</div>
<script>
(() => {
  let carrier = null;
  let session = null;
  let attemptId = null;
  let currentQ = null;
  let lobbyTimer = null;
  const joinBtn = document.getElementById('join-btn');
  const inviteInput = document.getElementById('invite-code');
  const urlCode = (new URLSearchParams(location.search).get('code') || '').trim();
  if (urlCode) { inviteInput.value = urlCode; inviteInput.classList.add('hidden'); }

  document.querySelectorAll('#carriers button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#carriers button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      carrier = btn.dataset.c || null;
      joinBtn.disabled = !carrier;
      joinBtn.textContent = carrier ? 'Check In & Enter Lobby' : 'Select Network to Check In';
    });
  });

  const show = (id) => {
    ['checkin-view', 'lobby-view', 'play-view', 'result-view'].forEach((v) => {
      document.getElementById(v).classList.toggle('hidden', v !== id);
    });
  };

  async function apiJson(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  joinBtn.addEventListener('click', async () => {
    if (!carrier) return;
    const nickname = (document.getElementById('nick').value || '').trim() || ('Player-' + Math.floor(Math.random() * 9000 + 1000));
    const inviteCode = (inviteInput.value || '').trim();
    try {
      session = await apiJson('/api/demo/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier, nickname, inviteCode })
      });
      const netEl = document.getElementById('lobby-net');
      const netInfo = 'ISP / ASN / colo: ' + (session.verifiedNetwork || 'Unknown') + ' · AS' + (session.asn || 0) + ' · ' + (session.colo || 'LOCAL') + (session.country ? ' (' + session.country + ')' : '');
      netEl.className = session.networkMismatch ? 'stat warn' : 'stat';
      netEl.textContent = session.networkMismatch ? netInfo + ' — Warning: differs from tapped ' + carrier + ' (check Wi-Fi/VPN!)' : netInfo;
      show('lobby-view');
      tickLobby();
    } catch (e) {
      inviteInput.classList.remove('hidden');
      document.getElementById('sub').textContent = 'Check-in failed: ' + e.message;
    }
  });

  function tickLobby() {
    if (!session) return;
    const remMs = session.startsAtMs - Date.now();
    if (remMs <= 0) {
      document.getElementById('lobby-msg').textContent = 'Round ' + session.round + ' (' + session.roomId + ') is LIVE!';
      document.getElementById('start-btn').classList.remove('hidden');
      if (lobbyTimer) clearTimeout(lobbyTimer);
      return;
    }
    document.getElementById('lobby-msg').textContent = 'Round ' + session.round + ' starts in ' + Math.ceil(remMs / 1000) + 's (' + session.roomId + ')';
    lobbyTimer = setTimeout(tickLobby, 250);
  }

  document.getElementById('start-btn').addEventListener('click', async () => {
    try {
      const startRes = await apiJson('/api/quiz/events/' + encodeURIComponent(session.eventId) + '/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Baci-Quiz-Ticket': session.ticket },
        body: JSON.stringify({
          integrityTier: 'basic', acceptedRulesVersion: 'live-v1', termsAccepted: true,
          startRequestId: crypto.randomUUID(), appVersion: 'demo-web-1', platform: 'web'
        })
      });
      attemptId = startRes.attemptId;
      renderAttempt(startRes);
    } catch (e) {
      document.getElementById('lobby-msg').textContent = 'Start error: ' + e.message;
    }
  });

  function renderAttempt(state) {
    if (state.status !== 'in_progress' || !state.question) { show('result-view'); pollFinalResult(); return; }
    show('play-view');
    currentQ = state.question;
    document.getElementById('q-meta').textContent = 'Question ' + currentQ.index + ' / ' + currentQ.total;
    document.getElementById('q-prompt').textContent = currentQ.prompt;
    const box = document.getElementById('q-options');
    box.innerHTML = '';
    currentQ.options.forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'opt'; b.textContent = opt.label;
      b.addEventListener('click', () => submitAnswer(currentQ.id, currentQ.index, opt.id));
      box.appendChild(b);
    });
  }

  async function submitAnswer(questionId, questionIndex, answer) {
    const t0 = performance.now();
    let retries = 0;
    let resState = null;
    while (retries < 2) {
      try {
        resState = await apiJson('/api/quiz/attempts/' + encodeURIComponent(attemptId) + '/answers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Baci-Quiz-Ticket': session.ticket },
          body: JSON.stringify({ questionId, answer })
        });
        break;
      } catch { retries += 1; }
    }
    const tapToAckMs = Math.max(1, Math.round(performance.now() - t0));
    document.getElementById('ack-stat').textContent = 'Last ACK: ' + tapToAckMs + ' ms (' + (session.verifiedNetwork || carrier) + ', retries: ' + retries + ')';
    fetch('/api/demo/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Baci-Quiz-Ticket': session.ticket },
      body: JSON.stringify({
        eventId: session.eventId, round: session.round, carrier, nickname: session.nickname,
        attemptId, questionIndex, tapToAckMs, retries, timedOut: !resState
      })
    }).catch(() => {});
    if (resState) renderAttempt(resState);
  }

  async function pollFinalResult() {
    try {
      if (session.soloInstantResult || Date.now() >= session.endsAtMs) {
        await fetch('/api/demo/reconcile', { method: 'POST' });
      }
      const res = await apiJson('/api/quiz/attempts/' + encodeURIComponent(attemptId) + '/result', {
        headers: { Authorization: 'Bearer ' + session.bearerToken }
      });
      if (res.availability === 'final') {
        document.getElementById('res-title').textContent = 'Final Rank #' + res.rank + ' (Score ' + res.score + '/' + res.totalQuestions + ')';
        let boardText = 'Published';
        try {
          const lb = await apiJson('/api/quiz/leaderboard?eventId=' + encodeURIComponent(session.eventId), {
            headers: { Authorization: 'Bearer ' + session.bearerToken }
          });
          const top = (lb.entries || []).slice(0, 5).map((e) => '#' + e.rank + ' ' + e.displayName + ' (' + e.score + ')').join(' | ');
          boardText = 'Participants: ' + (lb.participantCount ?? '-') + (top ? ' · Top: ' + top : '');
        } catch {}
        document.getElementById('res-body').textContent = boardText;
        return;
      }
      const live = await apiJson('/api/quiz/leaderboard/live?eventId=' + encodeURIComponent(session.eventId), {
        headers: { Authorization: 'Bearer ' + session.bearerToken }
      });
      document.getElementById('res-body').textContent = 'Live participants: ' + (live.participantCount ?? 0) + ' · Waiting for final reconciliation...';
    } catch {}
    setTimeout(pollFinalResult, 2000);
  }
})();
</script>
</body>
</html>`;
}
