export const MOBILE_WIDE_BREAKPOINT = 800;
export const MOBILE_TOUCH_TARGET = 44;
export const MOBILE_EDITOR_MIN_HEIGHT = 320;
export const MOBILE_BOTTOM_RAIL_MIN_HEIGHT = 66;

export function isWideViewport(width: number): boolean {
  return Number.isFinite(width) && width >= MOBILE_WIDE_BREAKPOINT;
}

export function meetsTouchTarget(width: number, height: number): boolean {
  return width >= MOBILE_TOUCH_TARGET && height >= MOBILE_TOUCH_TARGET;
}
