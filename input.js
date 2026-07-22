export const keys = Object.create(null);
export const mouse = { x: 0, y: 0, down: false, right: false };

export function installInput(canvas, onKeyDown, onKeyUp, onWheel) {
  addEventListener("keydown", (event) => {
    keys[event.code] = true;
    onKeyDown?.(event);
  });
  addEventListener("keyup", (event) => {
    keys[event.code] = false;
    onKeyUp?.(event);
  });
  // Lost focus can miss keyup — clear held keys so channel/hold actions release.
  addEventListener("blur", () => {
    for (const code of Object.keys(keys)) keys[code] = false;
    mouse.down = false;
    mouse.right = false;
  });
  canvas.addEventListener("mousemove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - bounds.left) * canvas.width / bounds.width;
    mouse.y = (event.clientY - bounds.top) * canvas.height / bounds.height;
  });
  canvas.addEventListener("mousedown", (event) => {
    if (event.button === 0) mouse.down = true;
    if (event.button === 2) mouse.right = true;
  });
  addEventListener("mouseup", (event) => {
    if (event.button === 0) mouse.down = false;
    if (event.button === 2) mouse.right = false;
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  // Secondary weapon swap: capture so the page does not scroll while fighting.
  if (onWheel) {
    canvas.addEventListener("wheel", (event) => onWheel(event), { passive: false });
  }
}
