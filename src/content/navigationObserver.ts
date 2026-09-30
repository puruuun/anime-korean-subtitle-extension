export function observeNavigation(callback: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      callback();
    }, 100);
  };
  const observer = new MutationObserver(check);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-episode', 'class'],
  });
  window.addEventListener('popstate', check);
  window.addEventListener('animesub:navigation', check);
  const interval = setInterval(check, 1000);
  return () => {
    observer.disconnect();
    clearInterval(interval);
    clearTimeout(timer);
    window.removeEventListener('popstate', check);
    window.removeEventListener('animesub:navigation', check);
  };
}
