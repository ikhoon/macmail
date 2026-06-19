// Tell TypeScript about Bun's `with { type: 'text' }` imports for .applescript
// files. Runtime resolution is handled by Bun's loader; we just need the type.
declare module '*.applescript' {
  const content: string;
  export default content;
}
