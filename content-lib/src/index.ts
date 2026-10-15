/**
 * Standalone stand-in for the `@airo/content` library, which was not included
 * in the exported project. Pages only use ContentListContext, which in the
 * Airo editor tags a list for inline editing; outside the editor it just
 * renders its children unchanged.
 */
import { createElement, Fragment, type ReactNode } from 'react';

export interface ContentListContextProps {
  /** Content field path being rendered (editor metadata only). */
  field?: string;
  children?: ReactNode;
}

export function ContentListContext({ children }: ContentListContextProps) {
  return createElement(Fragment, null, children);
}
