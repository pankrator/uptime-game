// Pre-game landing screen: plain DOM/CSS, not canvas — it exists entirely before the ECS
// world/game loop starts, so it isn't a "game entity" the render system needs to own.
//
// The landing module itself stays free of both env checks (the dev stress button) and save-
// storage access (the slot list) — main.ts computes `slots` (via SaveManager.describeSlots)
// and gates `onStartStress` (DEV-only) before calling in, so this stays usable/testable on its
// own.

export interface SaveSlotSummary {
  slot: string;
  label: string;
  occupied: boolean;
  // Only read when `occupied` — Date.now() at the time that slot was last written.
  savedAt?: number;
}

export interface LandingCallbacks {
  onNewGame: (slot: string) => void;
  onContinue: (slot: string) => void;
  onStartStress?: () => void;
}

export function showLanding(
  container: HTMLElement,
  slots: SaveSlotSummary[],
  callbacks: LandingCallbacks,
): void {
  container.innerHTML = '';
  container.className = 'landing';

  const bg = document.createElement('div');
  bg.className = 'landing-bg';
  container.appendChild(bg);

  const panel = document.createElement('div');
  panel.className = 'landing-panel';

  const logo = document.createElement('div');
  logo.className = 'landing-logo';
  logo.innerHTML = `
    <span class="landing-logo-icon" aria-hidden="true">
      <span class="rack-led"></span>
      <span class="rack-led"></span>
      <span class="rack-led"></span>
    </span>
    <span class="landing-logo-text">UPTIME</span>
  `;

  const tagline = document.createElement('p');
  tagline.className = 'landing-tagline';
  tagline.textContent = 'Build. Balance. Keep it running.';

  panel.appendChild(logo);
  panel.appendChild(tagline);

  const slotList = document.createElement('div');
  slotList.className = 'landing-slots';

  // Continuing an occupied slot is the default action a returning player wants; starting fresh
  // (empty slot or not) is always available but never the thing autofocus lands on unless
  // every slot is empty.
  let focusTarget: HTMLButtonElement | undefined;

  for (const slot of slots) {
    const row = document.createElement('div');
    row.className = 'landing-slot';

    const info = document.createElement('div');
    info.className = 'landing-slot-info';

    const title = document.createElement('div');
    title.className = 'landing-slot-title';
    title.textContent = slot.label;
    info.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'landing-slot-meta';
    meta.textContent =
      slot.occupied && slot.savedAt !== undefined
        ? `Saved ${new Date(slot.savedAt).toLocaleString()}`
        : 'Empty';
    info.appendChild(meta);

    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'landing-slot-actions';

    if (slot.occupied) {
      const continueButton = document.createElement('button');
      continueButton.type = 'button';
      continueButton.className = 'landing-slot-button landing-slot-button--primary';
      continueButton.textContent = 'CONTINUE';
      continueButton.addEventListener('click', () => callbacks.onContinue(slot.slot));
      actions.appendChild(continueButton);
      focusTarget ??= continueButton;

      const newGameButton = document.createElement('button');
      newGameButton.type = 'button';
      newGameButton.className = 'landing-slot-button landing-slot-button--secondary';
      newGameButton.textContent = 'NEW GAME';
      newGameButton.addEventListener('click', () => {
        // Starting fresh in an occupied slot destroys that save the next time it's written (the
        // old data isn't cleared up front, but nothing stops the running game from being saved
        // right back over it) — a confirm before committing to that is standard save-slot UX
        // and needs no custom modal to get right.
        if (
          window.confirm(
            `Start a new game in ${slot.label}? This will overwrite the existing save.`,
          )
        ) {
          callbacks.onNewGame(slot.slot);
        }
      });
      actions.appendChild(newGameButton);
    } else {
      const newGameButton = document.createElement('button');
      newGameButton.type = 'button';
      newGameButton.className = 'landing-slot-button landing-slot-button--primary';
      newGameButton.textContent = 'NEW GAME';
      newGameButton.addEventListener('click', () => callbacks.onNewGame(slot.slot));
      actions.appendChild(newGameButton);
      focusTarget ??= newGameButton;
    }

    row.appendChild(actions);
    slotList.appendChild(row);
  }

  panel.appendChild(slotList);

  if (callbacks.onStartStress) {
    const stressButton = document.createElement('button');
    stressButton.type = 'button';
    stressButton.className = 'landing-start-stress';
    stressButton.textContent = 'DEV: START WITH BIG SETUP';
    stressButton.addEventListener('click', callbacks.onStartStress);
    panel.appendChild(stressButton);
  }

  container.appendChild(panel);

  focusTarget?.focus();
}

export function hideLanding(container: HTMLElement): void {
  container.hidden = true;
  container.innerHTML = '';
  container.className = '';
}
