export const OVERVIEW_MAX_DISTANCE = 15;
export const FOCUS_CAMERA_PADDING = 1.2;
const MINIMUM_FOCUS_DISTANCE = 2.7;

/** @param {number} orbitalRadius */
export function getFocusCameraDistance(orbitalRadius) {
  return Math.max(
    MINIMUM_FOCUS_DISTANCE,
    orbitalRadius + FOCUS_CAMERA_PADDING,
  );
}
