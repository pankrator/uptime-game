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
  offersPanelScrolls,
  jobsPanelScrolls,
  inventories,
  tutorialProgresses,
  cycleLabel,
  temperatures,
  thermalTrips,
  rackSlots,
  gridPositions,
  faileds,
  acceptConfirms,
  toasts,
  type Workload,
  type Offer,
} from '../components';
import { WORKLOAD_ARCHETYPES, TRAIT_LABELS, TRAIT_KEYS } from '../game-data';
import { type Renderer } from '../../rendering';
import { type Camera } from '../../camera';
import {
  getHudBarRect,
  getMuteButtonRect,
  getRecenterButtonRect,
  getTutorialBannerRect,
  getTutorialActionButtonRect,
  getTutorialSkipRect,
  getOffersModalRect,
  getOffersModalContentRect,
  getOffersModalFullContentHeight,
  getOffersModalCloseButtonRect,
  getOffersModalCardRect,
  getOffersModalButtonRect,
  OFFER_BUTTON_HEIGHT,
  getJobsModalRect,
  getJobsModalContentRect,
  getJobsModalContentHeight,
  getJobsModalCloseButtonRect,
  JOBS_MODAL_ROW_HEIGHT,
  JOBS_MODAL_HEADER_ROW_HEIGHT,
  JOBS_MODAL_PADDING,
  getToastRect,
} from '../../ui/layout';
import { maxScrollOffset } from '../../ui/scroll';
import { isTutorialActionStep, getTutorialStepDef } from './tutorial';
import { isOffersModalOpen, isJobsModalOpen, jobPanelCounts, anyServerFits } from './job-panels';
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
  // listed most- to least-important; tryDraw skips an item (leaving x unmoved) once it no
  // longer fits before this budget, so every item after the first skip is skipped too — a
  // narrow window truncates the tail of the bar instead of overlapping the mute button or
  // running off the canvas. See .plans/playtest-findings.md B5.
  const rightLimit = getMuteButtonRect(renderer.width).x - 10;

  // Checks the item's full width (text plus any trailing bar/gap) against rightLimit before
  // drawing, and only advances x on success — the single choke point every top-bar item goes
  // through, so a twelfth item cannot be added without this check the way eleven hand-written
  // `if (x < rightLimit)` guards could be (and three already were, silently).
  const tryDraw = (width: number, draw: () => void): void => {
    if (x + width > rightLimit) return;
    draw();
    x += width;
  };

  // Money — red with a minus sign once negative (.plans/power-billing.md D4/D5).
  const negative = wallet.money < 0;
  ctx.font = 'bold 14px sans-serif';
  const moneyText = `${negative ? '-' : ''}$${Math.floor(Math.abs(wallet.money)).toLocaleString()}`;
  tryDraw(ctx.measureText(moneyText).width + 12, () => {
    ctx.fillStyle = negative ? RED : GREEN;
    ctx.fillText(moneyText, x, midY);
  });

  // Net income rate: revenue - power/cooling cost, the whole point of D5 — makes the tier
  // trade-off visible instead of just a slower income curve.
  const netPerSecond = utilization.revenuePerSecond - utilization.powerCostPerSecond;
  ctx.font = '12px sans-serif';
  const netText = `${netPerSecond >= 0 ? '+' : ''}${netPerSecond.toFixed(2)}/s`;
  tryDraw(ctx.measureText(netText).width + 20, () => {
    ctx.fillStyle = netPerSecond >= 0 ? GREEN : RED;
    ctx.fillText(netText, x, midY);
  });

  // Power
  {
    const overPower = utilization.powerDrawKw > powerCapacity.kw;
    ctx.font = '13px sans-serif';
    const powerText = `⚡ ${utilization.powerDrawKw.toFixed(1)} / ${powerCapacity.kw.toFixed(1)} kW  (-${utilization.powerCostPerSecond.toFixed(2)}/s)`;
    const textWidth = ctx.measureText(powerText).width;
    tryDraw(textWidth + 6 + 36 + 20, () => {
      ctx.fillStyle = overPower ? RED : TEXT_COLOR;
      ctx.fillText(powerText, x, midY);
      drawInlineBar(
        ctx,
        x + textWidth + 6,
        midY - 4,
        36,
        8,
        utilization.powerDrawKw / powerCapacity.kw,
        overPower ? RED : GREEN,
      );
    });
  }

  // Cooling. Spelled out rather than left as a bare ❄ figure: this is the facility's cooling
  // BUDGET — how much work the datacenter can run at once, enforced by resource.ts as a brownout
  // cap exactly like power — and it has nothing to do with how hot any rack is. Rack temperature
  // is local (flat baseline + CRACs in range + that rack's own heat) and is shown per rack on the
  // floor in °C, so a lone snowflake here invited reading the two as the same thing. See
  // .plans/thermal-and-cooling.md D5.
  {
    const overCooling = utilization.coolingDrawKw > coolingCapacity.kw;
    const coolingText = `❄ COOLING ${utilization.coolingDrawKw.toFixed(1)} / ${coolingCapacity.kw.toFixed(1)} kW`;
    const textWidth = ctx.measureText(coolingText).width;
    tryDraw(textWidth + 6 + 36 + 20, () => {
      ctx.fillStyle = overCooling ? RED : TEXT_COLOR;
      ctx.fillText(coolingText, x, midY);
      drawInlineBar(
        ctx,
        x + textWidth + 6,
        midY - 4,
        36,
        8,
        utilization.coolingDrawKw / coolingCapacity.kw,
        overCooling ? RED : GREEN,
      );
    });
  }

  // Reputation
  {
    const repText = `★ ${Math.round(reputation.value)}`;
    tryDraw(ctx.measureText(repText).width + 20, () => {
      ctx.fillStyle = repColor(reputation.value);
      ctx.fillText(repText, x, midY);
    });
  }

  // Offers/Jobs hint badges — now that both live behind toggled panels instead of a
  // permanently docked column (.plans/job-panels.md), this is the only always-visible sign
  // they exist at all.
  {
    const offerCount = world.query(offers).length;
    ctx.font = 'bold 13px sans-serif';
    const offersText = `📥 ${offerCount} offers [O]`;
    tryDraw(ctx.measureText(offersText).width + 16, () => {
      ctx.fillStyle = offerCount > 0 ? AMBER : DIM_COLOR;
      ctx.fillText(offersText, x, midY);
    });
  }
  {
    const { pendingCount, activeCount } = jobPanelCounts(world);
    const jobCount = pendingCount + activeCount;
    ctx.font = '13px sans-serif';
    const jobsText = `🗂 ${jobCount} jobs [J]`;
    tryDraw(ctx.measureText(jobsText).width + 20, () => {
      ctx.fillStyle = jobCount > 0 ? TEXT_COLOR : DIM_COLOR;
      ctx.fillText(jobsText, x, midY);
    });
  }

  // Per-trait capacity (D5: compute alone hid RAM/storage pressure that could bottleneck
  // placement even while CPU still had headroom).
  ctx.font = '13px sans-serif';
  for (const key of TRAIT_KEYS) {
    const total = utilization.traitsTotal[key];
    const used = total - utilization.traitsFree[key];
    const over = used > total;
    const traitText = `${TRAIT_LABELS[key]} ${used}/${total}`;
    const textWidth = ctx.measureText(traitText).width;
    tryDraw(textWidth + 6 + 36 + 16, () => {
      ctx.fillStyle = over ? RED : TEXT_COLOR;
      ctx.fillText(traitText, x, midY);
      drawInlineBar(ctx, x + textWidth + 6, midY - 4, 36, 8, total > 0 ? used / total : 0, over ? RED : GREEN);
    });
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
    const parts: string[] = [];
    if (trippedCount > 0) parts.push(`⛔ ${trippedCount} overheated`);
    if (throttledCount > 0) parts.push(`🌡 ${throttledCount} throttled`);
    const overheatText = parts.join('  ');
    tryDraw(ctx.measureText(overheatText).width + 20, () => {
      ctx.fillStyle = trippedCount > 0 ? RED : AMBER;
      ctx.fillText(overheatText, x, midY);
    });
  }

  // Failure alert (.plans/hardware-failure.md D7) — a failed machine never recovers on its
  // own, so this must stay visible until the player actually walks over and repairs it, not
  // just flash and fade like the overheat warning above.
  const failedCount = world.query(faileds).length;
  if (failedCount > 0) {
    ctx.font = 'bold 13px sans-serif';
    const failedText = `⚠ ${failedCount} failed`;
    tryDraw(ctx.measureText(failedText).width + 20, () => {
      ctx.fillStyle = RED;
      ctx.fillText(failedText, x, midY);
    });
  }

  // Inventory summary — total owned-but-unplaced stock (D5), bought at the shop.
  const inventory = world.getComponent(inventories, facility);
  if (inventory) {
    const totalStock = Object.values(inventory.counts).reduce(
      (sum: number, count) => sum + (count ?? 0),
      0,
    );
    const inventoryText = `📦 ${totalStock} in stock`;
    tryDraw(ctx.measureText(inventoryText).width + 20, () => {
      ctx.fillStyle = totalStock > 0 ? TEXT_COLOR : DIM_COLOR;
      ctx.fillText(inventoryText, x, midY);
    });
  }

  // Personal-best counters (cheap, already tracked) — lowest priority, first to drop.
  const clock = world.getComponent(demandClocks, facility);
  if (clock) {
    const clockText = `served ${clock.contractsServed}  peak ${clock.peakComputeServed}`;
    tryDraw(ctx.measureText(clockText).width, () => {
      ctx.fillStyle = DIM_COLOR;
      ctx.fillText(clockText, x, midY);
    });
  }
}

interface WorkloadRow {
  id: EntityId;
  workload: Workload;
}

// A running workload's deadline never stops ticking (workload-run.ts), independent of its
// work-remaining countdown — a job can be provably doomed (deadline will hit zero before the
// work finishes) while still showing a healthy green progress bar, if only work-remaining is on
// screen. See .plans/playtest-findings.md B4.
function drawActiveJobRow(
  ctx: CanvasRenderingContext2D,
  workload: Workload,
  rect: { x: number; y: number; width: number },
): void {
  const archetype = WORKLOAD_ARCHETYPES[workload.archetypeId];
  const doomed = workload.workRemainingSeconds > workload.deadlineRemainingSeconds;
  const fraction = 1 - workload.workRemainingSeconds / workload.workSeconds;
  const remaining = Math.max(0, Math.ceil(workload.workRemainingSeconds));
  const deadlineRemaining = Math.max(0, Math.ceil(workload.deadlineRemainingSeconds));
  const padX = 10;
  const line1Y = rect.y + 12;
  const line2Y = rect.y + 30;
  const line3Y = rect.y + 47;

  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = doomed ? RED : TEXT_COLOR;
  ctx.fillText(archetype.label + cycleLabel(workload), rect.x + padX, line1Y);

  const barWidth = 70;
  const barX = rect.x + rect.width - padX - barWidth - 34;
  drawInlineBar(ctx, barX, line1Y - 4, barWidth, 8, fraction, doomed ? RED : GREEN);
  ctx.textAlign = 'right';
  ctx.fillStyle = doomed ? RED : DIM_COLOR;
  ctx.fillText(`${remaining}s`, rect.x + rect.width - padX, line1Y);

  // Full trait breakdown, not just CPU — the jobs panel's whole point is "all available stats",
  // where the old docked corner panel only had room for one trait.
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = doomed ? RED : GREEN;
  const demandsText = TRAIT_KEYS.map((key) => `${TRAIT_LABELS[key]} ${workload.demands[key]}`).join(
    ' · ',
  );
  ctx.fillText(`$${workload.payPerSecond.toFixed(2)}/s · ${demandsText}`, rect.x + padX, line2Y);
  ctx.textAlign = 'right';
  ctx.fillStyle = doomed ? RED : AMBER;
  ctx.fillText(`⏱ ${deadlineRemaining}s`, rect.x + rect.width - padX, line2Y);

  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = RED;
  ctx.fillText(`-$${workload.penaltyOnMiss.toFixed(0)} if missed`, rect.x + padX, line3Y);
  if (workload.repeatTotal > 1) {
    ctx.textAlign = 'right';
    ctx.fillStyle = AMBER;
    ctx.fillText(`recurring · ${workload.repeatTotal} cycles`, rect.x + rect.width - padX, line3Y);
  }
}

function drawPendingJobRow(
  ctx: CanvasRenderingContext2D,
  workload: Workload,
  rect: { x: number; y: number; width: number },
  utilization: { traitsFree: Workload['demands'] },
): void {
  const archetype = WORKLOAD_ARCHETYPES[workload.archetypeId];
  const escalated = workload.deadlineRemainingSeconds < 5;
  const padX = 10;
  const line1Y = rect.y + 12;
  const line2Y = rect.y + 30;
  const line3Y = rect.y + 47;

  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = escalated ? RED : AMBER;
  ctx.fillText(`⚠ ${archetype.label}${cycleLabel(workload)}`, rect.x + padX, line1Y);
  ctx.textAlign = 'right';
  ctx.fillText(
    `${Math.max(0, Math.ceil(workload.deadlineRemainingSeconds))}s`,
    rect.x + rect.width - padX,
    line1Y,
  );

  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = DIM_COLOR;
  const shortfallText = TRAIT_KEYS.map((key) => {
    const need = workload.demands[key];
    const free = utilization.traitsFree[key];
    return `${TRAIT_LABELS[key]} ${need}${free < need ? '!' : ''}`;
  }).join(' · ');
  ctx.fillText(`$${workload.payPerSecond.toFixed(2)}/s · ${shortfallText}`, rect.x + padX, line2Y);

  // .plans/contract-variety.md D1: the miss penalty rides along with the shortfall — the
  // number the "can I actually place this in time" risk assessment turns on.
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = RED;
  ctx.fillText(`-$${workload.penaltyOnMiss.toFixed(0)} if missed`, rect.x + padX, line3Y);
  if (workload.repeatTotal > 1) {
    ctx.textAlign = 'right';
    ctx.fillStyle = AMBER;
    ctx.fillText(`recurring · ${workload.repeatTotal} cycles`, rect.x + rect.width - padX, line3Y);
  }
}

// Jobs modal — a scrollable, never-truncated list of every accepted job (unplaced + running)
// with full stats, opened by the 'j' key (job-panels.ts). Replaces the old always-docked corner
// panel, which capped/truncated the ACTIVE section against a fixed row budget — this one just
// scrolls instead. See .plans/job-panels.md.
function drawJobsModal(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
): void {
  if (!isJobsModalOpen(world, controlled)) return;

  const ctx = renderer.context;
  const canvasWidth = renderer.width;
  const canvasHeight = renderer.height;

  const utilization = world.getComponent(utilizations, facility);
  if (!utilization) return;

  const active: WorkloadRow[] = [];
  const pending: WorkloadRow[] = [];
  for (const id of world.query(workloads)) {
    const workload = world.getComponent(workloads, id)!;
    if (workload.state === 'running') active.push({ id, workload });
    else pending.push({ id, workload });
  }
  active.sort((a, b) => a.id - b.id);
  pending.sort((a, b) => a.id - b.id);

  const contentHeight = getJobsModalContentHeight(pending.length, active.length);

  // Dim the floor behind the panel so it reads as a modal overlay — same treatment as the
  // rack/shop panels.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const modal = getJobsModalRect(canvasWidth, canvasHeight, contentHeight);
  ctx.fillStyle = 'rgba(24, 27, 31, 0.97)';
  ctx.fillRect(modal.x, modal.y, modal.width, modal.height);
  ctx.strokeStyle = '#3a3f47';
  ctx.lineWidth = 1;
  ctx.strokeRect(modal.x, modal.y, modal.width, modal.height);

  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText('Jobs — accepted, in progress', modal.x + JOBS_MODAL_PADDING, modal.y + 25);

  const closeRect = getJobsModalCloseButtonRect(canvasWidth, canvasHeight, contentHeight);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(closeRect.x, closeRect.y, closeRect.width, closeRect.height);
  ctx.textAlign = 'center';
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('×', closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2);

  // Content clipped and translated by -scroll, same pattern as the rack panel's own scrollable
  // region (render.ts's drawRackPanel).
  const contentRect = getJobsModalContentRect(canvasWidth, canvasHeight, contentHeight);
  const maxScroll = maxScrollOffset(contentHeight, contentRect.height);
  const scrollOffsetPx = Math.min(
    world.getComponent(jobsPanelScrolls, controlled)?.offsetPx ?? 0,
    maxScroll,
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(contentRect.x, contentRect.y, contentRect.width, contentRect.height);
  ctx.clip();
  ctx.translate(0, -scrollOffsetPx);

  let y = contentRect.y;

  if (pending.length === 0 && active.length === 0) {
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText(
      'No accepted jobs yet — open Offers [O] to take one.',
      contentRect.x + 10,
      y + JOBS_MODAL_ROW_HEIGHT / 2,
    );
  }

  if (pending.length > 0) {
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText('UNPLACED', contentRect.x + 10, y + JOBS_MODAL_HEADER_ROW_HEIGHT / 2);
    y += JOBS_MODAL_HEADER_ROW_HEIGHT;
    for (const { workload } of pending) {
      drawPendingJobRow(
        ctx,
        workload,
        { x: contentRect.x, y, width: contentRect.width },
        utilization,
      );
      y += JOBS_MODAL_ROW_HEIGHT;
    }
  }

  if (active.length > 0) {
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText('ACTIVE', contentRect.x + 10, y + JOBS_MODAL_HEADER_ROW_HEIGHT / 2);
    y += JOBS_MODAL_HEADER_ROW_HEIGHT;
    for (const { workload } of active) {
      drawActiveJobRow(ctx, workload, { x: contentRect.x, y, width: contentRect.width });
      y += JOBS_MODAL_ROW_HEIGHT;
    }
  }

  ctx.restore();
}

function drawOfferCard(
  world: World,
  renderer: Renderer,
  offerId: EntityId,
  offer: Offer,
  controlled: EntityId,
): void {
  const ctx = renderer.context;
  const card = getOffersModalCardRect(offer.slot, renderer.width, renderer.height);
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
  ctx.fillText(
    `${Math.max(0, Math.ceil(offer.secondsRemaining))}s`,
    card.x + card.width - padX,
    textY,
  );

  textY += 14;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = DIM_COLOR;
  const demandsText = TRAIT_KEYS.map((key) => `${TRAIT_LABELS[key]} ${offer.demands[key]}`).join(
    ' · ',
  );
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

  // .plans/playtest-findings.md F3: an unservable offer's Accept button shows a "Confirm?" state
  // once AcceptConfirm is set for THIS offer (input.ts) — the same "second click on the same
  // button, within a window" shape as DecommissionConfirm's own visual.
  const acceptConfirm = world.getComponent(acceptConfirms, controlled);
  const confirmingAccept =
    !servable && acceptConfirm?.offerId === offerId && performance.now() < acceptConfirm.expiresAtMs;

  const acceptRect = getOffersModalButtonRect(offer.slot, 'accept', renderer.width, renderer.height);
  ctx.fillStyle = confirmingAccept ? '#6f3a2f' : '#2f6f4f';
  ctx.fillRect(acceptRect.x, acceptRect.y, acceptRect.width, acceptRect.height);
  ctx.strokeStyle = confirmingAccept ? AMBER : GREEN;
  ctx.strokeRect(acceptRect.x, acceptRect.y, acceptRect.width, acceptRect.height);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    confirmingAccept ? 'Confirm ×' : 'Accept',
    acceptRect.x + acceptRect.width / 2,
    acceptRect.y + acceptRect.height / 2,
  );

  const declineRect = getOffersModalButtonRect(
    offer.slot,
    'decline',
    renderer.width,
    renderer.height,
  );
  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(declineRect.x, declineRect.y, declineRect.width, declineRect.height);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(declineRect.x, declineRect.y, declineRect.width, declineRect.height);
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(
    'Decline',
    declineRect.x + declineRect.width / 2,
    declineRect.y + declineRect.height / 2,
  );

  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// Offers modal — a scrollable list of offer cards, opened by the 'o' key (job-panels.ts).
// Replaces the old always-docked column: each card still renders at its own stable slot (see
// the module comment above getOffersModalCardRect in ui/layout.ts and .plans/playtest-findings.md
// F6) rather than a position in a sorted-by-id array, so a button's position can never silently
// shift under the pointer between the frame the panel was drawn and the frame a click on it is
// processed. See .plans/job-panels.md.
function drawOffersModal(world: World, renderer: Renderer, controlled: EntityId): void {
  if (!isOffersModalOpen(world, controlled)) return;

  const ctx = renderer.context;
  const canvasWidth = renderer.width;
  const canvasHeight = renderer.height;

  // Dim the floor behind the panel so it reads as a modal overlay — same treatment as the
  // rack/shop panels.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const modal = getOffersModalRect(canvasWidth, canvasHeight);
  ctx.fillStyle = 'rgba(24, 27, 31, 0.97)';
  ctx.fillRect(modal.x, modal.y, modal.width, modal.height);
  ctx.strokeStyle = '#3a3f47';
  ctx.lineWidth = 1;
  ctx.strokeRect(modal.x, modal.y, modal.width, modal.height);

  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText('Offers — jobs available to accept', modal.x + 14, modal.y + 25);

  const closeRect = getOffersModalCloseButtonRect(canvasWidth, canvasHeight);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(closeRect.x, closeRect.y, closeRect.width, closeRect.height);
  ctx.textAlign = 'center';
  ctx.fillStyle = DIM_COLOR;
  ctx.fillText('×', closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2);

  const contentRect = getOffersModalContentRect(canvasWidth, canvasHeight);
  const contentHeight = getOffersModalFullContentHeight();
  const maxScroll = maxScrollOffset(contentHeight, contentRect.height);
  const scrollOffsetPx = Math.min(
    world.getComponent(offersPanelScrolls, controlled)?.offsetPx ?? 0,
    maxScroll,
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(contentRect.x, contentRect.y, contentRect.width, contentRect.height);
  ctx.clip();
  ctx.translate(0, -scrollOffsetPx);

  const offerIds = world.query(offers);
  if (offerIds.length === 0) {
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = DIM_COLOR;
    ctx.fillText(
      'No offers right now — check back soon.',
      contentRect.x,
      contentRect.y + OFFER_BUTTON_HEIGHT,
    );
  } else {
    // Each offer carries its own stable slot (see Offer.slot) — no positional indexing here, so
    // an earlier offer expiring doesn't shift a later one's card into a different slot mid-read.
    for (const offerId of offerIds) {
      const offer = world.getComponent(offers, offerId)!;
      drawOfferCard(world, renderer, offerId, offer, controlled);
    }
  }

  ctx.restore();
}

// Toast stack (F4/F7) — stacked in spawn order, newest at the bottom (offers/hud precedent is
// top-to-bottom for stable-slotted content; toasts have no slot, so spawn order is the only
// stable ordering). Fades over the back half of its lifetime rather than a hard cutoff.
function drawToasts(world: World, renderer: Renderer): void {
  const ctx = renderer.context;
  const now = performance.now();
  const ids = world.query(toasts).sort((a, b) => a - b);

  ids.forEach((id, index) => {
    const toast = world.getComponent(toasts, id)!;
    const rect = getToastRect(index, renderer.width);
    const total = toast.expiresAtMs - toast.spawnedAtMs;
    const remaining = toast.expiresAtMs - now;
    const alpha = total > 0 ? Math.min(1, Math.max(0, remaining / (total * 0.4))) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(20, 22, 25, 0.95)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = toast.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(toast.text, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width - 16);
    ctx.restore();
  });
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
  controlled: EntityId,
  facility: EntityId,
  audio: Audio,
  camera: Camera,
): System {
  return {
    update() {
      drawTopBar(world, renderer, facility);
      drawMuteButton(renderer, audio);
      drawRecenterButton(renderer, camera);
      drawOffersModal(world, renderer, controlled);
      drawJobsModal(world, renderer, controlled, facility);
      drawToasts(world, renderer);
      drawTutorialBanner(world, renderer, facility);
    },
  };
}
