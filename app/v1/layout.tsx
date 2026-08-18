/**
 * V1 SHELL — the interface submitted on 17 August, preserved.
 *
 * Two things used to live in the root layout and are now here, because they are properties of the
 * old interface rather than of the application:
 *
 *   `flex h-dvh overflow-hidden` — v1 is a fixed viewport that never scrolls, with the rail and the
 *   screen side by side and only regions inside them scrolling. The rebuilt interface is a normal
 *   scrolling document, so that constraint could not stay on `body`.
 *
 *   `data-ui="v1"` — the scope for v1's colour tokens. `globals.css` defines the dark palette twice:
 *   once on `:root` and once here. When the rebuilt interface takes `:root` for its own light
 *   palette, this attribute keeps v1 rendering exactly as it was, with no change to any component.
 *
 * Nothing else about v1 was touched. Its routes moved from `/console` to `/v1/console` and the
 * internal links moved with them; the components, fixtures and data layer are untouched.
 */
export default function V1Layout({ children }: LayoutProps<"/v1">) {
  return (
    <div data-ui="v1" className="flex h-dvh overflow-hidden w-full">
      {children}
    </div>
  );
}
