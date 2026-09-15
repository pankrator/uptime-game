import { type World, type EntityId } from '../world';
import {
  wallets,
  reputations,
  powerCapacities,
  coolingCapacities,
  utilizations,
  demandClocks,
  workloads,
  offers,
  machines,
  installedIns,
  powereds,
  serverCapacities,
  inventories,
  type Workload,
  type Offer,
} from '../components';
import { WORKLOAD_ARCHETYPES, TRAIT_LABELS, TRAIT_KEYS } from '../game-data';
import { fits } from '../traits';
import { type Renderer } from '../../rendering';
import {
  getHudBarRect,
  getWorkloadPanelRect,
  getWorkloadRowRect,
  getOfferCardRect,
  getOfferButtonRect,
  getMuteButtonRect,
  HUD_PANEL_MAX_ROWS,
  HUD_PANEL_MARGIN,
} from '../../ui/layout';
import { type Audio } from '../../audio';
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

function drawMuteButton(renderer: Renderer, audio: Audio): void {
  const ctx = renderer.context;
  const rect = getMuteButtonRect(renderer.canvas.width);
  const muted = audio.isMuted();

  ctx.fillStyle = muted ? '#3a3f47' : 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = muted ? DIM_COLOR : TEXT_COLOR;
  ctx.fillText(muted ? '🔇' : '🔊', rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.textAlign = 'left';
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

  // Money — red with a minus sign once negative (.plans/power-billing.md D4/D5).
  const negative = wallet.money < 0;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = negative ? RED : GREEN;
  const moneyText = `${negative ? '-' : ''}$${Math.floor(Math.abs(wallet.money)).toLocaleString()}`;
  ctx.fillText(moneyText, x, midY);
  x += ctx.measureText(moneyText).width + 12;

  // Net income rate: revenue - power/cooling cost, the whole point of D5 — makes the tier
  // trade-off visible instead of just a slower income curve.
  const netPerSecond = utilization.revenuePerSecond - utilization.powerCostPerSecond;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = netPerSecond >= 0 ? GREEN : RED;
  const netText = `${netPerSecond >= 0 ? '+' : ''}${netPerSecond.toFixed(2)}/s`;
  ctx.fillText(netText, x, midY);
  x += ctx.measureText(netText).width + 20;

  // Power
  const overPower = utilization.powerDrawKw > powerCapacity.kw;
  ctx.font = '13px sans-serif';
  ctx.fillStyle = overPower ? RED : TEXT_COLOR;
  const powerText = `⚡ ${utilization.powerDrawKw.toFixed(1)} / ${powerCapacity.kw.toFixed(1)} kW  (-${utilization.powerCostPerSecond.toFixed(2)}/s)`;
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

  // Per-trait capacity (D5: compute alone hid RAM/storage pressure that could bottleneck
  // placement even while CPU still had headroom).
  ctx.font = '13px sans-serif';
  for (const key of TRAIT_KEYS) {
    const total = utilization.traitsTotal[key];
    const used = total - utilization.traitsFree[key];
    const over = used > total;
    ctx.fillStyle = over ? RED : TEXT_COLOR;
    const traitText = `${TRAIT_LABELS[key]} ${used}/${total}`;
    ctx.fillText(traitText, x, midY);
    x += ctx.measureText(traitText).width + 6;
    drawInlineBar(ctx, x, midY - 4, 36, 8, total > 0 ? used / total : 0, over ? RED : GREEN);
    x += 36 + 16;
  }

  // Inventory summary — total owned-but-unplaced stock (D5), bought at the shop.
  const inventory = world.getComponent(inventories, facility);
  if (inventory) {
    const totalStock = Object.values(inventory.counts).reduce((sum: number, count) => sum + (count ?? 0), 0);
    ctx.fillStyle = totalStock > 0 ? TEXT_COLOR : DIM_COLOR;
    const inventoryText = `📦 ${totalStock} in stock`;
    ctx.fillText(inventoryText, x, midY);
    x += ctx.measureText(inventoryText).width + 20;
  }

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

  // Section headers count as rows for layout purposes. Unplaced jobs (accepted but not yet
  // placed on a server — the tray, until the rack panel exists in step 7) are always shown in
  // full since they're deadline-timed and self-expire, so the list can't grow unbounded — only
  // ACTIVE rows are capped/truncated to keep the panel from overflowing the canvas.
  const pendingLines: { kind: 'header' | 'pending'; row?: WorkloadRow; label?: string }[] = [];
  if (pending.length > 0) {
    pendingLines.push({ kind: 'header', label: 'UNPLACED' });
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
      const fraction = 1 - workload.workRemainingSeconds / workload.workSeconds;
      const remaining = Math.max(0, Math.ceil(workload.workRemainingSeconds));
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
        `$${workload.payPerSecond.toFixed(2)}/s · ▦ ${workload.demands.cpu}`,
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
    const escalated = workload.deadlineRemainingSeconds < 5;

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = escalated ? RED : AMBER;
    ctx.fillText(`⚠ ${archetype.label}`, rect.x + padX, labelY);

    ctx.textAlign = 'right';
    ctx.fillText(
      `${Math.max(0, Math.ceil(workload.deadlineRemainingSeconds))}s`,
      rect.x + rect.width - padX,
      labelY,
    );

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = DIM_COLOR;
    const shortfallText = TRAIT_KEYS.map((key) => {
      const need = workload.demands[key];
      const free = utilization.traitsFree[key];
      return `${TRAIT_LABELS[key]} ${need}${free < need ? '!' : ''}`;
    }).join(' · ');
    ctx.fillText(shortfallText, rect.x + padX, shortfallY);

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

// Whether ANY online, installed server currently has enough free capacity for these demands —
// used to dim an offer the player can't currently serve. Informative, not blocking: they may
// be about to install a bigger box, so the offer stays acceptable either way.
function anyServerFits(world: World, demands: Offer['demands']): boolean {
  return world.query(machines, installedIns, powereds, serverCapacities).some((id) => {
    if (!world.getComponent(powereds, id)!.online) return false;
    const capacity = world.getComponent(serverCapacities, id)!;
    return fits(demands, capacity.free);
  });
}

function drawOfferCard(world: World, renderer: Renderer, index: number, offer: Offer): void {
  const ctx = renderer.context;
  const card = getOfferCardRect(index);
  const archetype = WORKLOAD_ARCHETYPES[offer.archetypeId];
  const servable = anyServerFits(world, offer.demands);

  ctx.globalAlpha = servable ? 1 : 0.55;

  ctx.fillStyle = 'rgba(20, 22, 25, 0.92)';
  ctx.fillRect(card.x, card.y, card.width, card.height);
  ctx.strokeStyle = '#33383f';
  ctx.lineWidth = 1;
  ctx.strokeRect(card.x, card.y, card.width, card.height);

  const padX = 10;
  let textY = card.y + 14;

  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(archetype.label, card.x + padX, textY);

  ctx.textAlign = 'right';
  ctx.fillStyle = offer.secondsRemaining < 5 ? RED : AMBER;
  ctx.font = '11px sans-serif';
  ctx.fillText(`${Math.max(0, Math.ceil(offer.secondsRemaining))}s`, card.x + card.width - padX, textY);

  textY += 14;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = DIM_COLOR;
  const demandsText = TRAIT_KEYS.map((key) => `${TRAIT_LABELS[key]} ${offer.demands[key]}`).join(' · ');
  ctx.fillText(demandsText, card.x + padX, textY);

  textY += 14;
  ctx.fillStyle = GREEN;
  const totalValue = offer.payPerSecond * offer.workSeconds;
  ctx.fillText(
    `$${offer.payPerSecond.toFixed(2)}/s · ~$${totalValue.toFixed(0)} total`,
    card.x + padX,
    textY,
  );

  if (!servable) {
    textY += 12;
    ctx.fillStyle = RED;
    ctx.font = '9px sans-serif';
    ctx.fillText('no server fits this', card.x + padX, textY);
  }

  const acceptRect = getOfferButtonRect(index, 'accept');
  ctx.fillStyle = '#2f6f4f';
  ctx.fillRect(acceptRect.x, acceptRect.y, acceptRect.width, acceptRect.height);
  ctx.strokeStyle = GREEN;
  ctx.strokeRect(acceptRect.x, acceptRect.y, acceptRect.width, acceptRect.height);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Accept', acceptRect.x + acceptRect.width / 2, acceptRect.y + acceptRect.height / 2);

  const declineRect = getOfferButtonRect(index, 'decline');
  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(declineRect.x, declineRect.y, declineRect.width, declineRect.height);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(declineRect.x, declineRect.y, declineRect.width, declineRect.height);
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText('Decline', declineRect.x + declineRect.width / 2, declineRect.y + declineRect.height / 2);

  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawOffersPanel(world: World, renderer: Renderer): void {
  const offerIds = world.query(offers).sort((a, b) => a - b);
  offerIds.forEach((offerId, index) => {
    const offer = world.getComponent(offers, offerId)!;
    drawOfferCard(world, renderer, index, offer);
  });
}

export function createHudSystem(world: World, renderer: Renderer, facility: EntityId, audio: Audio): System {
  return {
    update() {
      drawTopBar(world, renderer, facility);
      drawMuteButton(renderer, audio);
      drawOffersPanel(world, renderer);
      drawWorkloadPanel(world, renderer, facility);
    },
  };
}
