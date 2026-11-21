import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

const k6Env = globalThis.__ENV ?? {};
const BASE_URL = (k6Env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const ROUND = Number.parseInt(k6Env.ROUND || '2', 10);
const EVENT_ID = k6Env.EVENT_ID || `demo-round-${ROUND}`;

const answerAckMs = new Trend('quiz_answer_ack_ms', true);
const answerFailureRate = new Rate('quiz_answer_failure_rate');
const retriesSent = new Counter('quiz_retries_sent');

const CARRIERS = ['MTN', 'Airtel', 'Glo', '9mobile'];

function buildOptions() {
  if (ROUND === 1) {
    // Round 1: 10 human testers only; run a lightweight readiness probe.
    return {
      scenarios: {
        round1_probe: {
          executor: 'shared-iterations',
          vus: 1,
          iterations: 1,
          maxDuration: '30s',
        },
      },
    };
  }
  if (ROUND === 2) {
    // Round 2: 490 open-loop k6 bots share room-0000 with 10 human testers (500 total).
    return {
      scenarios: {
        round2_single_room_500: {
          executor: 'constant-arrival-rate',
          rate: 25,
          timeUnit: '1s',
          duration: '20s',
          preAllocatedVUs: 250,
          maxVUs: 490,
        },
      },
      thresholds: {
        quiz_answer_ack_ms: ['p(99)<1000'],
        quiz_answer_failure_rate: ['rate<0.005'],
      },
    };
  }
  // Round 3: 4,990 open-loop k6 bots across 13 rooms (~5,000 total w/ 10 humans) + chaos retries.
  return {
    scenarios: {
      round3_multi_room_5k_chaos: {
        executor: 'constant-arrival-rate',
        rate: 166,
        timeUnit: '1s',
        duration: '30s',
        preAllocatedVUs: 1200,
        maxVUs: 3000,
      },
    },
    thresholds: {
      quiz_answer_ack_ms: ['p(99)<1000'],
      quiz_answer_failure_rate: ['rate<0.01'],
    },
  };
}

export const options = buildOptions();

function pickRoomId(iterIndex) {
  if (ROUND === 2) return 'room-0000';
  const shard = iterIndex % 13;
  return `room-${String(shard).padStart(4, '0')}`;
}

export default function runPlayerFlow() {
  if (ROUND === 1) {
    const res = http.get(`${BASE_URL}/demo/report?format=json`);
    check(res, { 'round 1 report ok': (r) => r.status === 200 });
    return;
  }

  const playerSeq = (globalThis.__VU ?? 1) * 100_000 + (globalThis.__ITER ?? 0);
  const carrier = k6Env.CARRIER_TAG || CARRIERS[playerSeq % CARRIERS.length];
  const roomId = pickRoomId(playerSeq);

  const checkInRes = http.post(
    `${BASE_URL}/api/demo/check-in`,
    JSON.stringify({
      eventId: EVENT_ID,
      nickname: `bot_${playerSeq}`,
      carrier,
      roomId,
      inviteCode: k6Env.DEMO_INVITE_CODE || '',
      isBot: true,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (
    !check(checkInRes, {
      'check-in 200': (r) => r.status === 200,
    })
  ) {
    answerFailureRate.add(1);
    return;
  }

  const checkIn = checkInRes.json();
  const ticket = checkIn.ticket;
  const activeEventId = checkIn.eventId || EVENT_ID;
  const startRequestId = `00000000-0000-4000-8000-${String(
    Math.abs(Math.floor(playerSeq))
  )
    .padStart(12, '0')
    .slice(-12)}`;
  const startRes = http.post(
    `${BASE_URL}/api/quiz/events/${encodeURIComponent(activeEventId)}/start`,
    JSON.stringify({
      integrityTier: 'device',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId,
      appVersion: '2.10.0',
      platform: 'android',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Baci-Quiz-Ticket': ticket,
      },
    }
  );
  if (!check(startRes, { 'start 200': (r) => r.status === 200 })) {
    answerFailureRate.add(1);
    return;
  }

  let attempt = startRes.json();
  let question = attempt.question;

  while (question) {
    const thinkSec = 2 + (playerSeq % 4) * 0.8;
    sleep(thinkSec);

    const choice = question.options?.[0]?.id || 'opt-a';
    const ansUrl = `${BASE_URL}/api/quiz/attempts/${encodeURIComponent(attempt.attemptId)}/answers`;
    const payload = JSON.stringify({
      questionId: question.id,
      answer: choice,
    });
    const headers = {
      'Content-Type': 'application/json',
      'X-Baci-Quiz-Ticket': ticket,
    };

    const t0 = Date.now();
    let ansRes = http.post(ansUrl, payload, { headers });
    let ackMs = Date.now() - t0;

    // Round 3 chaos: simulate 1.5% client duplicate retries on response uncertainty.
    if (ROUND === 3 && (playerSeq + question.index) % 67 === 0) {
      retriesSent.add(1);
      ansRes = http.post(ansUrl, payload, { headers });
      ackMs = Date.now() - t0;
    }

    answerAckMs.add(ackMs);
    const ok = check(ansRes, { 'answer 200': (r) => r.status === 200 });
    answerFailureRate.add(ok ? 0 : 1);
    if (!ok) break;

    http.post(
      `${BASE_URL}/api/demo/telemetry`,
      JSON.stringify({
        eventId: activeEventId,
        attemptId: attempt.attemptId,
        questionIndex: question.index,
        carrier,
        tapToAckMs: Math.max(1, ackMs),
        retries: ROUND === 3 && (playerSeq + question.index) % 67 === 0 ? 1 : 0,
        timedOut: !ok,
        isBot: true,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Baci-Quiz-Ticket': ticket,
        },
      }
    );

    attempt = ansRes.json();
    question = attempt.question;
  }
}
