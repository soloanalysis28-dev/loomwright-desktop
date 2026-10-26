// Desktop integration for the embedded interface.
//
// The page was written for a browser tab and a Codespaces server. In the
// desktop build the assets live in the executable and there is no remote
// server, so this script replaces the two places whose wording describes the
// browser deployment: the "prepare offline" row and the development Git sync
// card. Nothing is hidden that the user needs; nothing new is invented.
(() => {
  if (window.__LOOMWRIGHT_DESKTOP__) return;
  window.__LOOMWRIGHT_DESKTOP__ = true;

  const RELEASES = 'https://github.com/soloanalysis28-dev/loomwright-desktop/releases';
  const OFFLINE_STATUS = 'Installed · works offline';

  const text = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };

  function patchStorage() {
    const pane = document.getElementById('settings-panel-storage');
    if (!pane) return;

    text(
      pane.querySelector('.settings-pane-heading p'),
      'Loomwright is installed on this device. Its application files are built into the app, so it works without a connection.',
    );

    const prepare = document.getElementById('prepare-offline');
    const install = document.getElementById('install-app');
    if (prepare) prepare.remove();
    if (install) install.remove();

    const status = document.getElementById('offline-app-status');
    const row = status && status.closest('.setting-row');
    if (row) {
      text(row.querySelector('strong'), 'Application files');
      text(
        row.querySelector('small'),
        'Bundled with Loomwright — nothing to download, and no connection needed.',
      );
    }
    text(status, OFFLINE_STATUS);

    text(
      document.getElementById('storage-note'),
      'Projects are saved on this device. Two Loomwright windows share them through the app’s local service — nothing leaves this machine.',
    );

    const shareRow = pane.querySelectorAll('.setting-row')[1];
    if (shareRow) {
      text(shareRow.querySelector('strong'), 'Project sharing');
      text(
        shareRow.querySelector('small'),
        'Windows of Loomwright on this device share projects. There is no cloud account and no port to keep private.',
      );
      text(shareRow.querySelector('button'), 'This device');
    }
  }

  function patchAbout() {
    const versionNote = document.querySelector('.about-version-row small');
    text(versionNote, 'This is the version running on this device.');

    const card = document.querySelector('.about-git-card');
    if (!card || card.dataset.desktop === 'updates') return;
    card.dataset.desktop = 'updates';
    card.replaceChildren();

    const heading = document.createElement('div');
    heading.className = 'about-git-heading';
    heading.innerHTML =
      '<div><strong>Updates</strong><small>Desktop builds are updated by running a newer Loomwright installer. Your manuscripts stay where they are.</small></div>' +
      '<span class="about-git-badge">Desktop</span>';

    const actions = document.createElement('div');
    actions.className = 'about-git-actions';
    const link = document.createElement('a');
    link.className = 'secondary-button';
    link.href = RELEASES;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open releases page';
    actions.appendChild(link);

    const note = document.createElement('p');
    note.className = 'about-git-note';
    note.textContent = 'Running in a desktop window · WebView2 engine.';

    card.append(heading, actions, note);
  }

  // The page still speaks of "this browser" in a few places. Rewrite those
  // phrases inside Settings only, and point the source link at this repository.
  const WORDING = [
    [/saved for this browser/gi, 'saved on this device'],
    [/stays in your browser/gi, 'stays on this device'],
    [/running in this browser/gi, 'running on this device'],
    [/private workspace store used by this app/gi, 'local project store used by this app'],
    [
      /sync with the private workspace store when connected/gi,
      'and are shared between windows on this device',
    ],
  ];

  function patchWording() {
    const view = document.getElementById('view-settings');
    if (!view) return;
    const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let value = node.nodeValue;
      for (const [pattern, replacement] of WORDING) value = value.replace(pattern, replacement);
      if (value !== node.nodeValue) node.nodeValue = value;
    }
    for (const link of view.querySelectorAll('a')) {
      if (link.textContent.trim().toLowerCase() === 'source code') {
        link.href = 'https://github.com/soloanalysis28-dev/loomwright-desktop';
      }
    }
  }

  function apply() {
    try {
      patchStorage();
      patchAbout();
      patchWording();
    } catch (error) {
      console.warn('Desktop copy patch skipped:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  }
  window.addEventListener('load', apply, { once: true });
  // The app finishes some asynchronous setup after load; re-assert once more.
  setTimeout(apply, 700);

  // If the page rewrites the offline status during start-up, keep the desktop
  // wording without watching the whole document.
  const status = document.getElementById('offline-app-status');
  if (status) {
    const observer = new MutationObserver(() => {
      if (status.textContent !== OFFLINE_STATUS) status.textContent = OFFLINE_STATUS;
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
  }
})();
