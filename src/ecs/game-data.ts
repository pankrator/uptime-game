export type MachineTierId = 'basic' | 'dense';

export interface MachineTierDef {
  id: MachineTierId;
  label: string;
  cost: number;
  compute: number;
  powerKw: number;
  coolingKw: number;
  installSeconds: number;
}

export const MACHINE_TIERS: Record<MachineTierId, MachineTierDef> = {
  basic: {
    id: 'basic',
    label: 'Server',
    cost: 250,
    compute: 10,
    powerKw: 0.4,
    coolingKw: 0.3,
    installSeconds: 3.0,
  },
  dense: {
    id: 'dense',
    label: 'Blade Chassis',
    cost: 900,
    compute: 45,
    powerKw: 1.6,
    coolingKw: 1.4,
    installSeconds: 4.5,
  },
};

export const RACK_COST = 120;
export const RACK_SLOT_CAPACITY = 6;

export const POWER_UPGRADE_COST = 400;
export const POWER_UPGRADE_KW = 5;
export const COOLING_UPGRADE_COST = 350;
export const COOLING_UPGRADE_KW = 5;

export const STARTING_MONEY = 750;
export const STARTING_POWER_KW = 3;
export const STARTING_COOLING_KW = 3;
export const STARTING_REPUTATION = 50;
