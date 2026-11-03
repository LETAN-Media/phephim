import {afterEach, describe, expect, it, vi} from 'vitest';
// Browser module is plain JavaScript and has no TypeScript declarations.
// @ts-expect-error TS7016
import {connectRealtime} from '../public/static/js/community/realtime.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('community realtime fallback', () => {
 it('refreshes periodically after websocket connection failures and stops on disconnect', () => {
  vi.useFakeTimers();
  const sockets: Array<{onclose?: (event: {code: number}) => void; close: () => void}> = [];
  class FakeWebSocket {
   onclose?: (event: {code: number}) => void;
   constructor() { sockets.push(this); }
   close() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', {protocol: 'https:', host: 'example.test'});
  vi.stubGlobal('document', {hidden: false});
  const onEvent = vi.fn(), onStatus = vi.fn();
  const disconnect = connectRealtime(1, onEvent, onStatus);
  sockets[0].onclose?.({code: 1006});
  vi.advanceTimersByTime(1600);
  expect(sockets).toHaveLength(2);
  sockets[1].onclose?.({code: 1006});
  expect(onStatus).toHaveBeenLastCalledWith('Đang cập nhật');
  expect(onEvent).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5000);
  expect(onEvent).toHaveBeenCalledTimes(2);
  disconnect();
  vi.advanceTimersByTime(10000);
  expect(onEvent).toHaveBeenCalledTimes(2);
 });
});
