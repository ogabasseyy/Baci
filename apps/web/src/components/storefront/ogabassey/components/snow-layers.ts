/** Flake layout and motion for each CSS snow layer. */

export interface SnowLayer {
  /** Tile edge in px; also the distance fallen per loop. */
  tile: number;
  /** Fall speed in px per second, independent of screen refresh rate. */
  speed: number;
  /** Sideways drift at mid-loop, in px. */
  sway: number;
  /** Flakes as [x, y, radius] within the tile. */
  flakes: ReadonlyArray<readonly [number, number, number]>;
}

export const SNOW_LAYERS: readonly SnowLayer[] = [
  {
    tile: 430,
    speed: 70,
    sway: 18,
    flakes: [
      [37, 64, 4],
      [212, 17, 3.5],
      [389, 141, 4],
      [118, 233, 3.5],
      [301, 322, 4],
      [64, 397, 3.5],
    ],
  },
  {
    tile: 330,
    speed: 50,
    sway: -14,
    flakes: [
      [21, 187, 2.5],
      [97, 41, 3],
      [163, 262, 2.5],
      [208, 113, 2],
      [279, 219, 3],
      [301, 18, 2],
      [58, 311, 2.5],
    ],
  },
  {
    tile: 270,
    speed: 35,
    sway: 10,
    flakes: [
      [14, 31, 1.5],
      [89, 148, 2],
      [143, 67, 1.5],
      [231, 193, 2],
      [187, 251, 1.5],
      [52, 222, 1.5],
    ],
  },
];
