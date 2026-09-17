import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, type World, type EntityId } from './world';
import { activeModal, closeOtherModals, registerModalCloser, type ModalKind } from './modal';
import { openRackPanels, shopOpens, offersPanelOpens, jobsPanelOpens } from './components';

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

  it('reports the shop when only the shop is open', () => {
    world.addComponent(shopOpens, player, { open: true });
    expect(activeModal(world, player)).toBe('shop');
  });

  it('does not report the rack panel while dispatching and not yet arrived', () => {
    const rackId = world.createEntity();
    world.addComponent(openRackPanels, player, { rackId, mode: 'dispatching', arrived: false });
    expect(activeModal(world, player)).toBeNull();
  });

  it('reports the rack panel once a dispatching panel has arrived', () => {
    const rackId = world.createEntity();
    world.addComponent(openRackPanels, player, { rackId, mode: 'dispatching', arrived: true });
    expect(activeModal(world, player)).toBe('rack');
  });

  it('reports the rack panel in viewing mode even before arrival', () => {
    const rackId = world.createEntity();
    world.addComponent(openRackPanels, player, { rackId, mode: 'viewing', arrived: false });
    expect(activeModal(world, player)).toBe('rack');
  });

  it('prioritizes offers over jobs, rack and shop', () => {
    const rackId = world.createEntity();
    world.addComponent(shopOpens, player, { open: true });
    world.addComponent(openRackPanels, player, { rackId, mode: 'viewing', arrived: false });
    world.addComponent(jobsPanelOpens, player, { open: true });
    world.addComponent(offersPanelOpens, player, { open: true });
    expect(activeModal(world, player)).toBe('offers');
  });

  it('prioritizes jobs over rack and shop', () => {
    const rackId = world.createEntity();
    world.addComponent(shopOpens, player, { open: true });
    world.addComponent(openRackPanels, player, { rackId, mode: 'viewing', arrived: false });
    world.addComponent(jobsPanelOpens, player, { open: true });
    expect(activeModal(world, player)).toBe('jobs');
  });

  it('prioritizes the rack panel over the shop', () => {
    const rackId = world.createEntity();
    world.addComponent(shopOpens, player, { open: true });
    world.addComponent(openRackPanels, player, { rackId, mode: 'viewing', arrived: false });
    expect(activeModal(world, player)).toBe('rack');
  });
});

describe('closeOtherModals', () => {
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

  it('closes every registered modal except the one being kept', () => {
    closeOtherModals(world, player, 'rack');
    expect(closed.sort()).toEqual(['jobs', 'offers', 'shop']);
  });

  it('closes all four when keeping a kind that is not even registered as an alias', () => {
    closeOtherModals(world, player, 'shop');
    expect(closed.sort()).toEqual(['jobs', 'offers', 'rack']);
  });
});
