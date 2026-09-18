import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, type World, type EntityId } from './world';
import { activeModal, openModal, registerModalCloser, type ModalKind } from './modal';
import { activeModals } from './components';

describe('activeModal', () => {
  let world: World;
  let player: EntityId;

  beforeEach(() => {
    world = createWorld();
    player = world.createEntity();
  });

  it('reports null when nothing is open', () => {
    expect(activeModal(world, player)).toBeNull();
  });

  it('reports the shop when the shop is open', () => {
    world.addComponent(activeModals, player, { kind: 'shop' });
    expect(activeModal(world, player)).toBe('shop');
  });

  it('reports the offers panel when open', () => {
    world.addComponent(activeModals, player, { kind: 'offers' });
    expect(activeModal(world, player)).toBe('offers');
  });

  it('reports the jobs panel when open', () => {
    world.addComponent(activeModals, player, { kind: 'jobs' });
    expect(activeModal(world, player)).toBe('jobs');
  });

  it('does not report the rack panel while dispatching and not yet arrived', () => {
    const rackId = world.createEntity();
    world.addComponent(activeModals, player, { kind: 'rack', rackId, mode: 'dispatching', arrived: false });
    expect(activeModal(world, player)).toBeNull();
  });

  it('reports the rack panel once a dispatching panel has arrived', () => {
    const rackId = world.createEntity();
    world.addComponent(activeModals, player, { kind: 'rack', rackId, mode: 'dispatching', arrived: true });
    expect(activeModal(world, player)).toBe('rack');
  });

  it('reports the rack panel in viewing mode even before arrival', () => {
    const rackId = world.createEntity();
    world.addComponent(activeModals, player, { kind: 'rack', rackId, mode: 'viewing', arrived: false });
    expect(activeModal(world, player)).toBe('rack');
  });
});

describe('openModal', () => {
  let world: World;
  let player: EntityId;
  let closed: ModalKind[];

  beforeEach(() => {
    world = createWorld();
    player = world.createEntity();
    closed = [];
    (['rack', 'shop', 'offers', 'jobs'] as ModalKind[]).forEach((kind) => {
      registerModalCloser(kind, () => closed.push(kind));
    });
  });

  it('records the new modal as active', () => {
    openModal(world, player, { kind: 'shop' });
    expect(activeModal(world, player)).toBe('shop');
  });

  it('replaces whatever was open — only one can ever be active at once', () => {
    openModal(world, player, { kind: 'shop' });
    openModal(world, player, { kind: 'offers' });
    expect(world.getComponent(activeModals, player)).toEqual({ kind: 'offers' });
  });

  it('runs the previous kind registered closer when switching kinds', () => {
    openModal(world, player, { kind: 'shop' });
    openModal(world, player, { kind: 'jobs' });
    expect(closed).toEqual(['shop']);
  });

  it('does not run any closer when nothing was open yet', () => {
    openModal(world, player, { kind: 'offers' });
    expect(closed).toEqual([]);
  });

  it('does not run the closer when re-opening the same kind in place (e.g. a different rack)', () => {
    const rackA = world.createEntity();
    const rackB = world.createEntity();
    openModal(world, player, { kind: 'rack', rackId: rackA, mode: 'dispatching', arrived: false });
    openModal(world, player, { kind: 'rack', rackId: rackB, mode: 'dispatching', arrived: false });
    expect(closed).toEqual([]);
    expect(world.getComponent(activeModals, player)).toEqual({
      kind: 'rack',
      rackId: rackB,
      mode: 'dispatching',
      arrived: false,
    });
  });
});
