// File System Access API pieces missing from lib.dom (WICG spec, Chromium-only).

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>
}

interface FileSystemFileHandle {
  // Chromium 111+. Optional here because the vault falls back to a byte copy
  // when it is missing, and directory handles never got it at all.
  move?(destination: FileSystemDirectoryHandle, name?: string): Promise<void>
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: string
  }): Promise<FileSystemDirectoryHandle>
}
