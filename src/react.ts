/**
 * Honertia React Utilities
 */

import type { PageProps } from './helpers.js'

type ComponentType<P = unknown> = (props: P) => unknown

export type HonertiaPage<TProps = Record<string, never>> = ComponentType<TProps & PageProps>

export type PageResolver = (name: string) => 
  | Promise<{ default: ComponentType<unknown> }>
  | { default: ComponentType<unknown> }

export interface SharedProps {
  errors?: Record<string, string>
}

export type WithSharedProps<TProps = Record<string, never>> = TProps & SharedProps

export type { PageProps } from './helpers.js'
