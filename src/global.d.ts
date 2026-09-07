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

declare module '@paystack/inline-js' {
  interface PaystackInlineResponse {
    reference?: string;
    status?: string;
    trans?: string;
    transaction?: string;
    message?: string;
    [key: string]: unknown;
  }
  interface PaystackProps {
    key: string;
    email: string;
    amount: number;
    currency?: string;
    ref?: string;
    metadata?: Record<string, unknown>;
    onSuccess?: (response: PaystackInlineResponse) => void;
    onCancel?: () => void;
    onError?: (error: Error) => void;
    [key: string]: unknown;
  }
  class PaystackPop {
    newTransaction(config: PaystackProps): void;
  }
  const PaystackInline: {
    setup(props: PaystackProps & { container?: string | HTMLElement }): unknown;
    onSuccess(...args: unknown[]): unknown;
    onCancel(...args: unknown[]): unknown;
    onError(...args: unknown[]): unknown;
  };
  export default PaystackInline;
}

declare module 'react-scroll' {
  import type React from 'react';
  export const Link: React.FC<Record<string, unknown>>;
  export const Events: {
    scrollEvent: { register(args: Record<string, unknown>): void; remove(...args: unknown[]): void };
  };
  export const scroller: {
    scrollTo(target: string, options?: Record<string, unknown>): void;
  };
  export const animateScroll: {
    scrollToTop(options?: Record<string, unknown>): void;
    scrollToBottom(options?: Record<string, unknown>): void;
  };
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