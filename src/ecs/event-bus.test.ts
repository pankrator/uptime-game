import { describe, it, expect } from 'vitest';
import { createEventBus } from './event-bus';

interface TestEvents {
  ping: { count: number };
  named: { name: string };
}

describe('createEventBus', () => {
  it('calls every subscribed handler with the emitted payload', () => {
    const bus = createEventBus<TestEvents>();
    const received: number[] = [];
    bus.on('ping', (payload) => received.push(payload.count));
    bus.on('ping', (payload) => received.push(payload.count * 10));

    bus.emit('ping', { count: 3 });

    expect(received).toEqual([3, 30]);
  });

  it('never calls a handler for a different event type', () => {
    const bus = createEventBus<TestEvents>();
    const pings: number[] = [];
    const names: string[] = [];
    bus.on('ping', (payload) => pings.push(payload.count));
    bus.on('named', (payload) => names.push(payload.name));

    bus.emit('named', { name: 'a' });

    expect(pings).toEqual([]);
    expect(names).toEqual(['a']);
  });

  it('is a no-op when nothing is subscribed', () => {
    const bus = createEventBus<TestEvents>();
    expect(() => bus.emit('ping', { count: 1 })).not.toThrow();
  });

  it('calls handlers in subscription order', () => {
    const bus = createEventBus<TestEvents>();
    const order: string[] = [];
    bus.on('ping', () => order.push('first'));
    bus.on('ping', () => order.push('second'));

    bus.emit('ping', { count: 1 });

    expect(order).toEqual(['first', 'second']);
  });

  it('stops calling a handler once its unsubscribe function is called', () => {
    const bus = createEventBus<TestEvents>();
    const received: number[] = [];
    const unsubscribe = bus.on('ping', (payload) => received.push(payload.count));

    bus.emit('ping', { count: 1 });
    unsubscribe();
    bus.emit('ping', { count: 2 });

    expect(received).toEqual([1]);
  });

  it('does not affect other subscribers when one unsubscribes', () => {
    const bus = createEventBus<TestEvents>();
    const received: string[] = [];
    const unsubscribeA = bus.on('ping', () => received.push('a'));
    bus.on('ping', () => received.push('b'));

    unsubscribeA();
    bus.emit('ping', { count: 1 });

    expect(received).toEqual(['b']);
  });

  it('lets a handler unsubscribe itself mid-emit without breaking sibling handlers', () => {
    const bus = createEventBus<TestEvents>();
    const received: string[] = [];
    let unsubscribeSelf: () => void = () => {};
    unsubscribeSelf = bus.on('ping', () => {
      received.push('self');
      unsubscribeSelf();
    });
    bus.on('ping', () => received.push('other'));

    bus.emit('ping', { count: 1 });
    bus.emit('ping', { count: 2 });

    expect(received).toEqual(['self', 'other', 'other']);
  });

  it('supports multiple independent event types on one bus', () => {
    const bus = createEventBus<TestEvents>();
    const pings: number[] = [];
    const names: string[] = [];
    bus.on('ping', (payload) => pings.push(payload.count));
    bus.on('named', (payload) => names.push(payload.name));

    bus.emit('ping', { count: 1 });
    bus.emit('named', { name: 'x' });
    bus.emit('ping', { count: 2 });

    expect(pings).toEqual([1, 2]);
    expect(names).toEqual(['x']);
  });
});
