import '@testing-library/jest-dom/vitest';

// jsdom's PointerEvent is not constructable. Base UI dispatches one when a
// checkbox click is forwarded to its hidden input.
try {
  new window.PointerEvent('click');
} catch {
  window.PointerEvent = class PointerEvent extends MouseEvent {} as typeof window.PointerEvent;
}

// jsdom does not implement Pointer Capture; popup triggers rely on it.
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
}
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}
