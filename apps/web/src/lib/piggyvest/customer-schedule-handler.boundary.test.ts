import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { customerScheduleHandlerFixture as fixture } from './customer-schedule-handler.test-support';

vi.mock('server-only', () => ({}));

it.each([
  '?goalId=invalid',
  '?goalId=invalid&goalId=invalid',
  '?goalId=invalid&actorId=invalid',
])('rejects malformed or duplicate GET %s', async (query) => {
  const test = fixture();
  expect(
    (await test.handler.GET(test.request('GET', null, query))).status
  ).toBe(400);
  expect(test.execute).not.toHaveBeenCalled();
});

it('rejects oversized, wrongly encoded and query-bearing POST before SQL', async () => {
  const test = fixture();
  const invalidHeaders: Record<string, string>[] = [
    { 'content-type': 'text/plain' },
    { 'content-type': 'application/json', 'content-length': '100000' },
    { 'content-type': 'application/json', 'content-encoding': 'gzip' },
  ];
  for (const headers of invalidHeaders) {
    const request = new NextRequest('http://127.0.0.1:4179/schedule', {
      method: 'POST',
      headers,
      body: JSON.stringify(test.body),
    });
    expect((await test.handler.POST(request)).status).toBe(400);
  }
  expect(
    (
      await test.handler.POST(
        test.request('POST', test.body, `?goalId=${test.goalId}`)
      )
    ).status
  ).toBe(400);
  expect(test.execute).not.toHaveBeenCalled();
});

it('pins the first actor across later authentication replacement', async () => {
  const test = fixture();
  test.getUser
    .mockResolvedValueOnce({
      data: { user: { id: test.actorId } },
      error: null,
    })
    .mockResolvedValue({
      data: { user: { id: test.body.operationId } },
      error: null,
    });
  expect((await test.handler.GET(test.request())).status).toBe(403);
  expect(test.execute).not.toHaveBeenCalled();
});

it('rejects oversized streamed body and nested client authority without SQL', async () => {
  const test = fixture();
  expect(
    (await test.handler.POST(test.request('POST', 'x'.repeat(100000)))).status
  ).toBe(400);
  for (const field of ['actorId', 'source', 'token', 'proposal']) {
    expect(
      (
        await test.handler.POST(
          test.request('POST', {
            ...test.body,
            command: { ...test.body.command, [field]: 'injected' },
          })
        )
      ).status
    ).toBe(400);
  }
  expect(test.execute).not.toHaveBeenCalled();
});

it('does not dispatch SQL after abort during authorization', async () => {
  const test = fixture();
  const controller = new AbortController();
  test.getUser.mockImplementationOnce(() => {
    controller.abort();
    return Promise.resolve({
      data: { user: { id: test.actorId } },
      error: null,
    });
  });
  const request = new NextRequest(test.request(), {
    signal: controller.signal,
  });
  expect((await test.handler.GET(request)).status).toBe(503);
  expect(test.execute).not.toHaveBeenCalled();
});

it('rejects stale optimistic versions without writing', async () => {
  const test = fixture();
  const response = await test.handler.POST(
    test.request('POST', {
      ...test.body,
      command: { ...test.body.command, expectedVersion: 8 },
    })
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    status: 'unconfirmed',
    readbackRequired: true,
  });
  expect(test.execute).toHaveBeenCalledTimes(1);
});

it('does not dispatch when abort arrives during final scope revalidation', async () => {
  const test = fixture();
  const controller = new AbortController();
  const auth = { data: { user: { id: test.actorId } }, error: null };
  for (let check = 0; check < 4; check++)
    test.getUser.mockResolvedValueOnce(auth);
  test.getUser.mockImplementationOnce(() => {
    controller.abort();
    return Promise.resolve(auth);
  });
  const request = new NextRequest(test.request(), {
    signal: controller.signal,
  });
  expect((await test.handler.GET(request)).status).toBe(503);
  expect(test.execute).not.toHaveBeenCalled();
});

it('does not acknowledge a different operation receipt or post-write actor loss', async () => {
  for (const loss of ['receipt', 'actor']) {
    const test = fixture();
    test.execute
      .mockImplementationOnce(() =>
        Promise.resolve({ rows: [{ result: test.snapshot }] })
      )
      .mockImplementationOnce((_statement: string, parameters: string[]) => {
        const payload = JSON.parse(parameters[6]);
        if (loss === 'actor')
          test.getUser.mockResolvedValue({ data: { user: null }, error: null });
        return Promise.resolve({
          rows: [
            {
              result: {
                operationId:
                  loss === 'receipt' ? test.actorId : test.body.operationId,
                state: payload.proposal,
                persisted: true,
                dispatch: 'disabled',
                debitPermission: false,
              },
            },
          ],
        });
      });
    const response = await test.handler.POST(test.request('POST'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'unconfirmed',
      operationId: test.body.operationId,
      debitPermission: false,
    });
  }
});
