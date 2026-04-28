export {}

declare global {
  interface Window {
    // Node integration path, required for direct ipcRenderer usage without preload
    require?: (moduleName: string) => unknown
  }
}
