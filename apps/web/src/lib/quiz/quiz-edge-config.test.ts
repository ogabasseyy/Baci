import { afterEach, describe, expect, it } from 'vitest';
import { getQuizEdgeWorkerUrl, getQuizTicketSecret } from './quiz-edge-config';

describe('quiz-edge-config', () => {
  const originalUrl = process.env.QUIZ_EDGE_WORKER_URL;
  const originalSecret = process.env.QUIZ_TICKET_SECRET;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.QUIZ_EDGE_WORKER_URL;
    } else {
      process.env.QUIZ_EDGE_WORKER_URL = originalUrl;
    }
    if (originalSecret === undefined) {
      delete process.env.QUIZ_TICKET_SECRET;
    } else {
      process.env.QUIZ_TICKET_SECRET = originalSecret;
    }
  });

  it('returns undefined for unset, blank, or non-https remote URLs', () => {
    delete process.env.QUIZ_EDGE_WORKER_URL;
    expect(getQuizEdgeWorkerUrl()).toBeUndefined();

    process.env.QUIZ_EDGE_WORKER_URL = '   ';
    expect(getQuizEdgeWorkerUrl()).toBeUndefined();

    process.env.QUIZ_EDGE_WORKER_URL = 'http://quiz.example.com';
    expect(getQuizEdgeWorkerUrl()).toBeUndefined();

    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz.example.com?stage=2';
    expect(getQuizEdgeWorkerUrl()).toBeUndefined();

    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz.example.com#frag';
    expect(getQuizEdgeWorkerUrl()).toBeUndefined();
  });

  it('accepts https URLs and http localhost URLs, stripping trailing slash', () => {
    process.env.QUIZ_EDGE_WORKER_URL = 'https://quiz.example.com/';
    expect(getQuizEdgeWorkerUrl()).toBe('https://quiz.example.com');

    process.env.QUIZ_EDGE_WORKER_URL = 'http://localhost:8787/';
    expect(getQuizEdgeWorkerUrl()).toBe('http://localhost:8787');
  });

  it('trims QUIZ_TICKET_SECRET and returns undefined when blank', () => {
    process.env.QUIZ_TICKET_SECRET = '  ';
    expect(getQuizTicketSecret()).toBeUndefined();

    process.env.QUIZ_TICKET_SECRET = ' secret-val ';
    expect(getQuizTicketSecret()).toBe('secret-val');
  });
});
