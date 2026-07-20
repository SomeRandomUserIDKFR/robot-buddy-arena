import { CEILING, SIZE, WORLD } from "./config.js";
import { clamp, lerp } from "./utils.js";

export function cameraTarget(player, viewport) {
  const lead = clamp(player.cameraLead || 0, 0, .4);
  const horizontal = Math.min(viewport.width * lead, viewport.width * .4);
  const vertical = Math.min(viewport.height * lead, viewport.height * .35);
  const centerX = player.x + SIZE / 2 + Math.cos(player.aim || 0) * horizontal;
  const centerY = player.y + SIZE / 2 + Math.sin(player.aim || 0) * vertical;
  return {
    x: clamp(centerX - viewport.width / 2, 0, Math.max(0, WORLD.w - viewport.width)),
    y: clamp(
      centerY - viewport.height / 2,
      Math.min(CEILING, Math.max(0, WORLD.h - viewport.height)),
      Math.max(0, WORLD.h - viewport.height)
    )
  };
}

export function updateCamera(camera, player, viewport, dt) {
  const target = cameraTarget(player, viewport);
  const alpha = 1 - Math.exp(-Math.max(0, dt) / .27);
  camera.x = clamp(
    lerp(camera.x, target.x, alpha),
    0,
    Math.max(0, WORLD.w - viewport.width)
  );
  camera.y = clamp(
    lerp(camera.y, target.y, alpha),
    Math.min(CEILING, Math.max(0, WORLD.h - viewport.height)),
    Math.max(0, WORLD.h - viewport.height)
  );
  return camera;
}
