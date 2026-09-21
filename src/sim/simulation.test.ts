// Sustained multi-system runs: the automated version of a manual tuning pass by eye. Each
// scenario plays a different strategy through the full pipeline for several simulated minutes
// and asserts the world's invariants after every tick.
//
// Set VERBOSE_SIM=1 to print a per-minute timeline and the event tally for each scenario —
// that's the readout a balance check-up reads, rather than a pass/fail.
import { describe, it, expect } from 'vitest';
import { createSimulation, withSeededRandom, SIMULATION_TICK_SECONDS } from './simulation';
import { createScriptedPlayer, type ScriptedPlayerOptions } from './player';
import { checkInvariants, type InvariantBreach } from './invariants';
import { snapshot, formatSnapshot } from './snapshot';
import { reputations, offers, wallets } from '../ecs/components';
import { MAX_OFFERS } from '../ecs/game-data';

const VERBOSE = !!import.meta.env.VERBOSE_SIM;

interface ScenarioResult {
  breaches: InvariantBreach[];
  finalMoney: number;
  contractsServed: number;
}

function playScenario(
  name: string,
  seed: number,
  minutes: number,
  playerOptions: ScriptedPlayerOptions,
): ScenarioResult {
  return withSeededRandom(seed, () => {
    const sim = createSimulation();
    const player = createScriptedPlayer(sim, playerOptions);

    // First occurrence only: a broken invariant usually stays broken, and one line per rule is
    // what identifies it.
    const breaches: InvariantBreach[] = [];
    const seenRules = new Set<string>();
    const timeline: string[] = [];
    let ticks = 0;

    sim.run(minutes * 60, {
      driver: player,
      onTick(current) {
        ticks += 1;
        for (const breach of checkInvariants(current.world, current.facility)) {
          if (seenRules.has(breach.rule)) continue;
          seenRules.add(breach.rule);
          breaches.push({
            ...breach,
            detail: `${breach.detail} (at ${current.elapsedSeconds.toFixed(1)}s)`,
          });
        }
        if (VERBOSE && ticks % Math.round(60 / SIMULATION_TICK_SECONDS) === 0) {
          timeline.push(formatSnapshot(snapshot(current)));
        }
      },
    });

    if (VERBOSE) {
      console.log(`\n=== ${name} (seed ${seed}, ${minutes} simulated minutes) ===`);
      for (const line of timeline) console.log(line);
      console.log(`events ${JSON.stringify(Object.fromEntries(sim.eventCounts))}`);
    }

    const final = snapshot(sim);
    // Assert here rather than in the caller so a breach names the scenario that produced it.
    expect(breaches, `${name} (seed ${seed}) broke an invariant`).toEqual([]);
    expect(sim.world.getComponent(reputations, sim.facility)!.value).toBeGreaterThanOrEqual(0);
    expect(sim.world.getComponent(reputations, sim.facility)!.value).toBeLessThanOrEqual(100);
    expect(sim.world.query(offers).length).toBeLessThanOrEqual(MAX_OFFERS);
    expect(Number.isFinite(sim.world.getComponent(wallets, sim.facility)!.money)).toBe(true);

    return {
      breaches,
      finalMoney: final.money,
      contractsServed: final.contractsServed,
    };
  });
}

describe('sustained facility simulation', () => {
  it('a buying player holds every invariant across three seeds', () => {
    for (const seed of [12345, 999, 4242]) {
      const result = playScenario('biggest-affordable buyer', seed, 8, {
        buyStrategy: 'biggest-affordable',
      });
      expect(result.contractsServed).toBeGreaterThan(0);
    }
  }, 60000);

  it('a player who accepts work nothing can serve still holds every invariant', () => {
    playScenario('accepts everything', 12345, 6, {
      buyStrategy: 'biggest-affordable',
      acceptUnservable: true,
    });
  }, 60000);

  it('a thermally-managed dense build holds every invariant through trips and recoveries', () => {
    playScenario('blade-only with CRACs', 12345, 10, {
      buyStrategy: 'blade-only',
      manageThermals: true,
      serversPerRack: 2,
      maxRacks: 12,
      cashBuffer: 50,
    });
  }, 60000);

  it('a passive player who never buys holds every invariant', () => {
    playScenario('buys nothing', 12345, 6, {
      buyStrategy: 'none',
      buyUtilities: false,
      repairAboveWear: null,
      maxRacks: 1,
    });
  }, 60000);
});
