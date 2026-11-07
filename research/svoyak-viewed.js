// Shared by the catalog and ranked report; choices stay in this browser.
(() => {
  const storageKey = 'svoyak-viewed-categories-v1';
  const keyFor = name => name.normalize('NFKC').trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const read = () => {
    const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return new Set(Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
  };
  let viewed;
  try { viewed = read(); } catch { viewed = new Set(); }

  const sync = () => {
    document.querySelectorAll('input[data-viewed-category]').forEach(input => {
      input.checked = viewed.has(input.dataset.viewedCategory);
    });
  };
  window.svoyakViewed = {
    cell(name) {
      const key = keyFor(name);
      return `<td class="viewed-cell"><label class="viewed-label"><input type="checkbox" data-viewed-category="${escape(key)}" aria-label="Viewed: ${escape(name)}"${viewed.has(key) ? ' checked' : ''}><span>Viewed</span></label></td>`;
    }
  };
  document.addEventListener('change', event => {
    const input = event.target;
    if (!input.matches('input[data-viewed-category]')) return;
    try { viewed = read(); } catch { /* Keep in-memory choices if storage is unavailable. */ }
    if (input.checked) viewed.add(input.dataset.viewedCategory);
    else viewed.delete(input.dataset.viewedCategory);
    const notice = document.getElementById('viewed-storage-notice');
    try {
      localStorage.setItem(storageKey, JSON.stringify([...viewed]));
      if (notice) notice.hidden = true;
    } catch {
      if (notice) notice.hidden = false;
    }
    sync();
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    try { viewed = read(); sync(); } catch { /* Retain current choices. */ }
  });
})();
