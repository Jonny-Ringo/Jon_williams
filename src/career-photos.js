const photoLinks = document.querySelectorAll('[data-work-photo]');

if (photoLinks.length) {
  const dialog = document.createElement('dialog');
  dialog.className = 'career-photo-dialog';
  dialog.setAttribute('aria-labelledby', 'career-photo-title');
  dialog.innerHTML = `<header><h2 id="career-photo-title"></h2><button type="button" class="career-photo-close" autofocus>Close</button></header><div class="career-photo-content"></div>`;
  document.body.append(dialog);

  const content = dialog.querySelector('.career-photo-content');
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    )
      dialog.close();
  });
  dialog.addEventListener('close', () => {
    // A queued close event may arrive after another photo has already opened.
    if (!dialog.open) content.replaceChildren();
  });

  photoLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0)
        return;
      event.preventDefault();
      const source = link.querySelector('img');
      const image = document.createElement('img');
      image.src = link.href;
      image.alt = source.alt;
      const caption = document.createElement('p');
      caption.textContent = source.alt;
      dialog.querySelector('h2').textContent = link
        .closest('figure')
        .querySelector('h3').textContent;
      content.replaceChildren(image, caption);
      dialog.showModal();
    });
  });
}
