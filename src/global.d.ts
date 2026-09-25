// Ambient declarations for JS libraries that ship without types.

declare module 'aos' {
  interface AosOptions {
    duration?: number;
    easing?: string;
    once?: boolean;
    offset?: number;
    delay?: number;
    mirror?: boolean;
    anchorPlacement?: string;
    startEvent?: string;
    [key: string]: unknown;
  }
  const AOS: {
    init(options?: AosOptions): void;
    refresh(): void;
    refreshHard(): void;
  };
  export default AOS;
}

declare module 'slick-carousel' {
  import type Component from 'react';
  const Slider: Component.ComponentType<Record<string, unknown>>;
  export = Slider;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}