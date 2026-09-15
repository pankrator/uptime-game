// Pre-game landing screen: plain DOM/CSS, not canvas — it exists entirely before the ECS
// world/game loop starts, so it isn't a "game entity" the render system needs to own.
export function showLanding(container: HTMLElement, onStart: () => void): void {
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
  container.appendChild(panel);

  startButton.focus();
}

export function hideLanding(container: HTMLElement): void {
  container.hidden = true;
  container.innerHTML = '';
  container.className = '';
}
