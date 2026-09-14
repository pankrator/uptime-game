import { type World, type EntityId } from '../world';
import {
  wallets,
  reputations,
  powerCapacities,
  coolingCapacities,
  utilizations,
  demandClocks,
  workloads,
  type Workload,
} from '../components';
import { WORKLOAD_ARCHETYPES } from '../game-data';
import { type Renderer } from '../../rendering';
import {
  getHudBarRect,
  getWorkloadPanelRect,
  getWorkloadRowRect,
  HUD_PANEL_MAX_ROWS,
  HUD_PANEL_MARGIN,
} from '../../ui/layout';
import { type System } from './system';

const TEXT_COLOR = '#e6e8eb';
const DIM_COLOR = '#9aa0a6';
const RED = '#e5484d';
const AMBER = '#f7b731';
const GREEN = '#3ddc84';

function repColor(value: number): string {
  if (value < 30) return RED;
  if (value < 60) return AMBER;
  return GREEN;
}

function drawInlineBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fraction: number,
  color: string,
): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width * Math.min(1, fraction), height);
}

function drawTopBar(world: World, renderer: Renderer, facility: EntityId): void {
  const ctx = renderer.context;
  const bar = getHudBarRect(renderer.canvas.width);

  ctx.fillStyle = 'rgba(20, 22, 25, 0.92)';
  ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
  ctx.strokeStyle = '#33383f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bar.x, bar.height);
  ctx.lineTo(bar.x + bar.width, bar.height);
  ctx.stroke();

  const wallet = world.getComponent(wallets, facility);
  const reputation = world.getComponent(reputations, facility);
  const powerCapacity = world.getComponent(powerCapacities, facility);
  const coolingCapacity = world.getComponent(coolingCapacities, facility);
  const utilization = world.getComponent(utilizations, facility);
  if (!wallet || !reputation || !powerCapacity || !coolingCapacity || !utilization) return;

  const midY = bar.height / 2;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let x = 12;

  // Money
  ctx.fillStyle = GREEN;
  const moneyText = `$${Math.floor(wallet.money).toLocaleString()}`;
  ctx.fillText(moneyText, x, midY);
  x += ctx.measureText(moneyText).width + 20;

  // Power
  const overPower = utilization.powerDrawKw > powerCapacity.kw;
  ctx.font = '13px sans-serif';
  ctx.fillStyle = overPower ? RED : TEXT_COLOR;
  const powerText = `⚡ ${utilization.powerDrawKw.toFixed(1)} / ${powerCapacity.kw.toFixed(1)} kW`;
  ctx.fillText(powerText, x, midY);
  x += ctx.measureText(powerText).width + 6;
  drawInlineBar(
    ctx,
    x,
    midY - 4,
    36,
    8,
    utilization.powerDrawKw / powerCapacity.kw,
    overPower ? RED : GREEN,
  );
  x += 36 + 20;

  // Cooling
  const overCooling = utilization.coolingDrawKw > coolingCapacity.kw;
  ctx.fillStyle = overCooling ? RED : TEXT_COLOR;
  const coolingText = `❄ ${utilization.coolingDrawKw.toFixed(1)} / ${coolingCapacity.kw.toFixed(1)} kW`;
  ctx.fillText(coolingText, x, midY);
  x += ctx.measureText(coolingText).width + 6;
  drawInlineBar(
    ctx,
    x,
    midY - 4,
    36,
    8,
    utilization.coolingDrawKw / coolingCapacity.kw,
    overCooling ? RED : GREEN,
  );
  x += 36 + 20;

  // Reputation
  ctx.fillStyle = repColor(reputation.value);
  const repText = `★ ${Math.round(reputation.value)}`;
  ctx.fillText(repText, x, midY);
  x += ctx.measureText(repText).width + 20;

  // Compute
  ctx.fillStyle = TEXT_COLOR;
  const assigned = utilization.computeTotal - utilization.computeFree;
  const computeText = `▦ ${assigned}/${utilization.computeTotal} compute`;
  ctx.fillText(computeText, x, midY);
  x += ctx.measureText(computeText).width + 20;

  // Personal-best counters (cheap, already tracked)
  const clock = world.getComponent(demandClocks, facility);
  if (clock) {
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText(
      `served ${clock.contractsServed}  peak ${clock.peakComputeServed}`,
      x,
      midY,
    );
  }
}

interface WorkloadRow {
  id: EntityId;
  workload: Workload;
}

function drawWorkloadPanel(world: World, renderer: Renderer, facility: EntityId): void {
  const ctx = renderer.context;
  const canvasWidth = renderer.canvas.width;

  const utilization = world.getComponent(utilizations, facility);
  if (!utilization) return;

  const active: WorkloadRow[] = [];
  const pending: WorkloadRow[] = [];
  for (const id of world.query(workloads)) {
    const workload = world.getComponent(workloads, id)!;
    if (workload.state === 'running') {
      active.push({ id, workload });
    } else {
      pending.push({ id, workload });
    }
  }
  active.sort((a, b) => a.id - b.id);
  pending.sort((a, b) => a.id - b.id);

  // Section headers count as rows for layout purposes. Pending jobs are always shown in
  // full (they're grace-timed and self-expire, so the list can't grow unbounded) — only
  // ACTIVE rows are capped/truncated to keep the panel from overflowing the canvas.
  const pendingLines: { kind: 'header' | 'pending'; row?: WorkloadRow; label?: string }[] = [];
  if (pending.length > 0) {
    pendingLines.push({ kind: 'header', label: 'PENDING' });
    for (const row of pending) {
      // Pending rows take two lines (label+countdown, then shortfall).
      pendingLines.push({ kind: 'pending', row });
    }
  }
  const pendingLineCount = pendingLines.reduce((sum, line) => sum + (line.kind === 'pending' ? 2 : 1), 0);

  const activeLines: { kind: 'header' | 'active'; row?: WorkloadRow; label?: string }[] = [];
  if (active.length > 0) {
    activeLines.push({ kind: 'header', label: 'ACTIVE' });
    for (const row of active) activeLines.push({ kind: 'active', row });
  }

  if (pendingLines.length === 0 && activeLines.length === 0) return;

  // Cap only the ACTIVE section against the remaining budget after reserving space for the
  // full PENDING section. Active rows take two lines each (label+countdown, then earn/compute).
  const activeBudget = Math.max(0, HUD_PANEL_MAX_ROWS - pendingLineCount);
  const visibleActive: typeof activeLines = [];
  let lineCount = 0;
  let hiddenCount = 0;
  for (const line of activeLines) {
    const lineCost = line.kind === 'active' ? 2 : 1;
    if (lineCount + lineCost > activeBudget) {
      if (line.kind !== 'header') hiddenCount += 1;
      continue;
    }
    visibleActive.push(line);
    lineCount += lineCost;
  }

  const visible: { kind: 'header' | 'active' | 'pending'; row?: WorkloadRow; label?: string }[] = [
    ...visibleActive,
    ...pendingLines,
  ];
  lineCount += pendingLineCount;

  const totalRowSlots = lineCount + (hiddenCount > 0 ? 1 : 0);
  const panel = getWorkloadPanelRect(canvasWidth, totalRowSlots);

  ctx.fillStyle = 'rgba(20, 22, 25, 0.92)';
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = '#33383f';
  ctx.lineWidth = 1;
  ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);

  let rowIndex = 0;
  for (const line of visible) {
    const rect = getWorkloadRowRect(rowIndex, canvasWidth, totalRowSlots);
    const padX = 10;

    if (line.kind === 'header') {
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = DIM_COLOR;
      ctx.fillText(line.label!, rect.x + padX, rect.y + rect.height / 2);
      rowIndex += 1;
      continue;
    }

    const { workload } = line.row!;
    const archetype = WORKLOAD_ARCHETYPES[workload.archetypeId];

    if (line.kind === 'active') {
      const fraction = workload.elapsedSeconds / workload.durationSeconds;
      const remaining = Math.max(0, Math.ceil(workload.durationSeconds - workload.elapsedSeconds));
      const labelY = rect.y + rect.height * 0.32;
      const statsY = rect.y + rect.height * 1.0;

      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = TEXT_COLOR;
      ctx.fillText(archetype.label, rect.x + padX, labelY);

      const barWidth = 70;
      const barX = rect.x + rect.width - padX - barWidth - 34;
      drawInlineBar(ctx, barX, labelY - 4, barWidth, 8, fraction, GREEN);

      ctx.textAlign = 'right';
      ctx.fillStyle = DIM_COLOR;
      ctx.fillText(`${remaining}s`, rect.x + rect.width - padX, labelY);

      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = GREEN;
      ctx.fillText(
        `$${workload.payPerSecond.toFixed(2)}/s · ▦ ${workload.computeRequired}`,
        rect.x + padX,
        statsY,
      );

      rowIndex += 2;
      continue;
    }

    // Pending: two lines within one row-rect-and-a-half — draw label/countdown on the first
    // line, shortfall on the second.
    const labelY = rect.y + rect.height * 0.32;
    const shortfallY = rect.y + rect.height * 1.0;
    const escalated = workload.graceRemainingSeconds < 5;

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = escalated ? RED : AMBER;
    ctx.fillText(`⚠ ${archetype.label}`, rect.x + padX, labelY);

    ctx.textAlign = 'right';
    ctx.fillText(`${Math.max(0, Math.ceil(workload.graceRemainingSeconds))}s`, rect.x + rect.width - padX, labelY);

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText(
      `needs ${workload.computeRequired}, have ${utilization.computeFree}`,
      rect.x + padX,
      shortfallY,
    );

    rowIndex += 2;
  }

  if (hiddenCount > 0) {
    const rect = getWorkloadRowRect(rowIndex, canvasWidth, totalRowSlots);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText(`+${hiddenCount} more`, rect.x + HUD_PANEL_MARGIN - 2, rect.y + rect.height / 2);
  }
}

export function createHudSystem(world: World, renderer: Renderer, facility: EntityId): System {
  return {
    update() {
      drawTopBar(world, renderer, facility);
      drawWorkloadPanel(world, renderer, facility);
    },
  };
}
