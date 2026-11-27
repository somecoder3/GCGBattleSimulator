// Svelte action for modal dialogs: the page underneath does not scroll while one is open (class
// "modal-open" on <html>, styles.css), and it is exactly where it was when the dialog goes away, also after
// the browser moved focus back to the element that opened it.

let open = 0;

export function modal(_node: HTMLElement) {
  const x = scrollX;
  const y = scrollY;
  if (open++ === 0) document.documentElement.classList.add("modal-open");
  return {
    destroy() {
      if (--open === 0) document.documentElement.classList.remove("modal-open");
      scrollTo({ left: x, top: y, behavior: "instant" });
    },
  };
}
