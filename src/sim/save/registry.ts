/**
 * Extra sim classes the snapshot serializer must know by name (systems added after the core set).
 * Register them here so save games keep working when minified builds rename classes.
 */
export const extraClasses: Record<string, { prototype: object }> = {};
export function registerSaveClass(name: string, cls: { prototype: object }) {
  extraClasses[name] = cls;
}
