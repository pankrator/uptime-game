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
  tutorialProgresses,
  cycleLabel,
  temperatures,
  thermalTrips,
  rackSlots,
  gridPositions,
  type Workload,
  type Offer,
} from '../components';
import { WORKLOAD_ARCHETYPES, TRAIT_LABELS, TRAIT_KEYS } from '../game-data';
import { fits } from '../traits';
import { type Renderer } from '../../rendering';
import { type Camera } from '../../camera';
import {
  getHudBarRect,
  getWorkloadPanelRect,
  getWorkloadRowRect,
  getOfferCardRect,
  getOfferButtonRect,
  getMuteButtonRect,
  getRecenterButtonRect,
  getTutorialBannerRect,
  getTutorialActionButtonRect,
  getTutorialSkipRect,
  HUD_PANEL_MAX_ROWS,
  HUD_PANEL_MARGIN,
} from '../../ui/layout';
import { isTutorialActionStep, getTutorialStepDef } from './tutorial';
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
  const rect = getMuteButtonRect(renderer.width);
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

// Only drawn while the camera is manually panned away from following the player (WASD, or a
// drag on the floor on touch — see .plans/mobile-touch-support.md D3) — the touch-reachable
// equivalent of pressing Space. Same "always reachable" placement/hit-test treatment as the
// mute button (see input.ts).
function drawRecenterButton(renderer: Renderer, camera: Camera): void {
  if (!camera.detached) return;

  const ctx = renderer.context;
  const rect = getRecenterButtonRect(renderer.width);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText('Recenter', rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.textAlign = 'left';
}

function drawTopBar(world: World, renderer: Renderer, facility: EntityId): void {
  const ctx = renderer.context;
  const bar = getHudBarRect(renderer.width);

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

  // Below this, an item would start drawing under (or push past) the mute button — always
  // reachable regardless of window width (see getMuteButtonRect's own comment). Items are
  // listed most- to least-important; each is skipped once x reaches this budget, and since
  // skipping leaves x unmoved, every item after the first skip is skipped too — a narrow
  // window truncates the tail of the bar instead of overlapping the mute button or running off
  // the canvas. See .plans/playtest-findings.md B5.
  const rightLimit = getMuteButtonRect(renderer.width).x - 10;

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
  if (x < rightLimit) {
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
  }

  // Cooling
  if (x < rightLimit) {
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
  }

  // Reputation
  if (x < rightLimit) {
    ctx.fillStyle = repColor(reputation.value);
    const repText = `★ ${Math.round(reputation.value)}`;
    ctx.fillText(repText, x, midY);
    x += ctx.measureText(repText).width + 20;
  }

  // Per-trait capacity (D5: compute alone hid RAM/storage pressure that could bottleneck
  // placement even while CPU still had headroom).
  ctx.font = '13px sans-serif';
  for (const key of TRAIT_KEYS) {
    if (x >= rightLimit) break;
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

  // Overheat alert — reuses the brownout path's "count of racks in trouble" shape (D8 point 4):
  // count tripped (dark) and merely throttled (slowed) racks separately so the player can tell
  // "losing money now" from "about to."
  let trippedCount = 0;
  let throttledCount = 0;
  for (const rackId of world.query(rackSlots, gridPositions, temperatures)) {
    if (world.getComponent(thermalTrips, rackId)) {
      trippedCount += 1;
    } else if (world.getComponent(temperatures, rackId)!.throttleFactor < 1) {
      throttledCount += 1;
    }
  }
  if (trippedCount > 0 || throttledCount > 0) {
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = trippedCount > 0 ? RED : AMBER;
    const parts: string[] = [];
    if (trippedCount > 0) parts.push(`⛔ ${trippedCount} overheated`);
    if (throttledCount > 0) parts.push(`🌡 ${throttledCount} throttled`);
    const overheatText = parts.join('  ');
    ctx.fillText(overheatText, x, midY);
    x += ctx.measureText(overheatText).width + 20;
  }

  // Inventory summary — total owned-but-unplaced stock (D5), bought at the shop.
  const inventory = world.getComponent(inventories, facility);
  if (inventory && x < rightLimit) {
    const totalStock = Object.values(inventory.counts).reduce((sum: number, count) => sum + (count ?? 0), 0);
    ctx.fillStyle = totalStock > 0 ? TEXT_COLOR : DIM_COLOR;
    const inventoryText = `📦 ${totalStock} in stock`;
    ctx.fillText(inventoryText, x, midY);
    x += ctx.measureText(inventoryText).width + 20;
  }

  // Personal-best counters (cheap, already tracked) — lowest priority, first to drop.
  const clock = world.getComponent(demandClocks, facility);
  if (clock && x < rightLimit) {
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
  const canvasWidth = renderer.width;

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
      // A running workload's deadline never stops ticking (workload-run.ts), independent of
      // its work-remaining countdown — a job can be provably doomed (deadline will hit zero
      // before the work finishes) while still showing a healthy green progress bar, if only
      // work-remaining is on screen. See .plans/playtest-findings.md B4.
      const doomed = workload.workRemainingSeconds > workload.deadlineRemainingSeconds;
      const fraction = 1 - workload.workRemainingSeconds / workload.workSeconds;
      const remaining = Math.max(0, Math.ceil(workload.workRemainingSeconds));
      const deadlineRemaining = Math.max(0, Math.ceil(workload.deadlineRemainingSeconds));
      const labelY = rect.y + rect.height * 0.32;
      const statsY = rect.y + rect.height * 1.0;

      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = doomed ? RED : TEXT_COLOR;
      ctx.fillText(archetype.label + cycleLabel(workload), rect.x + padX, labelY);

      const barWidth = 70;
      const barX = rect.x + rect.width - padX - barWidth - 34;
      drawInlineBar(ctx, barX, labelY - 4, barWidth, 8, fraction, doomed ? RED : GREEN);

      ctx.textAlign = 'right';
      ctx.fillStyle = doomed ? RED : DIM_COLOR;
      ctx.fillText(`${remaining}s`, rect.x + rect.width - padX, labelY);

      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = doomed ? RED : GREEN;
      ctx.fillText(
        `$${workload.payPerSecond.toFixed(2)}/s · ▦ ${workload.demands.cpu}`,
        rect.x + padX,
        statsY,
      );

      // Deadline countdown, right-aligned on the same line as pay/compute — the number that
      // actually decides whether this job survives, previously shown only while unplaced.
      ctx.textAlign = 'right';
      ctx.fillStyle = doomed ? RED : AMBER;
      ctx.fillText(`⏱ ${deadlineRemaining}s`, rect.x + rect.width - padX, statsY);

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
    ctx.fillText(`⚠ ${archetype.label}${cycleLabel(workload)}`, rect.x + padX, labelY);

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
    // .plans/contract-variety.md D1: the workload panel is where an accepted-but-unplaced
    // contract's risk is most visible, so the miss penalty rides along with the shortfall.
    ctx.fillText(`${shortfallText} · -$${workload.penaltyOnMiss.toFixed(0)}`, rect.x + padX, shortfallY);

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

function drawOfferCard(world: World, renderer: Renderer, offer: Offer): void {
  const ctx = renderer.context;
  const card = getOfferCardRect(offer.slot);
  const archetype = WORKLOAD_ARCHETYPES[offer.archetypeId];
  const servable = anyServerFits(world, offer.demands);

  const cardAlpha = servable ? 1 : 0.55;
  ctx.globalAlpha = cardAlpha;

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

  // .plans/contract-variety.md D1: the number the accept/decline decision actually turns on —
  // must be at least as visible as the pay it's weighed against.
  textY += 14;
  ctx.fillStyle = RED;
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText(`-$${offer.penaltyOnMiss.toFixed(0)} if missed`, card.x + padX, textY);

  // D2: recurring contracts commit capacity for repeatTotal cycles — flag that up front, since
  // it's the main thing being evaluated alongside the penalty.
  if (offer.repeatTotal > 1) {
    textY += 12;
    ctx.fillStyle = AMBER;
    ctx.font = '9px sans-serif';
    ctx.fillText(`recurring · ${offer.repeatTotal} cycles`, card.x + padX, textY);
  }

  if (!servable) {
    textY += 14;
    // Full opacity regardless of the card's own dimming — this is the one line that explains
    // WHY the card is dimmed, so dimming it along with the rest defeats the point. Drawn on its
    // own line (not squeezed into the 6px gap above the buttons, which is not this space) —
    // see OFFER_CARD_HEIGHT's comment and .plans/playtest-findings.md B2.
    ctx.globalAlpha = 1;
    ctx.fillStyle = RED;
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('⚠ no server fits this', card.x + padX, textY);
    ctx.globalAlpha = cardAlpha;
  }

  const acceptRect = getOfferButtonRect(offer.slot, 'accept');
  ctx.fillStyle = '#2f6f4f';
  ctx.fillRect(acceptRect.x, acceptRect.y, acceptRect.width, acceptRect.height);
  ctx.strokeStyle = GREEN;
  ctx.strokeRect(acceptRect.x, acceptRect.y, acceptRect.width, acceptRect.height);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Accept', acceptRect.x + acceptRect.width / 2, acceptRect.y + acceptRect.height / 2);

  const declineRect = getOfferButtonRect(offer.slot, 'decline');
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
  // Each offer carries its own stable slot (see Offer.slot) — no positional indexing here, so
  // an earlier offer expiring doesn't shift a later one's card into a different slot mid-read.
  for (const offerId of world.query(offers)) {
    const offer = world.getComponent(offers, offerId)!;
    drawOfferCard(world, renderer, offer);
  }
}

// Guided-tutorial banner — a persistent overlay above everything else HUD draws (drawn last),
// since it must stay legible over the rack/shop panels' full-screen dim too. See
// systems/tutorial.ts for step-advance logic and input.ts for the button clicks this draws.
function drawTutorialBanner(world: World, renderer: Renderer, facility: EntityId): void {
  const progress = world.getComponent(tutorialProgresses, facility);
  if (!progress || progress.skipped) return;

  const ctx = renderer.context;
  const banner = getTutorialBannerRect(renderer.width, renderer.height);
  const step = getTutorialStepDef(progress.stepId);

  ctx.fillStyle = 'rgba(14, 18, 20, 0.95)';
  ctx.fillRect(banner.x, banner.y, banner.width, banner.height);
  ctx.strokeStyle = '#3ddc97';
  ctx.lineWidth = 1;
  ctx.strokeRect(banner.x, banner.y, banner.width, banner.height);

  const padX = 14;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = '#3ddc97';
  ctx.fillText(step.title, banner.x + padX, banner.y + 20);

  ctx.font = '12px sans-serif';
  ctx.fillStyle = TEXT_COLOR;
  const maxWidth = banner.width - padX * 2;
  const words = step.body.split(' ');
  let line = '';
  let lineY = banner.y + 40;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, banner.x + padX, lineY);
      line = word;
      lineY += 16;
    } else {
      line = candidate;
    }
  }
  if (line) ctx.fillText(line, banner.x + padX, lineY);

  if (isTutorialActionStep(progress.stepId)) {
    const buttonRect = getTutorialActionButtonRect(renderer.width, renderer.height);
    ctx.fillStyle = '#2f6f4f';
    ctx.fillRect(buttonRect.x, buttonRect.y, buttonRect.width, buttonRect.height);
    ctx.strokeStyle = GREEN;
    ctx.strokeRect(buttonRect.x, buttonRect.y, buttonRect.width, buttonRect.height);
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      progress.stepId === 'welcome' ? 'Got it →' : 'Start Playing →',
      buttonRect.x + buttonRect.width / 2,
      buttonRect.y + buttonRect.height / 2,
    );
    ctx.textAlign = 'left';
  } else {
    const skipRect = getTutorialSkipRect(renderer.width, renderer.height);
    ctx.fillStyle = DIM_COLOR;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Skip tutorial ✕', skipRect.x + skipRect.width, skipRect.y + skipRect.height / 2);
    ctx.textAlign = 'left';
  }
}

export function createHudSystem(
  world: World,
  renderer: Renderer,
  facility: EntityId,
  audio: Audio,
  camera: Camera,
): System {
  return {
    update() {
      drawTopBar(world, renderer, facility);
      drawMuteButton(renderer, audio);
      drawRecenterButton(renderer, camera);
      drawOffersPanel(world, renderer);
      drawWorkloadPanel(world, renderer, facility);
      drawTutorialBanner(world, renderer, facility);
    },
  };
}
