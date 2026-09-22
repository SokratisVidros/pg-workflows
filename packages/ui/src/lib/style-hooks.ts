'use client';

import { useRender } from '@base-ui/react/use-render';
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type JSX,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

/**
 * Base UI style hooks. `className` and `style` may be a value or a function of
 * the component state. `render` replaces the default element.
 */
export type ClassName<State> = string | ((state: State) => string | undefined);

export type StyleValue<State> = CSSProperties | ((state: State) => CSSProperties | undefined);

export type ElementStyleProps<State> = {
  className?: ClassName<State>;
  style?: StyleValue<State>;
  render?: useRender.RenderProp<State>;
};

/** `className` / `style` / `render` from a Base UI part, when that part defines them. */
export type PartProps<Props> = Partial<
  Pick<Props, Extract<'className' | 'style' | 'render', keyof Props>>
>;

/**
 * Keeps our chrome class and appends the consumer class. Function class names
 * are called by the Base UI part with that part's state.
 */
export function chainClassName<State>(
  base: string,
  className?: ClassName<State>,
): string | ((state: State) => string) {
  if (typeof className === 'function') {
    return (state: State) => {
      const extra = className(state);
      return extra ? `${base} ${extra}` : base;
    };
  }
  return className ? `${base} ${className}` : base;
}

type StyledElementProps<State extends object> = ElementStyleProps<State> & {
  tag?: keyof JSX.IntrinsicElements;
  state?: State;
  baseClassName?: string;
  children?: ReactNode;
  props?: Record<string, unknown>;
};

function resolveClassName<State>(className: ClassName<State> | undefined, state: State) {
  return typeof className === 'function' ? className(state) : className;
}

function resolveStyle<State>(style: StyleValue<State> | undefined, state: State) {
  return typeof style === 'function' ? style(state) : style;
}

function joinClassNames(base: string | undefined, extra: string | undefined) {
  if (base && extra) return `${base} ${extra}`;
  return extra || base;
}

/**
 * DOM root with Base UI's style hooks: state callbacks, `render`, and
 * `data-*` attributes derived from `state`.
 */
export const StyledElement = forwardRef(function StyledElement<State extends object>(
  {
    tag = 'div',
    state,
    className,
    style,
    render,
    baseClassName,
    children,
    props: domProps,
  }: StyledElementProps<State>,
  ref: ForwardedRef<HTMLElement>,
) {
  const current = (state ?? {}) as State;
  return useRender({
    defaultTagName: tag,
    render: render as useRender.RenderProp<Record<string, unknown>> | undefined,
    state: current as Record<string, unknown>,
    ref: ref ?? undefined,
    props: {
      ...domProps,
      className: joinClassNames(baseClassName, resolveClassName(className, current)),
      style: resolveStyle(style, current),
      children,
    },
  });
}) as <State extends object>(
  // Callers forward refs for several tags. `Ref` is invariant, so one element type cannot accept them all.
  // biome-ignore lint/suspicious/noExplicitAny: polymorphic root ref
  props: StyledElementProps<State> & { ref?: Ref<any> },
) => ReactElement;
