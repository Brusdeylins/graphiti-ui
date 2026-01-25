declare module 'd3-force-3d' {
  export function forceX<T>(x?: number | ((d: T) => number)): {
    strength(strength: number | ((d: T) => number)): ReturnType<typeof forceX>;
  };
  export function forceY<T>(y?: number | ((d: T) => number)): {
    strength(strength: number | ((d: T) => number)): ReturnType<typeof forceY>;
  };
  export function forceZ<T>(z?: number | ((d: T) => number)): {
    strength(strength: number | ((d: T) => number)): ReturnType<typeof forceZ>;
  };
}
