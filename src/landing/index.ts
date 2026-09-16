// Pre-game landing screen: plain DOM/CSS, not canvas — it exists entirely before the ECS
// world/game loop starts, so it isn't a "game entity" the render system needs to own.
//
// onStartStress is optional and caller-gated (main.ts only passes it in dev builds) — the
// landing module itself stays free of env checks so it's usable/testable on its own.
export function showLanding(
  container: HTMLElement,
  onStart: () => void,
  onStartStress?: () => void,
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

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'landing-start';
  startButton.textContent = 'START';
  startButton.addEventListener('click', onStart);

  panel.appendChild(logo);
  panel.appendChild(tagline);
  panel.appendChild(startButton);

  if (onStartStress) {
    const stressButton = document.createElement('button');
    stressButton.type = 'button';
    stressButton.className = 'landing-start-stress';
    stressButton.textContent = 'DEV: START WITH BIG SETUP';
    stressButton.addEventListener('click', onStartStress);
    panel.appendChild(stressButton);
  }

  container.appendChild(panel);

  startButton.focus();
}

export function hideLanding(container: HTMLElement): void {
  container.hidden = true;
  container.innerHTML = '';
  container.className = '';
}
