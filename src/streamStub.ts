// The SSH package's barrel exports SshStream and SecureStream, which extend
// stream.Duplex at module-evaluation time. We never use them, but the classes
// must have something to extend or the whole chunk throws
// "Class extends value undefined". Vite aliases 'stream' here.
class Unsupported {
  constructor() {
    throw new Error('Node streams are not available in the browser')
  }
}

export class Duplex extends Unsupported {}
export class Readable extends Unsupported {}
export class Writable extends Unsupported {}
export class Transform extends Unsupported {}
export default { Duplex, Readable, Writable, Transform }
