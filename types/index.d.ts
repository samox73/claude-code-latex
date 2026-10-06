/** /tex-calibrate's trial cell aspect while its pane is open; 0 before the first open. */
export type TexDisplayAspect = number

declare module 'claude-code' {
  interface PluginState {
    'tex-display': { aspect: TexDisplayAspect }
  }
}
