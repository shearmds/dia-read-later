// Hyper-; (⌃⌥⇧⌘;) saves the page, alongside the `save-page` command.
//
// This exists because Chrome's `commands` cannot express it: a shortcut may not
// use all four modifiers, and `;` is not an allowed key at all. Listening in the
// page has the costs a real command does not — it only fires while the page has
// focus (not in the address bar, not on chrome:// pages), and a global hotkey
// registered elsewhere on the same combination takes it before the page sees it.
//
// `code`, not `key`: with Option held, `key` is whatever character the layout
// produces, not ";".
window.addEventListener('keydown', (event) => {
    if (event.code !== 'Semicolon' || event.repeat) return;
    if (!(event.ctrlKey && event.altKey && event.shiftKey && event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();
    chrome.runtime.sendMessage({ action: 'savePage' });
}, true);
