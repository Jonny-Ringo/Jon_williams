import '@fontsource-variable/manrope';
import './styles.css';
import './themes.css';
import { projects } from './projects.js';
import { startAnalytics } from './analytics/tracker.js';

startAnalytics();

// Keep old shared career links useful without adding extra browser-history entries.
function redirectLegacyCareerLink() {
  if (location.hash === '#career' && !document.body.classList.contains('career-page')) {
    location.replace(new URL('./career/', location.href).href);
  }
}
redirectLegacyCareerLink();
window.addEventListener('hashchange', redirectLegacyCareerLink);

document.querySelectorAll('[data-year]').forEach((element) => {
  element.textContent = new Date().getFullYear();
});

const copyButton = document.querySelector('[data-copy-email]');
copyButton?.addEventListener('click', async () => {
  const status = document.querySelector('.copy-status');
  try {
    await navigator.clipboard.writeText('jon.k.williams.711@gmail.com');
    status.textContent = 'Email copied!';
  } catch {
    status.textContent = 'Select the email address above to copy it, or click it to write to me.';
  }
});

const dialog = document.querySelector('.project-dialog');
if (dialog) {
  const content = document.querySelector('#project-dialog-content');
  const appendText = (tag, value, className) => {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    content.append(element);
    return element;
  };
  document.querySelectorAll('[data-project]').forEach((button) => {
    button.addEventListener('click', () => {
      const project = projects[button.dataset.project];
      if (!project) return;
      content.replaceChildren();
      appendText('p', project.category, 'eyebrow');
      appendText('h2', project.title).id = 'project-dialog-title';
      appendText('p', project.intro, 'dialog-intro');
      if (project.preview) {
        const figure = document.createElement('figure');
        figure.className = 'dialog-preview';
        const picture = document.createElement('picture');
        const darkSource = document.createElement('source');
        darkSource.media = '(prefers-color-scheme: dark)';
        darkSource.srcset = project.preview.darkSrc;
        const previewImage = document.createElement('img');
        previewImage.src = project.preview.src;
        previewImage.alt = project.preview.alt;
        previewImage.width = 1280;
        previewImage.height = 430;
        picture.append(darkSource, previewImage);
        const caption = document.createElement('figcaption');
        caption.textContent = project.preview.caption;
        figure.append(picture, caption);
        content.append(figure);
      }
      for (const [title, description] of project.sections) {
        appendText('h3', title);
        appendText('p', description);
      }
      for (const [label, url] of project.links) {
        const anchor = appendText('a', `${label} ↗`, 'text-link dialog-link');
        anchor.href = url;
        if (url.startsWith('https://')) {
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
        }
      }
      dialog.showModal();
      document.body.classList.add('dialog-open');
    });
  });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      dialog.close();
  });
  dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
}
